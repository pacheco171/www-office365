"""Serviço de autenticação: validação de token SSO, roles e resolução de tenant."""

import os
import time
import threading
import logging
from hashlib import sha256

from flask import request

from app.config import (
    SSO_API, REQUIRED_GROUP, TOKEN_CACHE_TTL, DEFAULT_ROLE, _DEFAULT_ROLES,
    _COOKIE_OPTS, http_requests,
)
from app.utils import load_json_safe, tenant_path, TENANTS_CONFIG_FILE

log = logging.getLogger("graph-sync")

# ── Cache de tokens ────────────────────────────────────────────────────────────

_token_cache: dict = {}
_token_cache_lock = threading.Lock()
_token_inflight: dict = {}
_token_inflight_lock = threading.Lock()


# ── Validação de token via SSO ────────────────────────────────────────────────

def _validate_token(token: str):
    if not token:
        return None

    token_hash = sha256(token.encode()).hexdigest()

    with _token_cache_lock:
        cached = _token_cache.get(token_hash)
        if cached and cached["expires"] > time.time():
            return cached["user"]
        now = time.time()
        expired = [k for k, v in _token_cache.items() if v["expires"] <= now]
        for k in expired:
            del _token_cache[k]

    with _token_inflight_lock:
        if token_hash not in _token_inflight:
            _token_inflight[token_hash] = threading.Event()
        else:
            evt = _token_inflight[token_hash]
            evt.wait(timeout=12)
            with _token_cache_lock:
                cached = _token_cache.get(token_hash)
                if cached and cached["expires"] > time.time():
                    return cached["user"]
            return None

    try:
        return _do_validate_sso(token, token_hash)
    finally:
        with _token_inflight_lock:
            evt = _token_inflight.pop(token_hash, None)
            if evt:
                evt.set()


def _do_validate_sso(token: str, token_hash: str):
    if not http_requests:
        log.warning("Módulo requests não instalado — auth bypass")
        return None

    try:
        user = None

        resp = http_requests.get(
            SSO_API + "/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
        )
        log.debug("SSO /auth/me status=%s", resp.status_code)

        if resp.status_code == 200:
            data = resp.json()
            user = data.get("user", data) if isinstance(data, dict) else {"name": "authenticated"}

        if user is None:
            resp2 = http_requests.post(
                SSO_API + "/auth/refresh", json={"refresh_token": token}, timeout=8
            )
            log.debug("SSO /auth/refresh status=%s", resp2.status_code)
            if resp2.status_code == 200:
                user = {"name": "authenticated"}

        if user is None:
            log.warning("Token não validado pelo SSO (status=%s)", resp.status_code)
            return None

        groups = user.get("groups") or []
        if isinstance(groups, list) and len(groups) > 0:
            has_access = any(REQUIRED_GROUP.lower() in str(g).lower() for g in groups)
            if not has_access:
                log.warning("Token válido mas sem grupo %s: %s", REQUIRED_GROUP, user.get("name", "?"))
                return None
        elif os.environ.get("REQUIRE_AD_GROUP", "false").lower() in ("true", "1", "yes"):
            log.warning("SSO não retornou groups e REQUIRE_AD_GROUP está ativo — token recusado")
            return None

        with _token_cache_lock:
            _token_cache[token_hash] = {"user": user, "expires": time.time() + TOKEN_CACHE_TTL}
        return user

    except Exception as e:
        log.error("Erro ao validar token no SSO: %s", e)
        return None


def get_auth_token() -> str:
    """Extrai token do cookie HTTP-only ou header Authorization (fallback)."""
    token = request.cookies.get("access_token")
    if token:
        return token
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


# ── Cookies de autenticação ───────────────────────────────────────────────────

def set_auth_cookies(response, access_token: str, refresh_token: str = None, expires_in: int = 1800):
    response.set_cookie("access_token", access_token, max_age=expires_in, **_COOKIE_OPTS)
    if refresh_token:
        response.set_cookie("refresh_token", refresh_token, max_age=7 * 24 * 3600, **_COOKIE_OPTS)
    return response


def clear_auth_cookies(response):
    response.set_cookie("access_token", "", max_age=0, **_COOKIE_OPTS)
    response.set_cookie("refresh_token", "", max_age=0, **_COOKIE_OPTS)
    return response


# ── Tenants ────────────────────────────────────────────────────────────────────

def load_tenants_config() -> dict:
    return load_json_safe(TENANTS_CONFIG_FILE, {"tenants": {}, "global_admins": []})


def is_valid_tenant(slug: str) -> bool:
    cfg = load_tenants_config()
    t = cfg.get("tenants", {}).get(slug)
    return bool(t and t.get("active"))


def is_global_admin(username: str) -> bool:
    if not username:
        return False
    clean = username.split("@")[0].lower().strip()
    cfg = load_tenants_config()
    return clean in [g.lower() for g in cfg.get("global_admins", [])]


def resolve_tenant_id() -> str:
    cookie = request.cookies.get("active_tenant", "")
    if cookie and is_valid_tenant(cookie):
        return cookie
    host = request.host.split(":")[0]
    parts = host.split(".")
    if len(parts) >= 2:
        subdomain = parts[0]
        cfg = load_tenants_config()
        for tid, t in cfg.get("tenants", {}).items():
            if subdomain in t.get("subdomains", []) and t.get("active"):
                return tid
    cfg = load_tenants_config()
    default = cfg.get("default_tenant", "")
    if default and is_valid_tenant(default):
        return default
    for tid, t in cfg.get("tenants", {}).items():
        if t.get("active"):
            return tid
    return "live"


# ── Roles ─────────────────────────────────────────────────────────────────────

def get_user_role(username: str, tenant_id: str = "live") -> str:
    """Retorna a role do usuário (superadmin, admin, tecnico, gestor) para o tenant."""
    if not username:
        return DEFAULT_ROLE
    if is_global_admin(username):
        return "superadmin"
    roles = load_json_safe(tenant_path(tenant_id, "roles.json"), _DEFAULT_ROLES)
    clean = username.split("@")[0].lower().strip()
    return roles.get(clean, DEFAULT_ROLE)


def require_role(*allowed_roles) -> tuple | None:
    """Verifica se o usuário tem uma das roles permitidas. Retorna 403 se não."""
    from flask import jsonify
    role = getattr(request, "auth_role", DEFAULT_ROLE)
    if role not in allowed_roles:
        return jsonify({"error": "Sem permissão para esta ação"}), 403
    return None
