"""Blueprint: dados principais — /api/me, /api/data, /api/boot, /api/colaboradores, /api/licenses, /api/fatura."""

import json
import time as _time

from flask import Blueprint, request, jsonify, Response

from app.config import DEFAULT_ROLE, ROLES_ALL, ROLES_NO_GESTOR
from app.auth_service import require_role, is_global_admin, load_tenants_config
from app.licenses import SKU_MAP, LIC_NAME_MAP, LIC_PRIORITY, LIC_PRICES, LIC_CATALOG, compute_cost
from app.utils import (
    load_json_safe, tenant_path, load_data, save_data, load_overrides, apply_overrides,
    DEFAULT_DATA, _data_response_cache, _boot_cache, _processed_rows_cache, _invalidate_data_cache,
)
from app.graph_service import build_area_to_macro, resolve_hierarchy_server

bp = Blueprint("core", __name__)


# ── Helpers internos ──────────────────────────────────────────────────────────

def _backfill_lic(rec: dict):
    """Recalcula licId/addons/custo a partir de licRaw para registros desatualizados."""
    lic_raw = rec.get("licRaw", "")
    if lic_raw:
        parts = [p.strip() for p in lic_raw.split("+")]
        addon_skus = {"pbi", "apps", "planner1", "planner3"}
        main_ids, addon_ids = set(), set()
        for part in parts:
            upper = part.upper().replace(" ", "_")
            lid = SKU_MAP.get(upper)
            if not lid:
                for pattern, mapped_id in LIC_NAME_MAP:
                    if pattern in part.lower():
                        lid = mapped_id
                        break
            if not lid or lid == "_free":
                continue
            if lid in addon_skus:
                addon_ids.add(lid)
            else:
                main_ids.add(lid)
        lic_id = "none"
        for pid in LIC_PRIORITY:
            if pid in main_ids:
                lic_id = pid
                break
        if lic_id == "none" and main_ids:
            lic_id = "other"
        rec["licId"] = lic_id
        rec["addons"] = list(addon_ids)
    rec["custo"] = compute_cost(rec.get("licId", "none"), rec.get("addons"))


def _norm_setor(s: str) -> str:
    from app.graph_service import SETOR_NORMALIZE
    return SETOR_NORMALIZE.get(s, s)


def _process_records(records: list, ov: dict, area_to_macro: dict, macro_set: set):
    for rec in records:
        if rec.get("setor"):
            rec["setor"] = _norm_setor(rec["setor"])
        _backfill_lic(rec)
        if "cargoOrigem" not in rec:
            rec["cargoOrigem"] = "fallback" if (rec.get("cargo") or "") == "Colaborador" else "ad"
        macro, hier_area = resolve_hierarchy_server(rec.get("setor"), rec.get("area"), area_to_macro, macro_set)
        rec["macro"] = macro
        rec["hierArea"] = hier_area
    apply_overrides(records, ov)


def _get_processed_rows(tid: str) -> list:
    cached = _processed_rows_cache.get(tid)
    if cached is not None:
        return cached
    data = load_data(tid)
    hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
    hier = hier_data.get("hierarchy", {})
    area_to_macro, macro_set = build_area_to_macro(hier)
    ov = load_overrides(tid).get("overrides", {})
    rows = data.get("db", [])
    _process_records(rows, ov, area_to_macro, macro_set)
    _processed_rows_cache[tid] = rows
    return rows


_FINANCIAL_RECORD_KEYS = frozenset(("custo",))
_FINANCIAL_ROOT_KEYS = ("fatura", "contracts", "acoes")


def _strip_tecnico(record: dict) -> dict:
    """Retorna cópia do record sem campos financeiros (para role tecnico)."""
    return {k: v for k, v in record.items() if k not in _FINANCIAL_RECORD_KEYS}


