"""Blueprint: /api/changelog"""

import json
import os

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.utils import get_tenant_lock, save_json_atomic, tenant_path

bp = Blueprint("changelog", __name__)


@bp.route("/api/changelog", methods=["GET"])
def get_changelog():
    tid = getattr(request, "tenant_id", "live")
    clog_path = tenant_path(tid, "changelog.json")
    with get_tenant_lock(tid, "changelog"):
        if os.path.exists(clog_path):
            try:
                with open(clog_path, "r", encoding="utf-8") as f:
                    entries = json.load(f)
            except Exception:
                entries = []
        else:
            entries = []

    action = request.args.get("action") or ""
    entity_type = request.args.get("entityType") or ""
    if action:
        entries = [e for e in entries if e.get("action") == action]
    if entity_type:
        entries = [e for e in entries if e.get("entityType") == entity_type]

    page_str = request.args.get("page")
    if page_str is None:
        return jsonify(entries)

    try:
        page = max(1, int(page_str))
    except (ValueError, TypeError):
        page = 1
    per = min(100, max(1, request.args.get("per", 20, type=int)))
    total = len(entries)
    pages = max(1, -(-total // per))
    page = min(page, pages)
    start = (page - 1) * per

    return jsonify({
        "entries": entries[start:start + per],
        "total": total,
        "page": page,
        "pages": pages,
    })


@bp.route("/api/changelog", methods=["POST"])
def post_changelog():
    check = require_role("superadmin", "admin", "tecnico")
    if check:
        return check
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, list):
        return jsonify({"error": "payload inválido"}), 400
    if len(payload) > 50000:
        return jsonify({"error": "payload excede limite de 50000 entradas"}), 400
    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "changelog"):
        save_json_atomic(tenant_path(tid, "changelog.json"), payload)
    return jsonify({"ok": True})
