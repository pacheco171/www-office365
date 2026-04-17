"""Blueprint: /api/support/*"""

import json
import os
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.utils import tenant_path

bp = Blueprint("support", __name__)


def _read_tickets(tenant_id: str = "live") -> list:
    path = tenant_path(tenant_id, "tickets.json")
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _write_tickets(tickets: list, tenant_id: str = "live"):
    path = tenant_path(tenant_id, "tickets.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(tickets, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


@bp.route("/api/support/ticket", methods=["POST"])
def create_ticket():
    check = require_role("tecnico", "admin", "superadmin")
    if check:
        return check
    body = request.get_json(silent=True) or {}
    subject = body.get("subject", "").strip()
    message = body.get("message", "").strip()
    category = body.get("category", "Outro").strip()
    if not subject or not message:
        return jsonify({"error": "Assunto e descrição são obrigatórios."}), 400

    user = getattr(request, "auth_user", None)
    user_name = (user.get("name", "Anônimo") if user else "Anônimo")

    tid = getattr(request, "tenant_id", "live")
    tickets = _read_tickets(tid)
    new_id = max((t.get("id", 0) for t in tickets), default=0) + 1
    ticket = {
        "id": new_id, "user": user_name, "subject": subject,
        "message": message, "category": category,
        "status": "aberto",
        "created": datetime.now(timezone.utc).isoformat(),
        "replies": [],
    }
    tickets.append(ticket)
    _write_tickets(tickets, tid)
    return jsonify({"ok": True, "id": new_id})


@bp.route("/api/support/tickets", methods=["GET"])
def list_tickets():
    check = require_role("tecnico", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    tickets = _read_tickets(tid)
    user = getattr(request, "auth_user", None)
    user_name = (user.get("name", "") if user else "")
    user_tickets = [t for t in tickets if t.get("user") == user_name] if user_name else tickets
    user_tickets.sort(key=lambda t: t.get("created", ""), reverse=True)
    return jsonify({"data": user_tickets})
