"""Blueprint: /api/hierarchy"""

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.graph_service import schedule_async_sync
from app.utils import get_tenant_lock, load_json_safe, save_json_atomic, tenant_path, _invalidate_data_cache

bp = Blueprint("hierarchy", __name__)


@bp.route("/api/hierarchy", methods=["GET"])
def get_hierarchy():
    check = require_role("admin", "tecnico", "gestor", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "hierarchy"):
        return jsonify(load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}}))


@bp.route("/api/hierarchy", methods=["POST"])
def post_hierarchy():
    check = require_role("superadmin")
    if check:
        return check
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "payload invalido"}), 400
    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "hierarchy"):
        save_json_atomic(tenant_path(tid, "hierarchy.json"), payload)
    _invalidate_data_cache(tid)
    schedule_async_sync(tid, delay_seconds=5, source="hierarchy.post")
    return jsonify({"ok": True})