def _build_data_response_filtered(tid: str, setor: str) -> bytes:
    rows = _get_processed_rows(tid)
    data = load_data(tid)
    result = {k: v for k, v in data.items() if k not in ("db", "snapshots", "fatura", "contracts", "acoes")}
    result["db"] = [r for r in rows if r.get("setor") == setor]
    result["snapshots"] = []
    result["fatura"] = []
    result["contracts"] = []
    result["acoes"] = []
    return json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _build_data_response_tecnico(tid: str) -> bytes:
    rows = _get_processed_rows(tid)
    data = load_data(tid)
    result = {k: v for k, v in data.items() if k not in ("db", "snapshots") + _FINANCIAL_ROOT_KEYS}
    result["db"] = [_strip_tecnico(r) for r in rows]
    result["snapshots"] = []
    for key in _FINANCIAL_ROOT_KEYS:
        result[key] = []
    return json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _build_data_response(tid: str) -> bytes:
    data = load_data(tid)
    hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
    hier = hier_data.get("hierarchy", {})
    area_to_macro, macro_set = build_area_to_macro(hier)
    ov = load_overrides(tid).get("overrides", {})
    _process_records(data.get("db", []), ov, area_to_macro, macro_set)
    for snap in data.get("snapshots", []):
        _process_records(snap.get("data", []), ov, area_to_macro, macro_set)
    resp_bytes = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    _data_response_cache[tid] = resp_bytes
    return resp_bytes


def _ensure_boot_cache(tid: str, uname: str) -> dict:
    cached_boot = _boot_cache.get(tid)
    if cached_boot:
        return cached_boot
    ov = load_overrides(tid)
    hier = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
    subs = load_data(tid).get("subscriptions", [])
    cfg = load_tenants_config()
    tenants_list = cfg.get("tenants", {})
    clean = uname.split("@")[0].lower().strip() if uname else ""
    if is_global_admin(uname):
        t_result = [{"slug": s, "name": t.get("name", s), "active": t.get("active", False)}
                    for s, t in tenants_list.items() if t.get("active")]
    else:
        t_result = []
        for s, t in tenants_list.items():
            if not t.get("active"):
                continue
            roles = load_json_safe(tenant_path(s, "roles.json"), {})
            if clean in [k.lower() for k in roles]:
                t_result.append({"slug": s, "name": t.get("name", s), "active": True})
    current_t = tenants_list.get(tid, {})
    _boot_cache[tid] = {
        "overrides": ov,
        "hierarchy": hier,
        "subscriptions": subs,
        "licenses": LIC_CATALOG,
        "tenants": {"tenants": t_result, "current": tid, "current_name": current_t.get("name", tid)},
    }
    return _boot_cache[tid]


# ── Rotas ─────────────────────────────────────────────────────────────────────

@bp.route("/api/me", methods=["GET"])
def get_me():
    user = getattr(request, "auth_user", {})
    role = getattr(request, "auth_role", DEFAULT_ROLE)
    tid = getattr(request, "tenant_id", "live")
    uname = user.get("username") or user.get("email") or user.get("name", "")
    return jsonify({
        "name": user.get("name", ""),
        "username": uname,
        "email": user.get("email", ""),
        "role": role,
        "tenant_id": tid,
        "global_admin": is_global_admin(uname),
        "setor_acesso": getattr(request, "auth_setor", None),
    })


@bp.route("/api/data", methods=["GET"])
def get_data():
    check = require_role(*ROLES_ALL)
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    role = getattr(request, "auth_role", DEFAULT_ROLE)
    setor = getattr(request, "auth_setor", None)
    if role == "gestor":
        return Response(_build_data_response_filtered(tid, setor or ""), mimetype="application/json")
    if role == "tecnico":
        return Response(_build_data_response_tecnico(tid), mimetype="application/json")
    cached = _data_response_cache.get(tid)
    if cached:
        return Response(cached, mimetype="application/json")
    return Response(_build_data_response(tid), mimetype="application/json")


@bp.route("/api/data", methods=["POST"])
def post_data():
    check = require_role("superadmin", "admin", "tecnico")
    if check:
        return check
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "payload inválido"}), 400
    tid = getattr(request, "tenant_id", "live")
    current = load_data(tid)
    current.update({k: v for k, v in payload.items() if k in DEFAULT_DATA})
    save_data(current, tid)
    return jsonify({"ok": True})


