"""Blueprint: /api/annotations/*"""

import time
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.utils import load_json_safe, save_json_atomic, tenant_path

bp = Blueprint("annotations", __name__)


@bp.route("/api/annotations", methods=["GET"])
def get_annotations():
    check = require_role("admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    return jsonify(load_json_safe(tenant_path(tid, "annotations.json"), []))


@bp.route("/api/annotations", methods=["POST"])
def add_annotation():
    check = require_role("admin", "superadmin")
    if check:
        return check
    payload = request.get_json(force=True, silent=True) or {}
    text = (payload.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Texto da anotação é obrigatório"}), 400
    user = getattr(request, "auth_user", {})
    tid = getattr(request, "tenant_id", "live")
    entry = {
        "id": int(time.time() * 1000),
        "text": text,
        "author": user.get("name", user.get("username", "?")),
        "date": datetime.now(timezone.utc).isoformat(),
        "status": "pendente",
        "view": payload.get("view", ""),
        "xPct": payload.get("xPct", 0),
        "yPx": payload.get("yPx", 0),
        "elSelector": payload.get("elSelector", ""),
        "elText": payload.get("elText", ""),
    }
    ann_path = tenant_path(tid, "annotations.json")
    data = load_json_safe(ann_path, [])
    data.append(entry)
    save_json_atomic(ann_path, data)
    return jsonify({"ok": True, "annotation": entry})


@bp.route("/api/annotations/<int:aid>", methods=["PATCH"])
def update_annotation(aid):
    check = require_role("superadmin")
    if check:
        return check
    payload = request.get_json(force=True, silent=True) or {}
    tid = getattr(request, "tenant_id", "live")
    ann_path = tenant_path(tid, "annotations.json")
    data = load_json_safe(ann_path, [])
    for a in data:
        if a.get("id") == aid:
            if "status" in payload:
                a["status"] = payload["status"]
            save_json_atomic(ann_path, data)
            return jsonify({"ok": True})
    return jsonify({"error": "Anotação não encontrada"}), 404


@bp.route("/api/annotations/<int:aid>", methods=["DELETE"])
def delete_annotation(aid):
    check = require_role("superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    ann_path = tenant_path(tid, "annotations.json")
    data = [a for a in load_json_safe(ann_path, []) if a.get("id") != aid]
    save_json_atomic(ann_path, data)
    return jsonify({"ok": True})
