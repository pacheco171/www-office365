"""Blueprint: /api/overrides/*"""

from datetime import datetime, timezone

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.utils import (
    get_tenant_lock, load_overrides, save_overrides,
    normalize_email, validate_email_format, validate_text_field,
    _invalidate_data_cache,
)

bp = Blueprint("overrides", __name__)


@bp.route("/api/overrides", methods=["GET"])
def get_overrides():
    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "overrides"):
        return jsonify(load_overrides(tid))


@bp.route("/api/overrides/<path:email>", methods=["PUT"])
def put_override(email):
    check = require_role("superadmin")
    if check:
        return check
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict) or "setor" not in payload:
        return jsonify({"error": 'campo "setor" obrigatório'}), 400

    email = validate_email_format(email)
    if not email:
        return jsonify({"error": "Email inválido"}), 400

    setor, err = validate_text_field(payload.get("setor"), "setor")
    if err:
        return jsonify({"error": err}), 400

    fixo = payload.get("fixo", True)
    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "overrides"):
        data = load_overrides(tid)
        if not fixo:
            data["overrides"].pop(email, None)
        else:
            entry = {
                "setor": setor,
                "fixo": True,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            for field in ("tipo", "cargo", "area"):
                raw = payload.get(field)
                if raw:
                    val, err = validate_text_field(raw, field)
                    if err:
                        return jsonify({"error": err}), 400
                    entry[field] = val
            data["overrides"][email] = entry
        save_overrides(data, tid)
    _invalidate_data_cache(tid)
    return jsonify({"ok": True})


@bp.route("/api/overrides/<path:email>", methods=["DELETE"])
def delete_override(email):
    check = require_role("superadmin")
    if check:
        return check
    email = normalize_email(email)
    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "overrides"):
        data = load_overrides(tid)
        data["overrides"].pop(email, None)
        save_overrides(data, tid)
    _invalidate_data_cache(tid)
    return jsonify({"ok": True})
