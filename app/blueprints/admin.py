"""Blueprint: /api/tenants, /api/tenant/switch, /api/admin/*, /health"""

import os
import re
import time

from flask import Blueprint, request, jsonify

from app.auth_service import require_role, is_global_admin, is_valid_tenant, load_tenants_config
from app.config import TENANTS_CONFIG_FILE
from app.utils import (
    log, tenant_path, load_json_safe, save_json_atomic,
    DEFAULT_DATA, _sync_threads, _sync_status, _server_start_time,
)
from app.graph_service import save_graph_config

bp = Blueprint("admin", __name__)


# Importação lazy para evitar circular import
def _token_cache_size() -> int:
    from app.auth_service import _token_cache
    return len(_token_cache)


@bp.route("/api/tenants", methods=["GET"])
def list_tenants():
    check = require_role("admin", "superadmin")
    if check:
        return check
    user = getattr(request, "auth_user", {})
    uname = user.get("username") or user.get("email") or user.get("name", "")
    tid = getattr(request, "tenant_id", "live")
    cfg = load_tenants_config()
    tenants = cfg.get("tenants", {})
    clean_uname = uname.split("@")[0].lower().strip() if uname else ""
    if is_global_admin(uname):
        result = [{"slug": slug, "name": t.get("name", slug), "active": t.get("active", False)}
                  for slug, t in tenants.items() if t.get("active")]
    else:
        result = []
        for slug, t in tenants.items():
            if not t.get("active"):
                continue
            roles = load_json_safe(tenant_path(slug, "roles.json"), {})
            if clean_uname in [k.lower() for k in roles]:
                result.append({"slug": slug, "name": t.get("name", slug), "active": True})
    current = tenants.get(tid, {})
    return jsonify({"tenants": result, "current": tid, "current_name": current.get("name", tid)})


@bp.route("/api/tenant/switch", methods=["POST"])
def switch_tenant():
    user = getattr(request, "auth_user", {})
    uname = user.get("username") or user.get("email") or user.get("name", "")
    body = request.get_json(silent=True) or {}
    new_tid = (body.get("tenant") or "").strip()
    if not new_tid or not is_valid_tenant(new_tid):
        return jsonify({"error": "Tenant inválido"}), 400
    if not is_global_admin(uname):
        clean_uname = uname.split("@")[0].lower().strip() if uname else ""
        roles = load_json_safe(tenant_path(new_tid, "roles.json"), {})
        if clean_uname not in [k.lower() for k in roles]:
            return jsonify({"error": "Sem permissão"}), 403
    cfg = load_tenants_config()
    cfg["default_tenant"] = new_tid
    save_json_atomic(TENANTS_CONFIG_FILE, cfg)
    resp = jsonify({"ok": True, "tenant": new_tid})
    resp.set_cookie("active_tenant", new_tid, httponly=True, samesite="Lax")
    return resp


@bp.route("/api/admin/tenants", methods=["POST"])
def create_tenant():
    user = getattr(request, "auth_user", {})
    uname = user.get("username") or user.get("email") or user.get("name", "")
    if not is_global_admin(uname):
        return jsonify({"error": "Sem permissão"}), 403
    body = request.get_json(silent=True) or {}
    slug = re.sub(r"[^a-z0-9-]", "", (body.get("slug") or "").lower().strip())
    name = (body.get("name") or "").strip()
    if not slug or not name:
        return jsonify({"error": "slug e name são obrigatórios"}), 400
    cfg = load_tenants_config()
    if slug in cfg.get("tenants", {}):
        return jsonify({"error": "Tenant já existe"}), 409

    from app.config import TENANTS_DIR
    new_dir = os.path.join(TENANTS_DIR, slug)
    os.makedirs(new_dir, exist_ok=True)
    for fname, content in [
        ("data.json", DEFAULT_DATA),
        ("roles.json", {}),
        ("hierarchy.json", {"hierarchy": {}}),
        ("overrides.json", {"overrides": {}}),
        ("annotations.json", []),
        ("changelog.json", []),
    ]:
        save_json_atomic(os.path.join(new_dir, fname), content)

    initial_graph_cfg = {
        "tenant_id": "", "client_id": "", "client_secret": "",
        "domain": "", "ou_root": "Setores", "auto_sync": False, "sync_interval_hours": 24,
    }
    provided_config = body.get("config") or {}
    for key in ("tenant_id", "client_id", "client_secret", "domain", "ou_root"):
        if provided_config.get(key):
            initial_graph_cfg[key] = provided_config[key]
    save_graph_config(initial_graph_cfg, slug)

    cfg.setdefault("tenants", {})[slug] = {"name": name, "slug": slug, "subdomains": [slug], "active": True}
    save_json_atomic(TENANTS_CONFIG_FILE, cfg)
    return jsonify({"ok": True, "slug": slug})


@bp.route("/health")
def health_check():
    try:
        import resource
        rusage = resource.getrusage(resource.RUSAGE_SELF)
        memory_mb = round(rusage.ru_maxrss / 1024, 1)
    except ImportError:
        memory_mb = 0

    return jsonify({
        "status": "ok",
        "uptime_seconds": round(time.time() - _server_start_time, 1),
        "memory_mb": memory_mb,
        "token_cache_size": _token_cache_size(),
        "sync_threads": {k: v.is_alive() for k, v in _sync_threads.items()},
        "sync_status": {k: {"running": v.get("running"), "lastSync": v.get("lastSync")}
                        for k, v in _sync_status.items()},
    })