@bp.route("/api/boot", methods=["GET"])
def api_boot():
    check = require_role(*ROLES_ALL)
    if check:
        return check
    t0 = _time.time()
    tid = getattr(request, "tenant_id", "live")
    user = getattr(request, "auth_user", {})
    uname = user.get("username") or user.get("email") or user.get("name", "")
    role = getattr(request, "auth_role", DEFAULT_ROLE)
    phase = request.args.get("phase", "")

    boot_parts = _ensure_boot_cache(tid, uname)
    me_obj = {
        "name": user.get("name", ""),
        "username": uname,
        "role": role,
        "global_admin": is_global_admin(uname),
        "setor_acesso": getattr(request, "auth_setor", None),
    }

    if phase == "core":
        db_rows = list(_get_processed_rows(tid))
        if role == "gestor":
            setor = getattr(request, "auth_setor", None) or ""
            db_rows = [r for r in db_rows if r.get("setor") == setor] if setor else []
        elif role == "tecnico":
            db_rows = [_strip_tecnico(r) for r in db_rows]
        result = {
            "data": {"db": db_rows}, "me": me_obj,
            "overrides": boot_parts["overrides"],
            "hierarchy": boot_parts["hierarchy"],
            "licenses": boot_parts["licenses"],
            "tenants": boot_parts["tenants"],
            "subscriptions": boot_parts["subscriptions"],
        }
        from flask import current_app
        current_app.logger.info("boot phase=core tenant=%s %dms", tid, round((_time.time() - t0) * 1000))
        return jsonify(result)

    if phase == "history":
        data = load_data(tid)
        hier = boot_parts["hierarchy"].get("hierarchy", {})
        area_to_macro, macro_set = build_area_to_macro(hier)
        ov = boot_parts["overrides"].get("overrides", {})
        for snap in data.get("snapshots", []):
            _process_records(snap.get("data", []), ov, area_to_macro, macro_set)
        if role == "tecnico":
            snaps = [
                {**{k: v for k, v in s.items() if k != "data"}, "data": [_strip_tecnico(r) for r in s.get("data", [])]}
                for s in data.get("snapshots", [])
            ]
            result = {
                "data": {
                    "snapshots": snaps,
                    "contracts": [],
                    "acoes": [],
                    "usage": data.get("usage", {}),
                    "fatura": [],
                },
                "subscriptions": boot_parts["subscriptions"],
            }
        else:
            result = {
                "data": {
                    "snapshots": data.get("snapshots", []),
                    "contracts": data.get("contracts", []),
                    "acoes": data.get("acoes", []),
                    "usage": data.get("usage", {}),
                    "fatura": data.get("fatura", []),
                },
                "subscriptions": boot_parts["subscriptions"],
            }
        from flask import current_app
        current_app.logger.info("boot phase=history tenant=%s %dms", tid, round((_time.time() - t0) * 1000))
        return jsonify(result)

    if role == "gestor":
        setor = getattr(request, "auth_setor", None) or ""
        cached_data = _build_data_response_filtered(tid, setor)
    elif role == "tecnico":
        cached_data = _build_data_response_tecnico(tid)
    else:
        cached_data = _data_response_cache.get(tid)
        if not cached_data:
            _build_data_response(tid)
            cached_data = _data_response_cache.get(tid)

    static_json = json.dumps({
        "overrides": boot_parts["overrides"],
        "hierarchy": boot_parts["hierarchy"],
        "subscriptions": boot_parts["subscriptions"],
        "licenses": boot_parts["licenses"],
        "tenants": boot_parts["tenants"],
    }, ensure_ascii=False, separators=(",", ":"))
    me_json = json.dumps(me_obj, ensure_ascii=False, separators=(",", ":"))
    body = b'{"data":' + (cached_data or b'{}') + b',"me":' + me_json.encode() + b',' + static_json[1:].encode()

    from flask import current_app
    current_app.logger.info("boot phase=full tenant=%s %dms", tid, round((_time.time() - t0) * 1000))
    return Response(body, mimetype="application/json")


