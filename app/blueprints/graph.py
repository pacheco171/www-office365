"""Blueprint: /api/graph/*, /api/subscriptions — sync Graph API e auditoria."""

import threading
import unicodedata

from flask import Blueprint, request, jsonify
from requests.exceptions import HTTPError as RequestsHTTPError

from app.auth_service import require_role
from app.config import http_requests
from app.utils import (
    log, tenant_path, load_json_safe, save_json_atomic,
    get_tenant_lock, load_data, save_data, load_overrides, apply_overrides,
    normalize_email, _sync_status, _sync_threads,
)
from app.graph_service import (
    load_graph_config, save_graph_config, graph_get_token, graph_get_paginated,
    graph_get_simple, build_subscriptions, do_graph_sync, ensure_sync_thread,
    process_graph_user, _parse_ou_dn, _parse_dept, NAME_SUFFIX_RE, build_area_to_macro,
    resolve_hierarchy_server, assign_license_for_user, resolve_sku_ids_for_lic,
)

bp = Blueprint("graph", __name__)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _norm_compare(s: str) -> str:
    s = (s or "").strip().lower()
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _strip_name_suffix(name: str) -> str:
    if not name:
        return ""
    m = NAME_SUFFIX_RE.match(name)
    return m.group(1).strip() if m else name.strip()


def _compare_records(source_map: dict, source_label: str, db_map: dict) -> list:
    diffs = []
    for email in sorted(set(list(source_map.keys()) + list(db_map.keys()))):
        src = source_map.get(email)
        loc = db_map.get(email)

        if src and not loc:
            diffs.append({"email": email, "nome": _strip_name_suffix(src.get("nome", email)),
                          "tipo": "somente_fonte", "campos": [],
                          "resumo": f"Existe no {source_label} mas nao no sistema"})
            continue
        if loc and not src:
            diffs.append({"email": email, "nome": _strip_name_suffix(loc.get("nome", email)),
                          "tipo": "somente_sistema", "campos": [],
                          "resumo": f"Existe no sistema mas nao no {source_label}"})
            continue

        campos = []
        is_setor_fixo = loc.get("setorFixo", False)
        is_cargo_fixo = loc.get("cargoFixo", False)

        field_defs = [
            ("nome", False, lambda s, l: (_strip_name_suffix(s.get("nome", "")), _strip_name_suffix(l.get("nome", "")))),
            ("setor", True, lambda s, l: ((s.get("setor") or "").strip(), (l.get("setor", "") or "Sem Setor").strip())),
            ("area", True, lambda s, l: ((s.get("area") or "").strip(), (l.get("area", "") or "").strip())),
            ("cargo", True, lambda s, l: ((s.get("cargo") or "").strip(), (l.get("cargo") or "").strip())),
        ]

        for field_name, skip_if_empty, extractor in field_defs:
            src_val, loc_val = extractor(src, loc)
            if skip_if_empty and not src_val:
                continue
            if _norm_compare(src_val) != _norm_compare(loc_val):
                is_fixo = (is_setor_fixo if field_name in ("setor", "area")
                           else is_cargo_fixo if field_name == "cargo" else False)
                campos.append({"campo": field_name, "ad": src_val or "(vazio)",
                                "sistema": loc_val or "(vazio)", "fixo": is_fixo})

        for field_name, src_val, loc_val in [
            ("licenca", (src.get("licId") or "").strip(), (loc.get("licId") or "").strip()),
        ]:
            if src_val and src_val != loc_val:
                campos.append({"campo": field_name, "ad": src_val or "none",
                                "sistema": loc_val or "none", "fixo": False})

        src_addons = sorted(src.get("addons") or [])
        loc_addons = sorted(loc.get("addons") or [])
        if src_addons and src_addons != loc_addons:
            campos.append({"campo": "addons", "ad": ", ".join(src_addons) or "(nenhum)",
                           "sistema": ", ".join(loc_addons) or "(nenhum)", "fixo": False})

        src_status = (src.get("status") or "").strip()
        loc_status = (loc.get("status") or "").strip()
        if src_status and src_status != loc_status:
            campos.append({"campo": "status", "ad": src_status, "sistema": loc_status, "fixo": False})

        if campos:
            diffs.append({"email": email, "nome": src.get("nome", email),
                          "tipo": "divergencia", "campos": campos,
                          "resumo": ", ".join(c["campo"] for c in campos)})
    return diffs


