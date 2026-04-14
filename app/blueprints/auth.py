"""Blueprint: /api/auth/* — login, refresh, logout, session."""

from flask import Blueprint, request, jsonify

from app.config import SSO_API, REQUIRED_GROUP, AUTH_DOMAIN, http_requests
from app.auth_service import (
    _validate_token, get_user_role, set_auth_cookies, clear_auth_cookies,
)

bp = Blueprint("auth", __name__)


@bp.route("/api/auth/login", methods=["POST"])
def auth_login():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Usuário e senha são obrigatórios"}), 400

    login_user = f"{username}@{AUTH_DOMAIN}" if AUTH_DOMAIN else username

    try:
        resp = http_requests.post(
            SSO_API + "/auth/login",
            json={"username": login_user, "password": password},
            timeout=15,
        )
    except Exception:
        return jsonify({"error": "Não foi possível conectar ao servidor de autenticação."}), 502

    if not resp.ok:
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        return jsonify({"error": data.get("detail", "Credenciais inválidas.")}), 401

    data = resp.json()
    groups = (data.get("user") or {}).get("groups") or []
    has_access = any(REQUIRED_GROUP.lower() in str(g).lower() for g in groups)
    if not has_access:
        return jsonify({"error": "Você não tem permissão para acessar este sistema."}), 403

    tokens = data.get("tokens") or {}
    user_data = data.get("user") or {}
    expires_in = tokens.get("expires_in", 1800)

    result = {
        "user": {
            "username": username,
            "name": user_data.get("name") or username,
            "email": user_data.get("email") or "",
            "department": user_data.get("department") or "",
        },
        "expiresIn": expires_in,
    }

    response = jsonify(result)
    set_auth_cookies(response, tokens.get("access_token", ""), tokens.get("refresh_token"), expires_in)
    return response


@bp.route("/api/auth/refresh", methods=["POST"])
def auth_refresh():
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        return jsonify({"error": "Sem refresh token"}), 401

    try:
        resp = http_requests.post(
            SSO_API + "/auth/refresh",
            json={"refresh_token": refresh_token},
            timeout=10,
        )
    except Exception:
        return jsonify({"error": "Erro ao conectar ao SSO"}), 502

    if not resp.ok:
        response = jsonify({"error": "Sessão expirada"})
        clear_auth_cookies(response)
        return response, 401

    data = resp.json()
    expires_in = data.get("expires_in", 1800)
    response = jsonify({"expiresIn": expires_in})
    set_auth_cookies(response, data.get("access_token", ""), data.get("refresh_token"), expires_in)
    return response


@bp.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    response = jsonify({"ok": True})
    clear_auth_cookies(response)
    return response


@bp.route("/api/auth/session", methods=["GET"])
def auth_session():
    token = request.cookies.get("access_token")
    if not token:
        return jsonify({"authenticated": False}), 401

    user = _validate_token(token)
    if not user:
        response = jsonify({"authenticated": False})
        clear_auth_cookies(response)
        return response, 401

    uname = user.get("username") or user.get("email") or user.get("name", "")
    return jsonify({
        "authenticated": True,
        "user": {
            "username": uname,
            "name": user.get("name", ""),
            "email": user.get("email", ""),
        },
        "role": get_user_role(uname),
    })