@bp.route("/api/colaboradores", methods=["GET"])
def get_colaboradores():
    check = require_role(*ROLES_ALL)
    if check:
        return check
    import unicodedata as _ud

    page = max(1, request.args.get("page", 1, type=int))
    per = min(100, max(1, request.args.get("per", 10, type=int)))
    q = (request.args.get("q") or "").strip().lower()
    f_setor = request.args.get("setor") or ""
    f_lic = request.args.get("licId") or ""
    f_status = request.args.get("status") or ""
    f_cargo_origem = request.args.get("cargoOrigem") or ""
    sort_field = request.args.get("sort", "nome")
    order = request.args.get("order", "asc").lower()

    tid = getattr(request, "tenant_id", "live")
    rows = _get_processed_rows(tid)

    role = getattr(request, "auth_role", DEFAULT_ROLE)
    if role == "gestor":
        setor_acesso = getattr(request, "auth_setor", None) or ""
        rows = [r for r in rows if r.get("setor") == setor_acesso] if setor_acesso else []
    elif role == "tecnico":
        rows = [_strip_tecnico(r) for r in rows]

    all_setores = sorted(set(r.get("setor", "") for r in rows if r.get("setor")))
    all_lics = sorted(set(r.get("licId", "") for r in rows if r.get("licId")))

    lic_name_lookup = {
        "none": "outros outros", "bstd": "m365 business standard business standard",
        "bbasic": "m365 business basic business basic",
        "apps": "m365 apps for business apps business",
        "f3": "office 365 f3 o365 f3", "e3": "office 365 e3 o365 e3",
        "pbi": "power bi pro pbi pro", "other": "outra licença outro",
    }

    filtered = []
    for r in rows:
        if f_setor and r.get("setor") != f_setor:
            continue
        if f_lic and r.get("licId") != f_lic:
            continue
        if not f_lic and r.get("licId") in ("none", "other"):
            continue
        if f_status and r.get("status") != f_status:
            continue
        if f_cargo_origem:
            orig = r.get("cargoOrigem", "ad")
            if r.get("cargoFixo"):
                orig = "override"
            if orig != f_cargo_origem:
                continue
        if q:
            lic_text = lic_name_lookup.get(r.get("licId", ""), "")
            txt = " ".join([
                r.get("nome") or "", r.get("email") or "",
                r.get("setor") or "", r.get("area") or "",
                r.get("subarea") or "", r.get("cargo") or "", lic_text
            ]).lower()
            if q not in txt:
                continue
        filtered.append(r)

    reverse = order == "desc"
    if sort_field == "custo":
        filtered.sort(key=lambda r: r.get("custo", 0), reverse=reverse)
    else:
        filtered.sort(
            key=lambda r: (r.get(sort_field) or "").lower() if isinstance(r.get(sort_field), str) else r.get(sort_field, ""),
            reverse=reverse,
        )

    total = len(filtered)
    pages = max(1, -(-total // per))
    page = min(page, pages)
    start = (page - 1) * per

    return jsonify({
        "rows": filtered[start:start + per],
        "total": total,
        "page": page,
        "pages": pages,
        "filters": {"setores": all_setores, "licIds": all_lics},
    })


@bp.route("/api/licenses", methods=["GET"])
def get_licenses():
    check = require_role(*ROLES_NO_GESTOR)
    if check:
        return check
    return jsonify(LIC_CATALOG)


@bp.route("/api/fatura", methods=["POST"])
def post_fatura():
    check = require_role("superadmin")
    if check:
        return check
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, list):
        return jsonify({"error": "payload deve ser array"}), 400
    if len(payload) > 1000:
        return jsonify({"error": "payload excede limite de 1000 itens"}), 400
    tid = getattr(request, "tenant_id", "live")
    current = load_data(tid)
    current["fatura"] = payload
    save_data(current, tid)
    return jsonify({"ok": True})