# ── Rotas ─────────────────────────────────────────────────────────────────────

@bp.route("/api/graph/config", methods=["GET"])
def get_graph_config():
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)

    def _mask(val):
        if not val:
            return ""
        return (val[:4] + "*" * (len(val) - 8) + val[-4:]) if len(val) > 8 else "****"

    for field in ("client_secret", "tenant_id", "client_id", "ai_api_key"):
        cfg[f"{field}_masked"] = _mask(cfg.get(field, ""))
        cfg.pop(field, None)

    cfg["status"] = _sync_status.get(tid, {"running": False, "lastSync": None, "lastError": None, "lastResult": None})
    return jsonify(cfg)


@bp.route("/api/graph/config", methods=["POST"])
def post_graph_config():
    check = require_role("superadmin")
    if check:
        return check
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "payload inválido"}), 400
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    for key in ("tenant_id", "client_id", "client_secret", "domain", "ou_root", "auto_sync", "sync_interval_hours", "ai_api_key"):
        if key in payload:
            cfg[key] = payload[key]
    save_graph_config(cfg, tid)
    ensure_sync_thread(tid)
    return jsonify({"ok": True})


@bp.route("/api/subscriptions", methods=["GET"])
def get_subscriptions():
    tid = getattr(request, "tenant_id", "live")
    data = load_data(tid)
    subs = data.get("subscriptions", [])
    if not subs:
        try:
            cfg = load_graph_config(tid)
            if cfg.get("tenant_id") and cfg.get("client_id") and cfg.get("client_secret"):
                token = graph_get_token(cfg)
                skus = graph_get_simple(token, "https://graph.microsoft.com/v1.0/subscribedSkus")
                subs = build_subscriptions(skus)
                data = load_data(tid)
                data["subscriptions"] = subs
                save_data(data, tid)
        except Exception as e:
            log.warning("Falha ao buscar subscriptions do Azure: %s", e)
    return jsonify(subs)


@bp.route("/api/graph/sync", methods=["POST"])
def trigger_sync():
    check = require_role("superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    status = _sync_status.get(tid, {})
    if status.get("running"):
        return jsonify({"error": "Sync já em execução"}), 409
    t = threading.Thread(target=do_graph_sync, args=(None, tid), daemon=True)
    t.start()
    return jsonify({"ok": True, "message": "Sync iniciado em background"})


@bp.route("/api/graph/status", methods=["GET"])
def get_sync_status():
    tid = getattr(request, "tenant_id", "live")
    return jsonify(_sync_status.get(tid, {"running": False, "lastSync": None, "lastError": None, "lastResult": None}))


@bp.route("/api/graph/remap-setores", methods=["POST"])
def remap_setores():
    check = require_role("superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Credenciais Azure não configuradas"}), 400

    try:
        domain = cfg.get("domain", "liveoficial.com.br")
        ou_root = cfg.get("ou_root", "Setores")
        token = graph_get_token(cfg)

        users = graph_get_paginated(
            token, "https://graph.microsoft.com/v1.0/users",
            {"$select": "userPrincipalName,onPremisesDistinguishedName,department,displayName",
             "$top": "999", "$filter": f"endsWith(userPrincipalName,'@{domain}')"},
        )

        dn_map = {}
        for u in users:
            email = (u.get("userPrincipalName") or "").lower().strip()
            if not email or "#ext#" in email:
                continue
            dn = u.get("onPremisesDistinguishedName") or ""
            ou_setor, ou_area, ou_subarea = _parse_ou_dn(dn, ou_root)
            if ou_setor:
                dn_map[email] = {"setor": ou_setor, "area": ou_area, "subarea": ou_subarea, "dn": dn}
            else:
                dept_setor, dept_area = _parse_dept(u.get("department") or "")
                if dept_setor and dept_setor != "Sem Setor":
                    dn_map[email] = {"setor": dept_setor, "area": dept_area, "subarea": None, "dn": dn}

        with get_tenant_lock(tid, "overrides"):
            ov = load_overrides(tid).get("overrides", {})

        updated = 0
        skipped_fixo = 0
        data = load_data(tid)
        for rec in data.get("db", []):
            email = (rec.get("email") or "").lower().strip()
            if ov.get(email, {}).get("fixo"):
                skipped_fixo += 1
                continue
            mapping = dn_map.get(email)
            if mapping:
                old_setor, old_area = rec.get("setor"), rec.get("area")
                rec["setor"] = mapping["setor"]
                rec["area"] = mapping["area"]
                rec["subarea"] = mapping.get("subarea")
                rec["dn"] = mapping.get("dn", "")
                if rec["setor"] != old_setor or rec["area"] != old_area:
                    updated += 1

        with get_tenant_lock(tid, "hierarchy"):
            hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
            hier = hier_data.get("hierarchy", {})
        atm, ms = build_area_to_macro(hier)
        for rec in data.get("db", []):
            macro, hier_area = resolve_hierarchy_server(rec["setor"], rec.get("area"), atm, ms)
            rec["macro"] = macro
            rec["hierArea"] = hier_area

        for snap in data.get("snapshots", []):
            for rec in snap.get("data", []):
                email = (rec.get("email") or "").lower().strip()
                if ov.get(email, {}).get("fixo"):
                    continue
                mapping = dn_map.get(email)
                if mapping:
                    rec["setor"] = mapping["setor"]
                    rec["area"] = mapping["area"]
                    rec["subarea"] = mapping.get("subarea")
        save_data(data, tid)

        log.info("Remap setores: %d atualizados, %d fixos ignorados, %d DNs", updated, skipped_fixo, len(dn_map))
        return jsonify({"ok": True, "updated": updated, "skipped_fixo": skipped_fixo,
                        "total_dns": len(dn_map), "total_users": len(users)})
    except Exception:
        log.exception("Erro no remap de setores")
        return jsonify({"error": "Erro interno. Verifique os logs do servidor."}), 500


@bp.route("/api/graph/audit", methods=["POST"])
def graph_audit():
    try:
        tid = getattr(request, "tenant_id", "live")
        cfg = load_graph_config(tid)
        has_graph = cfg.get("tenant_id") and cfg.get("client_id") and cfg.get("client_secret")

        data = load_data(tid)
        with get_tenant_lock(tid, "overrides"):
            ov = load_overrides(tid).get("overrides", {})
        apply_overrides(data.get("db", []), ov)
        db_map = {normalize_email(r.get("email", "")): r for r in data.get("db", []) if r.get("email")}

        if has_graph:
            source_label = "AD"
            domain = cfg.get("domain", "liveoficial.com.br")
            ou_root = cfg.get("ou_root", "Setores")
            token = graph_get_token(cfg)
            ad_users = graph_get_paginated(
                token, "https://graph.microsoft.com/v1.0/users",
                {"$select": "id,displayName,userPrincipalName,department,jobTitle,accountEnabled,assignedLicenses,createdDateTime,onPremisesDistinguishedName",
                 "$top": "999", "$filter": f"endsWith(userPrincipalName,'@{domain}')"},
            )
            skus = graph_get_paginated(token, "https://graph.microsoft.com/v1.0/subscribedSkus")
            sku_id_to_name = {s["skuId"]: s["skuPartNumber"] for s in skus}
            source_map = {}
            for u in ad_users:
                result = process_graph_user(u, sku_id_to_name, ou_root)
                if not result:
                    continue
                source_map[result["email"]] = {
                    "nome": result["nome"], "setor": result["setor"], "area": result["area"],
                    "subarea": result.get("subarea"), "cargo": result["cargo"],
                    "cargoOrigem": result.get("cargoOrigem", "ad"),
                    "licId": result["lic_id"], "addons": result["addons"], "status": result["status"],
                }
        else:
            snapshots = data.get("snapshots", [])
            if not snapshots:
                return jsonify({"error": "Nenhum snapshot/CSV encontrado."}), 400
            last_snap = sorted(snapshots, key=lambda s: (s.get("ano", 0), s.get("mes", 0)))[-1]
            source_label = f"CSV ({last_snap.get('label', '?')})"
            source_map = {
                normalize_email(r.get("email", "")): {
                    "nome": r.get("nome", ""), "setor": r.get("setor", ""),
                    "area": r.get("area"), "subarea": r.get("subarea"),
                    "cargo": r.get("cargo", ""), "licId": r.get("licId", "none"),
                    "addons": r.get("addons", []), "status": r.get("status", ""),
                }
                for r in last_snap.get("data", []) if r.get("email")
            }

        diffs = _compare_records(source_map, source_label, db_map)
        return jsonify({"ok": True, "source": source_label, "total_fonte": len(source_map),
                        "total_sistema": len(db_map), "total_diffs": len(diffs), "diffs": diffs})
    except Exception as e:
        log.error("Erro no audit: %s", e)
        return jsonify({"error": "Erro interno. Verifique os logs do servidor."}), 500


@bp.route("/api/graph/test", methods=["POST"])
def test_graph_connection():
    check = require_role("superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    payload = request.get_json(force=True, silent=True) or {}
    for key in ("tenant_id", "client_id", "client_secret"):
        if key in payload:
            cfg[key] = payload[key]
    try:
        if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
            return jsonify({"ok": False, "error": "Credenciais incompletas"}), 400
        token = graph_get_token(cfg)
        resp = http_requests.get(
            "https://graph.microsoft.com/v1.0/organization",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        resp.raise_for_status()
        org = resp.json().get("value", [{}])[0]
        return jsonify({"ok": True, "organization": org.get("displayName", ""), "tenant": org.get("id", "")})
    except Exception:
        log.exception("Erro no graph test")
        return jsonify({"ok": False, "error": "Falha ao conectar com Azure. Verifique credenciais e logs."}), 400


@bp.route("/api/graph/assign-license", methods=["POST"])
def assign_license_route():
    check = require_role("superadmin", "admin", "tecnico")
    if check:
        return check

    payload = request.get_json(force=True, silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    lic_id = (payload.get("licId") or "none").strip()
    addons = [a for a in (payload.get("addons") or []) if isinstance(a, str)]
    if not email:
        return jsonify({"error": "email é obrigatório"}), 400

    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    if not (cfg.get("tenant_id") and cfg.get("client_id") and cfg.get("client_secret")):
        return jsonify({"error": "Credenciais Azure não configuradas — não é possível alterar licenças no M365."}), 503

    try:
        token = graph_get_token(cfg)
        data = load_data(tid)
        subscriptions = data.get("subscriptions") or []
        if not subscriptions:
            skus = graph_get_simple(token, "https://graph.microsoft.com/v1.0/subscribedSkus")
            subscriptions = build_subscriptions(skus)
            data["subscriptions"] = subscriptions
            save_data(data, tid)

        target_sku_ids = resolve_sku_ids_for_lic(lic_id, addons, subscriptions)
        managed_sku_ids = {s["skuId"] for s in subscriptions if s.get("skuId")}

        if lic_id not in ("none", "other") and not target_sku_ids:
            return jsonify({"error": f"Licença '{lic_id}' não está disponível neste tenant Azure."}), 400

        result = assign_license_for_user(token, email, target_sku_ids, managed_sku_ids)

        for rec in data.get("db", []):
            if (rec.get("email") or "").strip().lower() == email:
                rec["licId"] = lic_id
                rec["addons"] = list(addons)
                break
        save_data(data, tid)

        return jsonify({"ok": True, **result})
    except RequestsHTTPError as e:
        status = getattr(e.response, "status_code", 502)
        try:
            body = (e.response.json().get("error", {}) or {}).get("message", "") or e.response.text[:300]
        except Exception:
            body = getattr(e.response, "text", "")[:300] if e.response is not None else str(e)
        log.warning("Graph assignLicense %s falhou %s: %s", email, status, body)
        return jsonify({"error": body or "Falha na chamada ao Microsoft Graph."}), 502
    except Exception:
        log.exception("Erro inesperado em assign-license")
        return jsonify({"error": "Erro interno. Verifique os logs do servidor."}), 500
