#!/usr/bin/env python3
"""Servidor do LIVE! M365 — serve arquivos estáticos + API de dados compartilhados + sync Graph API."""

import json
import os
from dotenv import load_dotenv

load_dotenv()
import re
import csv
import io
import tempfile
import threading
import time
import logging
import unicodedata
from datetime import datetime, timezone
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, abort, render_template, Response
import base64
from hashlib import sha256

try:
    from cryptography.fernet import Fernet, InvalidToken

    _HAS_FERNET = True
except ImportError:
    _HAS_FERNET = False

try:
    from flask_compress import Compress as _FlaskCompress
    _HAS_COMPRESS = True
except ImportError:
    _HAS_COMPRESS = False

try:
    import requests as _requests_mod
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    _retry_strategy = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "POST"],
    )
    _adapter = HTTPAdapter(
        pool_connections=10,
        pool_maxsize=20,
        max_retries=_retry_strategy,
    )
    http_requests = _requests_mod.Session()
    http_requests.mount("https://", _adapter)
    http_requests.mount("http://", _adapter)
except ImportError:
    http_requests = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TENANTS_DIR = os.path.join(BASE_DIR, "tenants")
TENANTS_CONFIG_FILE = os.path.join(BASE_DIR, "tenants.json")
PORT = 7319


def tenant_path(tenant_id: str, filename: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", tenant_id)
    return os.path.join(TENANTS_DIR, safe, filename)


# ── Criptografia de credenciais em disco ──────────────────────────────────────
def _derive_fernet_key():
    """Deriva uma chave Fernet para cifrar/decifrar secrets em disco.

    Prioridade:
    1. Variável de ambiente FERNET_KEY (mais seguro — recomendado em produção)
    2. Derivação determinística a partir de dados da máquina (fallback)

    Para gerar uma chave:
        python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    """
    env_key = os.environ.get("FERNET_KEY")
    if env_key:
        return env_key.encode() if isinstance(env_key, str) else env_key

    # Fallback: derivação determinística (menos seguro — usar apenas em dev)
    import socket
    material = f"{socket.getfqdn()}:{BASE_DIR}:m365-live-key".encode()
    raw = sha256(material).digest()
    return base64.urlsafe_b64encode(raw)


def encrypt_secret(plain: str) -> str:
    """Cifra um secret para armazenamento em disco. Retorna string 'enc:...'"""
    if not plain or not _HAS_FERNET:
        return plain
    f = Fernet(_derive_fernet_key())
    return "enc:" + f.encrypt(plain.encode()).decode()


def decrypt_secret(stored: str) -> str:
    """Decifra um secret armazenado. Aceita tanto 'enc:...' quanto texto puro (migração)."""
    if not stored:
        return ""
    if not stored.startswith("enc:"):
        return stored  # texto puro legado — será re-cifrado no próximo save
    if not _HAS_FERNET:
        return ""
    try:
        f = Fernet(_derive_fernet_key())
        return f.decrypt(stored[4:].encode()).decode()
    except (InvalidToken, Exception):
        return ""


# ── SSO / Auth ────────────────────────────────────────────────────────────────
SSO_API = os.environ.get("SSO_API", "https://sso.liveoficial.ind.br")
REQUIRED_GROUP = "Acesso Licencas 365 SSO"

log = logging.getLogger("graph-sync")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

app = Flask(__name__, static_folder=BASE_DIR)
if _HAS_COMPRESS:
    _FlaskCompress(app)

_tenant_locks: dict = {}
_tenant_locks_meta = threading.Lock()


def get_tenant_lock(tenant_id: str, name: str) -> threading.Lock:
    with _tenant_locks_meta:
        if tenant_id not in _tenant_locks:
            _tenant_locks[tenant_id] = {
                k: threading.Lock()
                for k in ("data", "changelog", "overrides", "hierarchy", "graph")
            }
        return _tenant_locks[tenant_id][name]

_token_cache = {}
_token_cache_lock = threading.Lock()
_token_inflight = {}
_token_inflight_lock = threading.Lock()
TOKEN_CACHE_TTL = 300

DEFAULT_DATA = {"db": [], "snapshots": [], "contracts": [], "acoes": [], "usage": {}, "fatura": []}


def load_json_safe(path, default):
    """Carrega JSON de forma segura, retornando default se falhar."""
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default() if callable(default) else default


# ── Roles / permissões ──────────────────────────────────────────────────────
# superadmin: acesso total (config, edição, tudo)
# admin: vê tudo + pode enviar sugestões de melhoria
# viewer: vê tudo, não edita config nem acessa
DEFAULT_ROLE = "viewer"
_DEFAULT_ROLES = {
    "enzzo.pacheco": "superadmin",
    "alex.fagundes": "superadmin",
    "douglas.preto": "superadmin",
}


def _get_user_role(username, tenant_id="live"):
    """Retorna a role do usuário (superadmin, admin, viewer) para o tenant."""
    if not username:
        return DEFAULT_ROLE
    if _is_global_admin(username):
        return "superadmin"
    roles = load_json_safe(tenant_path(tenant_id, "roles.json"), _DEFAULT_ROLES)
    clean = username.split("@")[0].lower().strip()
    return roles.get(clean, DEFAULT_ROLE)


def _load_tenants_config() -> dict:
    return load_json_safe(TENANTS_CONFIG_FILE, {"tenants": {}, "global_admins": []})


def _is_valid_tenant(slug: str) -> bool:
    cfg = _load_tenants_config()
    t = cfg.get("tenants", {}).get(slug)
    return bool(t and t.get("active"))


def _is_global_admin(username: str) -> bool:
    if not username:
        return False
    clean = username.split("@")[0].lower().strip()
    cfg = _load_tenants_config()
    return clean in [g.lower() for g in cfg.get("global_admins", [])]


def resolve_tenant_id() -> str:
    cookie = request.cookies.get("active_tenant", "")
    if cookie and _is_valid_tenant(cookie):
        return cookie
    host = request.host.split(":")[0]
    parts = host.split(".")
    if len(parts) >= 2:
        subdomain = parts[0]
        cfg = _load_tenants_config()
        for tid, t in cfg.get("tenants", {}).items():
            if subdomain in t.get("subdomains", []) and t.get("active"):
                return tid
    cfg = _load_tenants_config()
    default = cfg.get("default_tenant", "")
    if default and _is_valid_tenant(default):
        return default
    for tid, t in cfg.get("tenants", {}).items():
        if t.get("active"):
            return tid
    return "live"


# ── Middleware de autenticação ─────────────────────────────────────────────────
def _validate_token(token):
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


def _do_validate_sso(token, token_hash):
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
            if isinstance(data, dict):
                user = data.get("user", data)
            else:
                user = {"name": "authenticated"}

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
                log.warning(
                    "Token válido mas sem grupo %s: %s",
                    REQUIRED_GROUP,
                    user.get("name", "?"),
                )
                return None
        elif os.environ.get("REQUIRE_AD_GROUP", "false").lower() in ("true", "1", "yes"):
            log.warning("SSO não retornou groups e REQUIRE_AD_GROUP está ativo — token recusado")
            return None

        with _token_cache_lock:
            _token_cache[token_hash] = {
                "user": user,
                "expires": time.time() + TOKEN_CACHE_TTL,
            }
        return user

    except Exception as e:
        log.error("Erro ao validar token no SSO: %s", e)
        return None


def _get_auth_token():
    """Extrai token do cookie HTTP-only ou header Authorization (fallback)."""
    # Prioridade: cookie HTTP-only
    token = request.cookies.get("access_token")
    if token:
        return token
    # Fallback: header Authorization (compatibilidade)
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


# ── Cookie helpers ─────────────────────────────────────────────────────────────
_COOKIE_OPTS = {
    "httponly": True,
    "secure": os.environ.get("COOKIE_SECURE", "false").lower() in ("true", "1", "yes"),
    "samesite": "Lax",
    "path": "/",
}


def _set_auth_cookies(response, access_token, refresh_token=None, expires_in=1800):
    """Define cookies HTTP-only com os tokens."""
    from flask import make_response as _mr
    response.set_cookie("access_token", access_token, max_age=expires_in, **_COOKIE_OPTS)
    if refresh_token:
        # Refresh token dura 7 dias
        response.set_cookie("refresh_token", refresh_token, max_age=7 * 24 * 3600, **_COOKIE_OPTS)
    return response


def _clear_auth_cookies(response):
    """Remove cookies de autenticação."""
    response.set_cookie("access_token", "", max_age=0, **_COOKIE_OPTS)
    response.set_cookie("refresh_token", "", max_age=0, **_COOKIE_OPTS)
    return response


# ── Auth proxy endpoints ──────────────────────────────────────────────────────
AUTH_DOMAIN = "live.local"

# Rotas que não requerem autenticação (estáticos, login page, auth endpoints)
PUBLIC_PREFIXES = ("/login", "/src/", "/favicon", "/api/auth/")
PUBLIC_EXACT = {"/", "/login.html"}


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Proxy de login: autentica no SSO, valida grupo, seta cookies HTTP-only."""
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

    # Verifica grupo AD
    groups = (data.get("user") or {}).get("groups") or []
    has_access = any(REQUIRED_GROUP.lower() in str(g).lower() for g in groups)
    if not has_access:
        return jsonify({"error": "Você não tem permissão para acessar este sistema."}), 403

    tokens = data.get("tokens") or {}
    user_data = data.get("user") or {}
    expires_in = tokens.get("expires_in", 1800)

    # Resposta com dados NÃO-sensíveis (sem tokens)
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
    _set_auth_cookies(response, tokens.get("access_token", ""), tokens.get("refresh_token"), expires_in)
    return response


@app.route("/api/auth/refresh", methods=["POST"])
def auth_refresh():
    """Renova token usando refresh_token do cookie HTTP-only."""
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
        _clear_auth_cookies(response)
        return response, 401

    data = resp.json()
    expires_in = data.get("expires_in", 1800)

    response = jsonify({"expiresIn": expires_in})
    _set_auth_cookies(response, data.get("access_token", ""), data.get("refresh_token"), expires_in)
    return response


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """Limpa cookies de autenticação."""
    response = jsonify({"ok": True})
    _clear_auth_cookies(response)
    return response


@app.route("/api/auth/session", methods=["GET"])
def auth_session():
    """Verifica se há sessão válida (token no cookie). Retorna dados do usuário."""
    token = request.cookies.get("access_token")
    if not token:
        return jsonify({"authenticated": False}), 401

    user = _validate_token(token)
    if not user:
        response = jsonify({"authenticated": False})
        _clear_auth_cookies(response)
        return response, 401

    uname = user.get("username") or user.get("email") or user.get("name", "")
    return jsonify({
        "authenticated": True,
        "user": {
            "username": uname,
            "name": user.get("name", ""),
            "email": user.get("email", ""),
        },
        "role": _get_user_role(uname),
    })


@app.before_request
def require_auth():
    """Middleware: exige token válido em todas as rotas /api/*."""
    path = request.path

    # Rotas públicas: estáticos e login
    if path in PUBLIC_EXACT:
        return None
    for prefix in PUBLIC_PREFIXES:
        if path.startswith(prefix):
            return None

    # Rotas /api/* exigem autenticação
    if path.startswith("/api/"):
        token = _get_auth_token()
        if not token:
            return jsonify({"error": "Token de autenticação não fornecido"}), 401
        user = _validate_token(token)
        if not user:
            return jsonify({"error": "Token inválido ou sem permissão"}), 403
        request.auth_user = user
        request.tenant_id = resolve_tenant_id()
        uname = user.get("username") or user.get("email") or user.get("name", "")
        request.auth_role = _get_user_role(uname, request.tenant_id)
        return None

    # Outros paths (estáticos HTML/JS/CSS) — permitir
    return None


def require_role(*allowed_roles):
    """Verifica se o usuário tem uma das roles permitidas. Retorna resposta 403 se não."""
    role = getattr(request, "auth_role", DEFAULT_ROLE)
    if role not in allowed_roles:
        return jsonify({"error": "Sem permissão para esta ação"}), 403
    return None


# ── Helpers ──────────────────────────────────────────────────────────────────
def normalize_email(email):
    """Normaliza email: lowercase + trim."""
    return (email or "").strip().lower()


# ── Validação de input ────────────────────────────────────────────────────────
_EMAIL_RE = re.compile(r"^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$")
_SAFE_TEXT_RE = re.compile(r"^[a-zA-Z0-9À-ÿ\s\-/&.!()çÇ]+$")
MAX_FIELD_LEN = 200


def validate_email_format(email):
    """Valida formato de email. Retorna email normalizado ou None."""
    email = normalize_email(email)
    if not email or len(email) > MAX_FIELD_LEN or not _EMAIL_RE.match(email):
        return None
    return email


def validate_text_field(val, field_name, max_len=MAX_FIELD_LEN):
    """Valida campo de texto: não vazio, tamanho limitado, sem caracteres perigosos."""
    if not val or not isinstance(val, str):
        return None, f'Campo "{field_name}" é obrigatório'
    val = val.strip()
    if len(val) > max_len:
        return None, f'Campo "{field_name}" excede {max_len} caracteres'
    # Bloquear null bytes e caracteres de controle
    if "\x00" in val or any(ord(c) < 32 and c not in ("\n", "\r", "\t") for c in val):
        return None, f'Campo "{field_name}" contém caracteres inválidos'
    return val, None


def save_json_atomic(path, data):
    """Grava JSON de forma atômica: escreve em temp e renomeia (evita corrupção)."""
    dir_name = os.path.dirname(path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp_path, path)  # atômico no mesmo filesystem
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def load_overrides(tenant_id="live"):
    return load_json_safe(tenant_path(tenant_id, "overrides.json"), {"overrides": {}})


def save_overrides(data, tenant_id="live"):
    with get_tenant_lock(tenant_id, "overrides"):
        save_json_atomic(tenant_path(tenant_id, "overrides.json"), data)


def apply_overrides(records, overrides_map):
    """Aplica setor/cargo fixo dos overrides nos registros.
    Override sobrescreve 'setor', 'tipo' e 'cargo' quando definidos."""
    for r in records:
        email = normalize_email(r.get("email", ""))
        ov = overrides_map.get(email)
        if ov and ov.get("fixo"):
            r["setor"] = ov["setor"]
            if ov.get("area"):
                r["area"] = ov["area"]
            if ov.get("subarea"):
                r["subarea"] = ov["subarea"]
            if "tipo" in ov:
                r["tipo"] = ov["tipo"]
            if "cargo" in ov and ov["cargo"]:
                r["cargo"] = ov["cargo"]
                r["cargoFixo"] = True
                r["cargoOrigem"] = "override"
            else:
                r["cargoFixo"] = False
            r["setorFixo"] = True
        else:
            r["setorFixo"] = False
            r["cargoFixo"] = False
    return records


def load_data(tenant_id="live"):
    return load_json_safe(
        tenant_path(tenant_id, "data.json"),
        lambda: {
            k: list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v
            for k, v in DEFAULT_DATA.items()
        },
    )


_data_response_cache = {}
_processed_rows_cache = {}

def _invalidate_data_cache(tenant_id="live"):
    _data_response_cache.pop(tenant_id, None)
    _boot_cache.pop(tenant_id, None)
    _processed_rows_cache.pop(tenant_id, None)

def save_data(data, tenant_id="live"):
    with get_tenant_lock(tenant_id, "data"):
        save_json_atomic(tenant_path(tenant_id, "data.json"), data)
    _invalidate_data_cache(tenant_id)


# ── API: info do usuário logado ──────────────────────────────────────────────
@app.route("/api/me", methods=["GET"])
def get_me():
    user = getattr(request, "auth_user", {})
    role = getattr(request, "auth_role", DEFAULT_ROLE)
    tid = getattr(request, "tenant_id", "live")
    uname = user.get("username") or user.get("email") or user.get("name", "")
    return jsonify(
        {
            "name": user.get("name", ""),
            "username": uname,
            "email": user.get("email", ""),
            "role": role,
            "tenant_id": tid,
            "global_admin": _is_global_admin(uname),
        }
    )


# ── API: anotações visuais (admin+ criam, superadmin gerencia) ───────────────


@app.route("/api/annotations", methods=["GET"])
def get_annotations():
    check = require_role("admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    data = load_json_safe(tenant_path(tid, "annotations.json"), [])
    return jsonify(data)


@app.route("/api/annotations", methods=["POST"])
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


@app.route("/api/annotations/<int:aid>", methods=["PATCH"])
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


@app.route("/api/annotations/<int:aid>", methods=["DELETE"])
def delete_annotation(aid):
    check = require_role("superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    ann_path = tenant_path(tid, "annotations.json")
    data = load_json_safe(ann_path, [])
    data = [a for a in data if a.get("id") != aid]
    save_json_atomic(ann_path, data)
    return jsonify({"ok": True})


def _backfill_lic(rec):
    """Recalcula licId/addons/custo a partir de licRaw para registros desatualizados."""
    lic_raw = rec.get("licRaw", "")
    if lic_raw:
        parts = [p.strip() for p in lic_raw.split("+")]
        addon_skus = {"pbi", "apps", "planner1", "planner3"}
        main_ids = set()
        addon_ids = set()
        for part in parts:
            upper = part.upper().replace(" ", "_")
            lid = SKU_MAP.get(upper)
            if not lid:
                lower = part.lower()
                for pattern, mapped_id in LIC_NAME_MAP:
                    if pattern in lower:
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
    rec["custo"] = _compute_cost(rec.get("licId", "none"), rec.get("addons"))


# ── API de dados compartilhados ────────────────────────────────────────────────
def _process_records(records, ov, area_to_macro, macro_set):
    for rec in records:
        if rec.get("setor"):
            rec["setor"] = _norm_setor(rec["setor"])
        _backfill_lic(rec)
        if "cargoOrigem" not in rec:
            rec["cargoOrigem"] = "fallback" if (rec.get("cargo") or "") == "Colaborador" else "ad"
        macro, hier_area = _resolve_hierarchy_server(
            rec.get("setor"), rec.get("area"), area_to_macro, macro_set)
        rec["macro"] = macro
        rec["hierArea"] = hier_area
    apply_overrides(records, ov)


def _get_processed_rows(tid):
    cached = _processed_rows_cache.get(tid)
    if cached is not None:
        return cached
    data = load_data(tid)
    hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
    hier = hier_data.get("hierarchy", {})
    area_to_macro, macro_set = _build_area_to_macro(hier)
    ov = load_overrides(tid).get("overrides", {})
    rows = data.get("db", [])
    _process_records(rows, ov, area_to_macro, macro_set)
    _processed_rows_cache[tid] = rows
    return rows


def _build_data_response(tid):
    data = load_data(tid)
    hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
    hier = hier_data.get("hierarchy", {})
    area_to_macro, macro_set = _build_area_to_macro(hier)
    ov = load_overrides(tid).get("overrides", {})
    _process_records(data.get("db", []), ov, area_to_macro, macro_set)
    for snap in data.get("snapshots", []):
        _process_records(snap.get("data", []), ov, area_to_macro, macro_set)
    resp_bytes = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    _data_response_cache[tid] = resp_bytes
    return resp_bytes


@app.route("/api/data", methods=["GET"])
def get_data():
    tid = getattr(request, "tenant_id", "live")
    cached = _data_response_cache.get(tid)
    if cached:
        return Response(cached, mimetype="application/json")
    return Response(_build_data_response(tid), mimetype="application/json")


_boot_cache = {}


def _invalidate_boot_cache(tenant_id="live"):
    _boot_cache.pop(tenant_id, None)


_LIC_CATALOG = [
    {"id": "none", "name": "Outros", "short": "Outros", "price": 0, "addon": False, "tier": "\u2014", "cls": "lic-none", "ico": "\u25cb", "color": "#8a8070", "csvNames": ["unlicensed"], "features": ["Sem acesso ao Microsoft 365"]},
    {"id": "bstd", "name": "M365 Business Standard", "short": "Business Standard", "price": 78.15, "addon": False, "tier": "Business", "cls": "lic-bstd", "ico": "\u25c9", "color": "#7a5c30", "csvNames": ["microsoft 365 business standard"], "features": ["Apps desktop completos", "Teams + Webinars", "Exchange 50 GB", "OneDrive 1 TB", "SharePoint"]},
    {"id": "bbasic", "name": "M365 Business Basic", "short": "Business Basic", "price": 31.21, "addon": False, "tier": "Business", "cls": "lic-bbasic", "ico": "\u25ce", "color": "#9c7a52", "csvNames": ["microsoft 365 business basic"], "features": ["Apps Office web e mobile", "Teams completo", "Exchange 50 GB", "OneDrive 1 TB", "SharePoint"]},
    {"id": "apps", "name": "M365 Apps for Business", "short": "Apps Business", "price": 51.54, "addon": True, "tier": "Add-on", "cls": "lic-apps", "ico": "\u25cd", "color": "#c97a20", "csvNames": ["microsoft 365 apps for business"], "features": ["Word/Excel/PowerPoint desktop", "OneDrive 1 TB", "Sem Exchange", "Sem Teams"]},
    {"id": "f3", "name": "Office 365 F3", "short": "O365 F3", "price": 25, "addon": False, "tier": "Frontline", "cls": "lic-f3", "ico": "\u25cc", "color": "#0078d4", "csvNames": ["office 365 f3"], "features": ["Apps web e mobile", "Teams Essentials", "Exchange 2 GB", "OneDrive 2 GB"]},
    {"id": "e3", "name": "Office 365 E3", "short": "O365 E3", "price": 90.29, "addon": False, "tier": "Enterprise", "cls": "lic-e3", "ico": "\u2b21", "color": "#3a7050", "csvNames": ["office 365 e3", "office 365 e3 (no teams)"], "features": ["Apps desktop ilimitados", "Teams Enterprise", "Exchange ilimitado", "Compliance e auditoria"]},
    {"id": "pbi", "name": "Power BI Pro", "short": "PBI Pro", "price": 87.55, "addon": True, "tier": "Add-on", "cls": "lic-pbi", "ico": "\u25c8", "color": "#b8903a", "csvNames": ["power bi pro", "power bi premium per user", "m 365 power bi pro"], "features": ["Dashboards compartilhados", "Relat\u00f3rios avan\u00e7ados", "API e embed"]},
    {"id": "planner1", "name": "Planner Plan 1", "short": "Planner 1", "price": 62.54, "addon": True, "tier": "Add-on", "cls": "lic-planner1", "ico": "\u25a3", "color": "#217346", "csvNames": ["planner plan 1"], "features": ["Planner Premium", "Gest\u00e3o de tarefas avan\u00e7ada", "Visualiza\u00e7\u00f5es de cronograma"]},
    {"id": "planner3", "name": "Planner and Project Plan 3", "short": "Planner+Project 3", "price": 187.55, "addon": True, "tier": "Add-on", "cls": "lic-planner3", "ico": "\u25a9", "color": "#1a5c30", "csvNames": ["planner and project plan 3", "project professional"], "features": ["Planner Premium", "Project Online", "Gest\u00e3o de projetos completa", "Relat\u00f3rios de portf\u00f3lio"]},
    {"id": "other", "name": "Outra Licen\u00e7a", "short": "Outro", "price": 0, "addon": False, "tier": "Outro", "cls": "lic-none", "ico": "\u25cb", "color": "#8a8070", "csvNames": [], "features": ["Licen\u00e7a n\u00e3o mapeada"]},
]


def _ensure_boot_cache(tid, uname):
    cached_boot = _boot_cache.get(tid)
    if cached_boot:
        return cached_boot
    ov = load_overrides(tid)
    hier = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
    subs = load_data(tid).get("subscriptions", [])
    cfg = _load_tenants_config()
    tenants_list = cfg.get("tenants", {})
    clean = uname.split("@")[0].lower().strip() if uname else ""
    if _is_global_admin(uname):
        t_result = [{"slug": s, "name": t.get("name", s), "active": t.get("active", False)} for s, t in tenants_list.items() if t.get("active")]
    else:
        t_result = []
        for s, t in tenants_list.items():
            if not t.get("active"):
                continue
            roles = load_json_safe(tenant_path(s, "roles.json"), {})
            if clean in [k.lower() for k in roles]:
                t_result.append({"slug": s, "name": t.get("name", s), "active": True})
    current_t = tenants_list.get(tid, {})
    tenants_obj = {"tenants": t_result, "current": tid, "current_name": current_t.get("name", tid)}
    _boot_cache[tid] = {
        "overrides": ov,
        "hierarchy": hier,
        "subscriptions": subs,
        "licenses": _LIC_CATALOG,
        "tenants": tenants_obj,
    }
    return _boot_cache[tid]


def _build_me_obj(user, uname, role):
    return {
        "name": user.get("name", ""),
        "username": uname,
        "role": role,
        "global_admin": _is_global_admin(uname),
    }


@app.route("/api/boot", methods=["GET"])
def api_boot():
    import time as _time
    t0 = _time.time()

    tid = getattr(request, "tenant_id", "live")
    user = getattr(request, "auth_user", {})
    uname = user.get("username") or user.get("email") or user.get("name", "")
    role = getattr(request, "auth_role", DEFAULT_ROLE)
    phase = request.args.get("phase", "")

    boot_parts = _ensure_boot_cache(tid, uname)
    me_obj = _build_me_obj(user, uname, role)

    if phase == "core":
        data = load_data(tid)
        hier = boot_parts["hierarchy"].get("hierarchy", {})
        area_to_macro, macro_set = _build_area_to_macro(hier)
        ov = boot_parts["overrides"].get("overrides", {})
        db_rows = data.get("db", [])
        _process_records(db_rows, ov, area_to_macro, macro_set)
        result = {
            "data": {"db": db_rows},
            "me": me_obj,
            "overrides": boot_parts["overrides"],
            "hierarchy": boot_parts["hierarchy"],
            "licenses": boot_parts["licenses"],
            "tenants": boot_parts["tenants"],
        }
        elapsed = round((_time.time() - t0) * 1000)
        app.logger.info("boot phase=core tenant=%s %dms", tid, elapsed)
        return jsonify(result)

    if phase == "history":
        data = load_data(tid)
        hier = boot_parts["hierarchy"].get("hierarchy", {})
        area_to_macro, macro_set = _build_area_to_macro(hier)
        ov = boot_parts["overrides"].get("overrides", {})
        for snap in data.get("snapshots", []):
            _process_records(snap.get("data", []), ov, area_to_macro, macro_set)
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
        elapsed = round((_time.time() - t0) * 1000)
        app.logger.info("boot phase=history tenant=%s %dms", tid, elapsed)
        return jsonify(result)

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

    body = b'{"data":' + (cached_data or b'{}') + b',"me":' + me_json.encode("utf-8") + b',' + static_json[1:].encode("utf-8")
    elapsed = round((_time.time() - t0) * 1000)
    app.logger.info("boot phase=full tenant=%s %dms", tid, elapsed)
    return Response(body, mimetype="application/json")


@app.route("/api/data", methods=["POST"])
def post_data():
    check = require_role("superadmin")
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


@app.route("/api/colaboradores", methods=["GET"])
def get_colaboradores():
    """Retorna colaboradores com paginação, filtros e ordenação server-side."""
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

    # Coletar filtros disponíveis (antes de filtrar)
    all_setores = sorted(set(r.get("setor", "") for r in rows if r.get("setor")))
    all_lics = sorted(set(r.get("licId", "") for r in rows if r.get("licId")))

    # Resolver nomes de licenças para busca textual
    lic_name_lookup = {l["id"]: (l["name"] + " " + l["short"]).lower() for l in [
        {"id": "none", "name": "Outros", "short": "Outros"},
        {"id": "bstd", "name": "M365 Business Standard", "short": "Business Standard"},
        {"id": "bbasic", "name": "M365 Business Basic", "short": "Business Basic"},
        {"id": "apps", "name": "M365 Apps for Business", "short": "Apps Business"},
        {"id": "f3", "name": "Office 365 F3", "short": "O365 F3"},
        {"id": "e3", "name": "Office 365 E3", "short": "O365 E3"},
        {"id": "pbi", "name": "Power BI Pro", "short": "PBI Pro"},
        {"id": "other", "name": "Outra Licença", "short": "Outro"},
    ]}

    # Filtrar
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
                (r.get("nome") or ""), (r.get("email") or ""),
                (r.get("setor") or ""), (r.get("area") or ""),
                (r.get("subarea") or ""), (r.get("cargo") or ""), lic_text
            ]).lower()
            if q not in txt:
                continue
        filtered.append(r)

    # Ordenar
    reverse = order == "desc"
    if sort_field == "custo":
        filtered.sort(key=lambda r: r.get("custo", 0), reverse=reverse)
    else:
        filtered.sort(key=lambda r: (r.get(sort_field) or "").lower() if isinstance(r.get(sort_field), str) else r.get(sort_field, ""), reverse=reverse)

    total = len(filtered)
    pages = max(1, -(-total // per))  # ceil division
    page = min(page, pages)
    start = (page - 1) * per
    page_rows = filtered[start:start + per]

    return jsonify({
        "rows": page_rows,
        "total": total,
        "page": page,
        "pages": pages,
        "filters": {
            "setores": all_setores,
            "licIds": all_lics,
        }
    })


@app.route("/api/licenses", methods=["GET"])
def get_licenses():
    """Retorna catálogo de licenças com preços, tiers e metadados."""
    licenses = [
        {"id": "none", "name": "Outros", "short": "Outros", "price": 0, "addon": False,
         "tier": "—", "cls": "lic-none", "ico": "○", "color": "#8a8070",
         "csvNames": ["unlicensed"], "features": ["Sem acesso ao Microsoft 365"]},
        {"id": "bstd", "name": "M365 Business Standard", "short": "Business Standard", "price": 78.15, "addon": False,
         "tier": "Business", "cls": "lic-bstd", "ico": "◉", "color": "#7a5c30",
         "csvNames": ["microsoft 365 business standard"], "features": ["Apps desktop completos", "Teams + Webinars", "Exchange 50 GB", "OneDrive 1 TB", "SharePoint"]},
        {"id": "bbasic", "name": "M365 Business Basic", "short": "Business Basic", "price": 31.21, "addon": False,
         "tier": "Business", "cls": "lic-bbasic", "ico": "◎", "color": "#9c7a52",
         "csvNames": ["microsoft 365 business basic"], "features": ["Apps Office web e mobile", "Teams completo", "Exchange 50 GB", "OneDrive 1 TB", "SharePoint"]},
        {"id": "apps", "name": "M365 Apps for Business", "short": "Apps Business", "price": 51.54, "addon": True,
         "tier": "Add-on", "cls": "lic-apps", "ico": "◍", "color": "#c97a20",
         "csvNames": ["microsoft 365 apps for business"], "features": ["Word/Excel/PowerPoint desktop", "OneDrive 1 TB", "Sem Exchange", "Sem Teams"]},
        {"id": "f3", "name": "Office 365 F3", "short": "O365 F3", "price": 25, "addon": False,
         "tier": "Frontline", "cls": "lic-f3", "ico": "◌", "color": "#0078d4",
         "csvNames": ["office 365 f3"], "features": ["Apps web e mobile", "Teams Essentials", "Exchange 2 GB", "OneDrive 2 GB"]},
        {"id": "e3", "name": "Office 365 E3", "short": "O365 E3", "price": 90.29, "addon": False,
         "tier": "Enterprise", "cls": "lic-e3", "ico": "⬡", "color": "#3a7050",
         "csvNames": ["office 365 e3", "office 365 e3 (no teams)"], "features": ["Apps desktop ilimitados", "Teams Enterprise", "Exchange ilimitado", "Compliance e auditoria"]},
        {"id": "pbi", "name": "Power BI Pro", "short": "PBI Pro", "price": 87.55, "addon": True,
         "tier": "Add-on", "cls": "lic-pbi", "ico": "◈", "color": "#b8903a",
         "csvNames": ["power bi pro", "power bi premium per user", "m 365 power bi pro"], "features": ["Dashboards compartilhados", "Relatórios avançados", "API e embed"]},
        {"id": "planner1", "name": "Planner Plan 1", "short": "Planner 1", "price": 62.54, "addon": True,
         "tier": "Add-on", "cls": "lic-planner1", "ico": "▣", "color": "#217346",
         "csvNames": ["planner plan 1"], "features": ["Planner Premium", "Gestão de tarefas avançada", "Visualizações de cronograma"]},
        {"id": "planner3", "name": "Planner and Project Plan 3", "short": "Planner+Project 3", "price": 187.55, "addon": True,
         "tier": "Add-on", "cls": "lic-planner3", "ico": "▩", "color": "#1a5c30",
         "csvNames": ["planner and project plan 3", "project professional"], "features": ["Planner Premium", "Project Online", "Gestão de projetos completa", "Relatórios de portfólio"]},
        {"id": "other", "name": "Outra Licença", "short": "Outro", "price": 0, "addon": False,
         "tier": "Outro", "cls": "lic-none", "ico": "○", "color": "#8a8070",
         "csvNames": [], "features": ["Licença não mapeada"]},
    ]
    return jsonify(licenses)


# ── API: fatura Microsoft (tabela editável) ─────────────────────────────────
@app.route("/api/fatura", methods=["POST"])
def post_fatura():
    """Salva linhas da fatura Microsoft."""
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


# ── API de overrides (setor fixo/manual) ───────────────────────────────────────
@app.route("/api/overrides", methods=["GET"])
def get_overrides():
    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "overrides"):
        return jsonify(load_overrides(tid))


@app.route("/api/overrides/<path:email>", methods=["PUT"])
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


@app.route("/api/overrides/<path:email>", methods=["DELETE"])
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


# ── API de hierarquia (estrutura organizacional) ──────────────────────────────
@app.route("/api/hierarchy", methods=["GET"])
def get_hierarchy():
    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "hierarchy"):
        return jsonify(load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}}))


@app.route("/api/hierarchy", methods=["POST"])
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
    return jsonify({"ok": True})


# ── API de changelog (arquivo separado) ────────────────────────────────────────
@app.route("/api/changelog", methods=["GET"])
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
    page_entries = entries[start:start + per]

    return jsonify({
        "entries": page_entries,
        "total": total,
        "page": page,
        "pages": pages,
    })


@app.route("/api/changelog", methods=["POST"])
def post_changelog():
    check = require_role("superadmin")
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


# ══════════ MICROSOFT GRAPH API — Sync automático ══════════════════════════════

_sync_threads: dict = {}
_sync_status: dict = {}
_server_start_time = time.time()

# Mapa de normalização de setores (mesmo do frontend)
SETOR_NORMALIZE = {
    "ecommerce": "E-commerce",
    "ECOMMERCE": "E-commerce",
    "e-commerce": "E-commerce",
    "Ecommerce": "E-commerce",
    "DISTRIBUICAO": "Distribuição",
    "Distribiuição": "Distribuição",
    "Distribuicao": "Distribuição",
    "DOBRACAO": "Dobração",
    "Dobracao": "Dobração",
    "ENGENHARIA": "Engenharia",
    "ENGENHARIA DE PROCESSOS": "Engenharia de Processos",
    "Engenharia Processos": "Engenharia de Processos",
    "Expedicao": "Expedição",
    "EXPEDICAO": "Expedição",
    "EXPEDIÇÃO": "Expedição",
    "Manutencao": "Manutenção",
    "MANUTENCAO": "Manutenção",
    "SUPERVISORES": "Supervisores",
    "MODELAGEM": "Modelagem",
    "EVENTOS": "Eventos",
    "EXPANSAO": "Expansão",
    "EXPORTACAO": "Exportação",
    "Logistica": "Logística",
    "LOGISTICA": "Logística",
    "Juridico": "Jurídico",
    "JURIDICO": "Jurídico",
    "Financeiro Lojas": "Financeiro",
    "Qualidade LIVE!": "Qualidade",
    "Depto Malharia": "Malharia",
    "Depto Recursos Humanos Varejo": "RH",
    "Diretoria Presidente": "Diretoria",
    "Acabamento Textil": "Acabamento Têxtil",
    "ACABAMENTO TEXTIL": "Acabamento Têxtil",
    "Textil": "Têxtil",
    "TEXTIL": "Têxtil",
    "Têxtil Seamless": "Têxtil",
    "Almoxarifado Tecidos": "Almoxarifado",
    "Expansao": "Expansão",
    "Gente Gestao": "Gente e Gestão",
    "Gente Gestão": "Gente e Gestão",
    "Exportacao": "Exportação",
    "Servicos": "Serviços",
    "Serviço": "Serviços",
    "PCP": "PPCP",
}

DEPT_SEPARATORS = [" - ", " / ", " > ", " | ", " \\ ", " – ", " — "]

# Regex para limpar sufixo de setor do Display Name
NAME_SUFFIX_RE = re.compile(
    r"^(.+?)\s+-\s+([A-ZÀ-ÚÇa-zà-úç][A-ZÀ-ÚÇa-zà-úç0-9&!.\- ]*?)$"
)
LOJA_RE = re.compile(r"^L\d{3}\b", re.IGNORECASE)

# Mapeamento de SKU IDs do M365 para nossos licId
# Fonte: https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference
SKU_MAP = {
    # Business
    "O365_BUSINESS_ESSENTIALS": "bbasic",
    "SMB_BUSINESS_ESSENTIALS": "bbasic",
    "O365_BUSINESS_PREMIUM": "bstd",
    "SMB_BUSINESS_PREMIUM": "bstd",
    "SPB": "bstd",  # Microsoft 365 Business Standard
    "O365_BUSINESS": "apps",
    "SMB_BUSINESS": "apps",
    # Frontline
    "DESKLESSPACK": "f3",  # Office 365 F3
    # Enterprise
    "ENTERPRISEPACK": "e3",  # Office 365 E3
    "ENTERPRISEPACK_NOTEAMS": "e3",
    "OFFICE_365_E3_(NO_TEAMS)": "e3",  # variante sem Teams
    # Add-ons pagos
    "POWER_BI_PRO": "pbi",
    "PBI_PREMIUM_PER_USER": "pbi",
    # Licenças gratuitas — ignorar (não contam como addon)
    "POWER_BI_STANDARD": "_free",  # Power BI Free
    "POWER_AUTOMATE_FREE": "_free",  # Power Automate Free
    "FLOW_FREE": "_free",  # Flow Free (mesmo que Power Automate Free)
    "MICROSOFT_FABRIC_FREE": "_free",  # Fabric Free
    "MICROSOFT_TEAMS_ENTERPRISE_NEW": "_free",  # Teams standalone (grátis com E3/F3)
    "AAD_PREMIUM": "_free",  # Azure AD Premium (incluído em planos)
    "EXCHANGEARCHIVE_ADDON": "_free",  # Exchange Archive (add-on gratuito)
    "PROJECTPROFESSIONAL": "planner3",  # Planner and Project Plan 3
    "PROJECT_P1": "planner1",  # Planner Plan 1
    "POWERAPPS_DEV": "_free",  # Power Apps Dev
    "CCIBOTS_PRIVPREV_VIRAL": "_free",  # Copilot bots preview
    "MICROSOFT_365_COPILOT": "_free",  # Copilot (trial/preview)
    "POWER_PAGES_VTRIAL_FOR_MAKERS": "_free",  # Power Pages trial
    "WACONEDRIVEENTERPRISE": "_free",  # OneDrive Enterprise (incluído)
}

# Mapeamento alternativo por substrings do nome da licença (fallback)
LIC_NAME_MAP = [
    ("business standard", "bstd"),
    ("business basic", "bbasic"),
    ("business essentials", "bbasic"),
    ("apps for business", "apps"),
    ("office 365 f3", "f3"),
    ("office 365 e3", "e3"),
    ("enterprise e3", "e3"),
    ("power bi pro", "pbi"),
    ("power bi premium", "pbi"),
    ("power bi (free)", "_free"),
    ("power automate free", "_free"),
    ("fabric (free)", "_free"),
    ("planner plan 1", "planner1"),
    ("planner and project plan 3", "planner3"),
    ("project professional", "planner3"),
]

LIC_PRIORITY = ["e3", "bstd", "bbasic", "f3", "apps", "pbi", "planner3", "planner1", "other", "none"]

LIC_PRICES = {
    "none": 0, "bstd": 78.15, "bbasic": 31.21, "apps": 51.54,
    "f3": 25, "e3": 90.29, "pbi": 87.55, "planner1": 62.54,
    "planner3": 187.55, "other": 0,
}


def _compute_cost(lic_id, addons):
    """Calcula custo mensal de um usuário (licença principal + add-ons pagos)."""
    cost = LIC_PRICES.get(lic_id, 0)
    for a in (addons or []):
        cost += LIC_PRICES.get(a, 0)
    return round(cost, 2)


def _build_area_to_macro(hierarchy):
    area_to_macro = {}
    macro_set = set()
    for macro, h in hierarchy.items():
        macro_set.add(macro)
        for a in (h.get("areas") or []):
            area_to_macro[a.lower()] = macro
        area_to_macro[macro.lower()] = macro
    return area_to_macro, macro_set


def _resolve_hierarchy_server(setor, area, area_to_macro, macro_set):
    setor = (setor or "Sem Setor").strip()
    if area and area.strip():
        return setor, area.strip()
    setor_lower = setor.lower()
    if setor_lower in area_to_macro:
        macro = area_to_macro[setor_lower]
        if setor_lower == macro.lower():
            return macro, "Geral"
        if setor in macro_set:
            return setor, "Geral"
        return macro, setor
    return setor, "Geral"


def load_graph_config(tenant_id="live"):
    cfg = load_json_safe(
        tenant_path(tenant_id, "graph_config.json"),
        {
            "tenant_id": "",
            "client_id": "",
            "client_secret": "",
            "domain": "liveoficial.com.br",
            "ou_root": "Setores",
            "auto_sync": False,
            "sync_interval_hours": 24,
        },
    )
    for field in ("client_secret", "tenant_id", "client_id"):
        if (
            cfg.get(field)
            and isinstance(cfg[field], str)
            and cfg[field].startswith("enc:")
        ):
            cfg[field] = decrypt_secret(cfg[field])
    suffix = "_" + tenant_id.upper()
    env_secret = os.environ.get("GRAPH_CLIENT_SECRET" + suffix, "") or os.environ.get("GRAPH_CLIENT_SECRET", "")
    if env_secret:
        cfg["client_secret"] = env_secret
    env_tenant = os.environ.get("GRAPH_TENANT_ID" + suffix, "") or os.environ.get("GRAPH_TENANT_ID", "")
    if env_tenant:
        cfg["tenant_id"] = env_tenant
    env_client = os.environ.get("GRAPH_CLIENT_ID" + suffix, "") or os.environ.get("GRAPH_CLIENT_ID", "")
    if env_client:
        cfg["client_id"] = env_client
    if cfg.get("ai_api_key") and isinstance(cfg["ai_api_key"], str) and cfg["ai_api_key"].startswith("enc:"):
        cfg["ai_api_key"] = decrypt_secret(cfg["ai_api_key"])
    env_ai = os.environ.get("ANTHROPIC_API_KEY" + suffix, "") or os.environ.get("ANTHROPIC_API_KEY", "")
    if env_ai:
        cfg["ai_api_key"] = env_ai
    return cfg


def save_graph_config(cfg, tenant_id="live"):
    safe_cfg = dict(cfg)
    suffix = "_" + tenant_id.upper()
    if os.environ.get("GRAPH_CLIENT_SECRET" + suffix) or os.environ.get("GRAPH_CLIENT_SECRET"):
        safe_cfg.pop("client_secret", None)
    if os.environ.get("GRAPH_TENANT_ID" + suffix) or os.environ.get("GRAPH_TENANT_ID"):
        safe_cfg.pop("tenant_id", None)
    if os.environ.get("GRAPH_CLIENT_ID" + suffix) or os.environ.get("GRAPH_CLIENT_ID"):
        safe_cfg.pop("client_id", None)
    if os.environ.get("ANTHROPIC_API_KEY" + suffix) or os.environ.get("ANTHROPIC_API_KEY"):
        safe_cfg.pop("ai_api_key", None)
    for field in ("client_secret", "tenant_id", "client_id", "ai_api_key"):
        if safe_cfg.get(field) and not safe_cfg[field].startswith("enc:"):
            safe_cfg[field] = encrypt_secret(safe_cfg[field])
    save_json_atomic(tenant_path(tenant_id, "graph_config.json"), safe_cfg)


def _norm_setor(s):
    """Normaliza nome de setor usando mapa de variantes conhecidas."""
    return SETOR_NORMALIZE.get(s, s)


IGNORED_OUS = {
    "usuarios", "usuários", "usuario", "usuário",
    "users", "user", "domain controllers", "computers",
    "builtin", "managed service accounts", "teste-cmd",
}


def _parse_ou_dn(dn, ou_root="Setores"):
    """Extrai setor (departamento) + area (sub-depto) + subarea do Distinguished Name do AD.

    Estrutura real do AD:
        CN=User,OU=Usuarios,OU=Desenvolvimento,OU=Administrativo,OU=Setores,OU=Live,DC=live,DC=local

    Etapas:
        1. Coleta todas as OUs (mais interno → mais externo)
        2. Ignora OUs genéricas (Usuarios, Users, etc.)
        3. Encontra ou_root ('Setores') e descarta tudo do root pra cima (inclusive 'Live')
        4. Descarta a OU de divisão (primeira abaixo do root, ex: 'Administrativo')
        5. O que sobra: departamento (setor), area (sub-depto) e subarea (equipe)

    Exemplos com ou_root='Setores':
        ...OU=Usuarios,OU=Desenvolvimento,OU=Administrativo,OU=Setores,OU=Live,...
            → setor='Desenvolvimento', area=None, subarea=None

        ...OU=Desenvolvimento,OU=Usuarios,OU=TI,OU=Administrativo,OU=Setores,OU=Live,...
            → setor='TI', area='Desenvolvimento', subarea=None

        ...OU=Desenvolvimento Web,OU=Inovacao,OU=Usuarios,OU=TI,OU=Administrativo,OU=Setores,OU=Live,...
            → setor='TI', area='Inovacao', subarea='Desenvolvimento Web'
    """
    if not dn:
        return None, None, None

    # Extrair todos os componentes OU do DN (ordem: mais interno → mais externo)
    ous = []
    for part in dn.split(","):
        part = part.strip()
        if part.upper().startswith("OU="):
            val = part[3:]
            if val.lower() not in IGNORED_OUS:
                ous.append(val)

    if not ous:
        return None, None, None

    # Encontrar ou_root no path e descartar tudo do root pra cima (inclusive)
    # Se ou_root NÃO está no DN, o usuário não pertence à árvore de setores → None
    ou_root_lower = (ou_root or "").lower()
    if ou_root_lower:
        root_idx = None
        for i in range(len(ous) - 1, -1, -1):
            if ous[i].lower() == ou_root_lower:
                root_idx = i
                break
        if root_idx is None:
            # Usuário fora da árvore de setores (Service Accounts, etc.)
            return None, None, None
        ous = ous[:root_idx]

    if not ous:
        return None, None, None

    # Descartar a OU de divisão (o nível mais externo restante, ex: 'Administrativo')
    # A divisão é o container organizacional logo abaixo do root.
    # Sempre remove o nível mais externo (divisão).
    ous = ous[:-1]  # remove divisão (mais externo)

    if not ous:
        return None, None, None

    # O que sobra: departamento (setor), area (sub-depto) e subarea (equipe)
    # ous está na ordem mais interno → mais externo
    if len(ous) == 1:
        return _norm_setor(ous[0]), None, None
    elif len(ous) == 2:
        setor = _norm_setor(ous[-1])  # mais externo = departamento
        area = ous[0]                 # mais interno = sub-departamento
        return setor, area, None
    else:
        # 3+ níveis: mantém a estrutura completa do AD
        # Ex: OU=Infraestrutura,OU=Inovacao,...,OU=TI → setor=TI, area=Inovacao, subarea=Infraestrutura
        setor = _norm_setor(ous[-1])  # mais externo = departamento
        area = ous[-2]               # segundo nível = sub-grupo (ex: Inovacao)
        subarea = ous[0]             # mais interno = equipe específica
        return setor, area, subarea


def _parse_dept(dept):
    """Extrai setor macro + area de uma string Department (fallback)."""
    if not dept:
        return "Sem Setor", None
    dept = dept.strip()
    for sep in DEPT_SEPARATORS:
        pos = dept.find(sep)
        if pos > 0:
            macro = dept[:pos].strip()
            area = dept[pos + len(sep) :].strip()
            if macro and area:
                return _norm_setor(macro), area
    return _norm_setor(dept), None


def _clean_display_name(name):
    """Remove sufixo ' - Setor' do Display Name do AD."""
    if not name:
        return name, None
    if LOJA_RE.match(name) or "Placa:" in name:
        return name, None
    m = NAME_SUFFIX_RE.match(name)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return name, None


def _resolve_lic(assigned_licenses, sku_names):
    """Resolve licId principal + addons a partir dos dados do Graph."""
    addon_ids = set()
    main_ids = set()
    addon_skus = {"pbi", "apps", "planner1", "planner3"}  # Add-ons pagos reais

    for sku in sku_names:
        sku_upper = sku.upper().replace(" ", "_")
        lid = SKU_MAP.get(sku_upper)
        if not lid:
            sku_lower = sku.lower()
            for pattern, mapped_id in LIC_NAME_MAP:
                if pattern in sku_lower:
                    lid = mapped_id
                    break
        if not lid or lid == "_free":
            continue  # Ignorar licenças gratuitas (Power BI Free, Flow Free, etc.)
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

    return lic_id, list(addon_ids), " + ".join(sku_names)


def _build_subscriptions(skus):
    """Extrai dados de assinatura (contratadas, consumidas) de subscribedSkus."""
    subs = []
    for s in skus:
        part = s.get("skuPartNumber", "").upper()
        lid = SKU_MAP.get(part)
        if not lid or lid == "_free":
            continue
        prep = s.get("prepaidUnits", {})
        subs.append({
            "skuId": s.get("skuId", ""),
            "skuPartNumber": s.get("skuPartNumber", ""),
            "licId": lid,
            "enabled": prep.get("enabled", 0),
            "suspended": prep.get("suspended", 0),
            "warning": prep.get("warning", 0),
            "consumed": s.get("consumedUnits", 0),
        })
    return subs


def _classify_account(nome, email):
    """Classifica conta como Pessoa, Loja, Compartilhado, Sala ou Servico."""
    import re as _re

    prefix = email.split("@")[0]
    nome_l = (nome or "").lower()
    if _re.match(r"^L\d{3}\b", nome or ""):
        return "Loja"
    if "sala " in nome_l or nome_l.startswith("sala"):
        return "Sala"
    if "live!" in nome_l:
        return "Compartilhado"
    for kw in (
        "agenda ",
        "scanner",
        "impressora",
        "fax",
        "noreply",
        "no-reply",
        "alertas ",
        "carro ",
    ):
        if kw in nome_l:
            return "Servico"
    if "." not in prefix and " " not in (nome or "").strip():
        return "Compartilhado"
    if " " not in (nome or "").strip():
        return "Compartilhado"
    return "Pessoa"


def _process_graph_user(u, sku_id_to_name, ou_root="Setores"):
    """Processa um usuário do Graph API e retorna dict com dados normalizados.

    Extrai nome (limpa sufixo AD), setor/area (via OU do AD).
    O AD é a fonte da verdade para setores — sem fallback para department
    ou sufixo do nome, que geravam setores lixo.
    Retorna None se o usuário deve ser ignorado (externo ou sem email).
    """
    email = (u.get("userPrincipalName") or "").lower().strip()
    if not email or "#ext#" in email:
        return None

    raw_name = u.get("displayName") or email.split("@")[0]
    nome, name_suffix = _clean_display_name(raw_name)

    # Fonte única: OU do Distinguished Name do AD
    dn = u.get("onPremisesDistinguishedName") or ""
    ou_setor, ou_area, ou_subarea = _parse_ou_dn(dn, ou_root)

    # AD é a fonte da verdade — sem DN válido, fica como 'Sem Setor'
    if ou_setor:
        setor, area, subarea = ou_setor, ou_area, ou_subarea
    else:
        setor, area, subarea = "Sem Setor", None, None

    _raw_job = (u.get("jobTitle") or "").strip()
    cargo = _raw_job or "Colaborador"
    cargo_origem = "ad" if _raw_job else "fallback"
    enabled = u.get("accountEnabled", True)
    status = "Ativo" if enabled else "Inativo"

    # Resolver licenças
    assigned = u.get("assignedLicenses") or []
    sku_names = [sku_id_to_name.get(a["skuId"], "") for a in assigned if a.get("skuId")]
    sku_names = [n for n in sku_names if n]
    lic_id, addons, lic_raw = _resolve_lic(assigned, sku_names)

    tipo = _classify_account(nome, email)

    return {
        "email": email,
        "nome": nome,
        "setor": setor,
        "area": area,
        "subarea": subarea,
        "cargo": cargo,
        "cargoOrigem": cargo_origem,
        "status": status,
        "lic_id": lic_id,
        "addons": addons,
        "lic_raw": lic_raw,
        "ou_setor": ou_setor,
        "ou_area": ou_area,
        "ou_subarea": ou_subarea,
        "enabled": enabled,
        "created": u.get("createdDateTime", ""),
        "dn": dn,
        "tipo": tipo,
    }


def _get_csv_field(row, *field_names):
    """Busca campo no dict do CSV, tentando várias variantes de nome (case-insensitive)."""
    for name in field_names:
        val = row.get(name) or row.get(name.lower())
        if val:
            return val.strip()
    return ""


def graph_get_token(cfg):
    """Obtém access token via client credentials flow."""
    if not http_requests:
        raise RuntimeError("Módulo requests não instalado")
    url = f"https://login.microsoftonline.com/{cfg['tenant_id']}/oauth2/v2.0/token"
    resp = http_requests.post(
        url,
        data={
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


_GRAPH_LANG_HEADERS = {"Accept-Language": "pt-BR", "Prefer": 'outlook.language="pt-BR"'}


def graph_get_paginated(token, url, params=None):
    """Faz GET paginado no Graph API."""
    headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual", **_GRAPH_LANG_HEADERS}
    results = []
    while url:
        resp = http_requests.get(url, headers=headers, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
        params = None  # nextLink já inclui params
    return results


def graph_get_simple(token, url):
    """GET simples no Graph API (sem paginação, sem ConsistencyLevel)."""
    headers = {"Authorization": f"Bearer {token}", **_GRAPH_LANG_HEADERS}
    resp = http_requests.get(url, headers=headers, timeout=60)
    if not resp.ok:
        log.error("Graph API erro %s %s: %s", resp.status_code, url, resp.text[:500])
    resp.raise_for_status()
    data = resp.json()
    return data.get("value", data if isinstance(data, list) else [])


def graph_get_csv_report(token, url):
    """Baixa relatório CSV do Graph API e retorna lista de dicts (um por linha).

    Não envia Accept-Language para garantir cabeçalhos em inglês (nomes de colunas
    são localizados pelo Graph quando Accept-Language é enviado, quebrando o parsing).
    """
    headers = {"Authorization": f"Bearer {token}"}
    resp = http_requests.get(url, headers=headers, timeout=120)
    resp.raise_for_status()
    text = resp.text.lstrip("\ufeff")
    lines = text.splitlines()
    while lines and "," not in lines[0]:
        lines.pop(0)
    if not lines:
        return []
    return list(csv.DictReader(io.StringIO("\n".join(lines))))


def do_graph_sync(cfg=None, tenant_id="live"):
    """Executa sincronização completa com Graph API."""
    global _sync_status
    status = _sync_status.setdefault(tenant_id, {"running": False, "lastSync": None, "lastError": None, "lastResult": None})
    if status["running"]:
        return {"error": "Sync já em execução"}

    status["running"] = True
    status["lastError"] = None
    start = time.time()

    try:
        if not cfg:
            cfg = load_graph_config(tenant_id)
        if (
            not cfg.get("tenant_id")
            or not cfg.get("client_id")
            or not cfg.get("client_secret")
        ):
            raise ValueError("Credenciais Azure não configuradas")

        domain = cfg.get("domain", "liveoficial.com.br")
        log.info("Iniciando sync Graph API para domínio %s", domain)

        token = graph_get_token(cfg)
        log.info("Token obtido com sucesso")

        # ── 1. Buscar usuários com licenças ──
        users = graph_get_paginated(
            token,
            "https://graph.microsoft.com/v1.0/users",
            {
                "$select": "id,displayName,userPrincipalName,department,jobTitle,accountEnabled,assignedLicenses,createdDateTime,onPremisesDistinguishedName",
                "$top": "999",
                "$filter": f"endsWith(userPrincipalName,'@{domain}')",
            },
        )
        log.info("Obtidos %d usuários do Graph", len(users))

        # Buscar nomes das SKUs para resolver licenças
        skus = graph_get_simple(
            token, "https://graph.microsoft.com/v1.0/subscribedSkus"
        )
        sku_id_to_name = {s["skuId"]: s["skuPartNumber"] for s in skus}

        # Extrair dados de assinatura (contratadas, consumidas) para cada SKU
        subscriptions = _build_subscriptions(skus)

        # ── 2. Montar registros ──
        ou_root = cfg.get("ou_root", "Setores")
        now_iso = datetime.now(timezone.utc).isoformat()
        now_date = now_iso[:10]
        records = []
        discovered_hierarchy = {}  # macro -> { area: set(subareas) }

        for u in users:
            result = _process_graph_user(u, sku_id_to_name, ou_root)
            if not result:
                continue

            created = result["created"]
            data_iso = created[:10] if created else now_date
            demissao = now_date if not result["enabled"] else None

            # Registrar hierarquia descoberta via OU (normalizada)
            ou_s = result["ou_setor"]
            ou_a = result["ou_area"]
            ou_sa = result.get("ou_subarea")
            if ou_s:
                ou_s = _norm_setor(ou_s)
                if ou_s not in discovered_hierarchy:
                    discovered_hierarchy[ou_s] = {}
                if ou_a:
                    # Filtrar áreas que são OUs genéricas que escaparam do filtro
                    if ou_a.lower() not in IGNORED_OUS:
                        if ou_a not in discovered_hierarchy[ou_s]:
                            discovered_hierarchy[ou_s][ou_a] = set()
                        if ou_sa and ou_sa.lower() not in IGNORED_OUS:
                            discovered_hierarchy[ou_s][ou_a].add(ou_sa)

            records.append(
                {
                    "id": hash(result["email"]) & 0x7FFFFFFF,
                    "nome": result["nome"],
                    "email": result["email"],
                    "setor": result["setor"],
                    "area": result["area"],
                    "subarea": result.get("subarea"),
                    "cargo": result["cargo"],
                    "cargoOrigem": result.get("cargoOrigem", "ad"),
                    "licId": result["lic_id"],
                    "addons": result["addons"],
                    "licRaw": result["lic_raw"],
                    "status": result["status"],
                    "dataISO": data_iso,
                    "demissao": demissao,
                    "setorFixo": False,
                    "cargoFixo": False,
                    "dn": result.get("dn", ""),
                    "tipo": result.get("tipo", "Pessoa"),
                }
            )

        log.info("Montados %d registros de usuários", len(records))

        # ── 2b. Auto-atualizar hierarquia com OUs descobertas ──
        if discovered_hierarchy:
            with get_tenant_lock(tenant_id, "hierarchy"):
                hier_data = load_json_safe(tenant_path(tenant_id, "hierarchy.json"), {"hierarchy": {}})
                hier = hier_data.get("hierarchy", {})
                updated = False
                for macro, area_map in discovered_hierarchy.items():
                    areas_set = set(area_map.keys())
                    # Construir subareas dict
                    subareas = {}
                    for area_name, subs in area_map.items():
                        if subs:
                            subareas[area_name] = sorted(subs)
                    if macro not in hier:
                        hier[macro] = {
                            "areas": sorted(areas_set),
                            "subareas": subareas,
                            "manual": False,
                            "source": "ad",
                        }
                        updated = True
                    else:
                        # Para setores AD (não-manuais), substituir áreas
                        # para limpar dados obsoletos
                        if not hier[macro].get("manual"):
                            if set(hier[macro].get("areas", [])) != areas_set:
                                hier[macro]["areas"] = sorted(areas_set)
                                updated = True
                            # Substituir subareas
                            if hier[macro].get("subareas", {}) != subareas:
                                hier[macro]["subareas"] = subareas
                                updated = True
                        else:
                            # Para manuais, apenas adicionar novas
                            existing = set(hier[macro].get("areas", []))
                            new_areas = areas_set - existing
                            if new_areas:
                                hier[macro]["areas"] = sorted(existing | areas_set)
                                updated = True
                            existing_subs = hier[macro].get("subareas", {})
                            for area_name, subs in subareas.items():
                                ex = set(existing_subs.get(area_name, []))
                                new_subs = set(subs) - ex
                                if new_subs:
                                    existing_subs[area_name] = sorted(ex | set(subs))
                                    updated = True
                            hier[macro]["subareas"] = existing_subs
                        if not hier[macro].get("source"):
                            hier[macro]["source"] = "ad"
                            updated = True
                if updated:
                    hier_data["hierarchy"] = hier
                    save_json_atomic(tenant_path(tenant_id, "hierarchy.json"), hier_data)
                    log.info(
                        "Hierarquia atualizada com %d setores do AD",
                        len(discovered_hierarchy),
                    )

        # ── 2c. Pré-computar custo nos registros ──
        for rec in records:
            rec["custo"] = _compute_cost(rec["licId"], rec["addons"])

        # ── 3. Buscar relatórios de uso (mailbox + OneDrive) ──
        usage = {}
        try:
            mailbox_rows = graph_get_csv_report(
                token,
                "https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D30')",
            )
            for row in mailbox_rows:
                mail = _get_csv_field(row, "User Principal Name").lower().strip()
                if not mail:
                    continue
                entry = usage.setdefault(mail, {"importedAt": now_iso})
                storage = _get_csv_field(row, "Storage Used (Byte)")
                if storage:
                    try:
                        entry["mailboxMB"] = round(int(storage) / 1048576, 1)
                    except (ValueError, TypeError):
                        pass
                items = _get_csv_field(row, "Item Count")
                if items:
                    try:
                        entry["mailboxItems"] = int(items)
                    except (ValueError, TypeError):
                        pass
                last_act = _get_csv_field(row, "Last Activity Date")
                if last_act and last_act.lower() != "never":
                    entry["lastActivity"] = last_act
            log.info("Mailbox usage: %d registros", len(mailbox_rows))
        except Exception as e:
            log.warning("Falha ao obter mailbox usage: %s", e)

        try:
            od_rows = graph_get_csv_report(
                token,
                "https://graph.microsoft.com/v1.0/reports/getOneDriveUsageAccountDetail(period='D30')",
            )
            for row in od_rows:
                mail = _get_csv_field(row, "Owner Principal Name").lower().strip()
                if not mail:
                    continue
                entry = usage.setdefault(mail, {"importedAt": now_iso})
                storage = _get_csv_field(row, "Storage Used (Byte)")
                if storage:
                    try:
                        entry["onedriveMB"] = round(int(storage) / 1048576, 1)
                    except (ValueError, TypeError):
                        pass
                files = _get_csv_field(row, "File Count")
                if files:
                    try:
                        entry["onedriveFiles"] = int(files)
                    except (ValueError, TypeError):
                        pass
            log.info("OneDrive usage: %d registros", len(od_rows))
        except Exception as e:
            log.warning("Falha ao obter OneDrive usage: %s", e)

        # M365 Apps usage (quem usa desktop, web, mobile)
        try:
            apps_rows = graph_get_csv_report(
                token,
                "https://graph.microsoft.com/v1.0/reports/getM365AppUserDetail(period='D30')",
            )
            for row in apps_rows:
                mail = _get_csv_field(row, "User Principal Name").lower().strip()
                if not mail:
                    continue
                entry = usage.setdefault(mail, {"importedAt": now_iso})
                # Uso por plataforma (Yes/No)
                entry["appsDesktop"] = (
                    _get_csv_field(row, "Windows").lower() == "yes"
                    or _get_csv_field(row, "Mac").lower() == "yes"
                )
                entry["appsWeb"] = _get_csv_field(row, "Web").lower() == "yes"
                entry["appsMobile"] = _get_csv_field(row, "Mobile").lower() == "yes"
                # Detalhamento: quais apps no desktop
                desktop_apps = []
                for app in [
                    "Outlook",
                    "Word",
                    "Excel",
                    "PowerPoint",
                    "OneNote",
                    "Teams",
                ]:
                    if (
                        _get_csv_field(row, f"{app} (Windows)").lower() == "yes"
                        or _get_csv_field(row, f"{app} (Mac)").lower() == "yes"
                    ):
                        desktop_apps.append(app)
                if desktop_apps:
                    entry["desktopApps"] = desktop_apps
            log.info("M365 Apps usage: %d registros", len(apps_rows))
        except Exception as e:
            log.warning("Falha ao obter M365 Apps usage: %s", e)

        # ── 4. Salvar dados ──
        now = datetime.now(timezone.utc)
        mes = now.month
        ano = now.year
        meses = [
            "",
            "Jan",
            "Fev",
            "Mar",
            "Abr",
            "Mai",
            "Jun",
            "Jul",
            "Ago",
            "Set",
            "Out",
            "Nov",
            "Dez",
        ]
        label = f"{meses[mes]}/{ano}"

        data = load_data(tenant_id)

        old_demissao = {}
        snapshots_sorted = sorted(
            data.get("snapshots", []),
            key=lambda s: (s.get("ano", 0), s.get("mes", 0)),
        )
        for snap in snapshots_sorted:
            for r in snap.get("data", []):
                em = (r.get("email") or "").lower()
                if em and r.get("demissao") and r.get("status") == "Inativo":
                    if em not in old_demissao:
                        old_demissao[em] = r["demissao"]

        old_db = data.get("db", []) if isinstance(data, dict) else data
        for r in (old_db if isinstance(old_db, list) else []):
            em = (r.get("email") or "").lower()
            if em and r.get("demissao"):
                if em not in old_demissao or r["demissao"] < old_demissao[em]:
                    old_demissao[em] = r["demissao"]

        for rec in records:
            if rec.get("demissao"):
                em = (rec.get("email") or "").lower()
                if em in old_demissao:
                    rec["demissao"] = old_demissao[em]

        with get_tenant_lock(tenant_id, "overrides"):
            ov = load_overrides(tenant_id).get("overrides", {})
        apply_overrides(records, ov)

        with get_tenant_lock(tenant_id, "hierarchy"):
            hier_data = load_json_safe(tenant_path(tenant_id, "hierarchy.json"), {"hierarchy": {}})
            hier = hier_data.get("hierarchy", {})
        area_to_macro, macro_set = _build_area_to_macro(hier)
        for rec in records:
            macro, hier_area = _resolve_hierarchy_server(
                rec["setor"], rec.get("area"), area_to_macro, macro_set
            )
            rec["macro"] = macro
            rec["hierArea"] = hier_area

        data["db"] = records

        snap_idx = None
        for i, s in enumerate(data.get("snapshots", [])):
            if s.get("mes") == mes and s.get("ano") == ano:
                snap_idx = i
                break
        snap = {
            "mes": mes,
            "ano": ano,
            "label": label,
            "data": [dict(r) for r in records],
        }
        if snap_idx is not None:
            data["snapshots"][snap_idx] = snap
        else:
            data.setdefault("snapshots", []).append(snap)
        data["snapshots"].sort(key=lambda s: (s.get("ano", 0), s.get("mes", 0)))

        if old_demissao:
            for s in data.get("snapshots", []):
                for r in s.get("data", []):
                    if r.get("status") == "Inativo" and r.get("demissao"):
                        em = (r.get("email") or "").lower()
                        if em in old_demissao and old_demissao[em] < r["demissao"]:
                            r["demissao"] = old_demissao[em]

        data["usage"] = usage
        data["subscriptions"] = subscriptions
        save_data(data, tenant_id)

        elapsed = round(time.time() - start, 1)
        ou_count = len(discovered_hierarchy)
        ou_areas = sum(len(a) for a in discovered_hierarchy.values())
        result = {
            "users": len(records),
            "mailbox_usage": len([u for u in usage.values() if "mailboxMB" in u]),
            "onedrive_usage": len([u for u in usage.values() if "onedriveMB" in u]),
            "ad_setores": ou_count,
            "ad_areas": ou_areas,
            "snapshot": label,
            "elapsed_seconds": elapsed,
        }
        status["lastSync"] = now_iso
        status["lastResult"] = result
        log.info("Sync concluído em %.1fs: %s", elapsed, result)
        return result

    except Exception as e:
        status["lastError"] = "Falha na sincronização. Verifique os logs."
        log.exception("Erro no sync")
        return {"error": "Falha na sincronização"}
    finally:
        status["running"] = False


def _auto_sync_loop(tenant_id="live"):
    while True:
        cfg = load_graph_config(tenant_id)
        if not cfg.get("auto_sync"):
            time.sleep(60)
            continue
        interval = max(cfg.get("sync_interval_hours", 24), 1) * 3600
        status = _sync_status.get(tenant_id, {})
        last = status.get("lastSync")
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
                if elapsed < interval:
                    time.sleep(min(interval - elapsed, 300))
                    continue
            except Exception:
                pass
        log.info("Auto-sync iniciado para tenant %s", tenant_id)
        do_graph_sync(cfg, tenant_id)
        time.sleep(300)


# ── Endpoints Graph API ──


@app.route("/api/graph/config", methods=["GET"])
def get_graph_config():
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)

    def _mask(val):
        if not val:
            return ""
        if len(val) > 8:
            return val[:4] + "*" * (len(val) - 8) + val[-4:]
        return "****"

    cfg["client_secret_masked"] = _mask(cfg.get("client_secret", ""))
    cfg["tenant_id_masked"] = _mask(cfg.get("tenant_id", ""))
    cfg["client_id_masked"] = _mask(cfg.get("client_id", ""))
    cfg["ai_api_key_masked"] = _mask(cfg.get("ai_api_key", ""))

    cfg.pop("client_secret", None)
    cfg.pop("tenant_id", None)
    cfg.pop("client_id", None)
    cfg.pop("ai_api_key", None)

    cfg["status"] = _sync_status.get(tid, {"running": False, "lastSync": None, "lastError": None, "lastResult": None})
    return jsonify(cfg)


@app.route("/api/graph/config", methods=["POST"])
def post_graph_config():
    check = require_role("superadmin")
    if check:
        return check
    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "payload inválido"}), 400
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    for key in [
        "tenant_id",
        "client_id",
        "client_secret",
        "domain",
        "ou_root",
        "auto_sync",
        "sync_interval_hours",
    ]:
        if key in payload:
            cfg[key] = payload[key]
    save_graph_config(cfg, tid)
    _ensure_sync_thread(tid)
    return jsonify({"ok": True})


@app.route("/api/subscriptions", methods=["GET"])
def get_subscriptions():
    tid = getattr(request, "tenant_id", "live")
    data = load_data(tid)
    subs = data.get("subscriptions", [])
    if not subs:
        try:
            cfg = load_graph_config(tid)
            if (
                cfg.get("tenant_id")
                and cfg.get("client_id")
                and cfg.get("client_secret")
            ):
                token = graph_get_token(cfg)
                skus = graph_get_simple(
                    token, "https://graph.microsoft.com/v1.0/subscribedSkus"
                )
                subs = _build_subscriptions(skus)
                data = load_data(tid)
                data["subscriptions"] = subs
                save_data(data, tid)
        except Exception as e:
            log.warning("Falha ao buscar subscriptions do Azure: %s", e)
    return jsonify(subs)


@app.route("/api/graph/sync", methods=["POST"])
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


@app.route("/api/graph/status", methods=["GET"])
def get_sync_status():
    tid = getattr(request, "tenant_id", "live")
    return jsonify(_sync_status.get(tid, {"running": False, "lastSync": None, "lastError": None, "lastResult": None}))


@app.route("/api/graph/remap-setores", methods=["POST"])
def remap_setores():
    """Busca DNs via Graph API e reprocessa setores de todos os usuários.

    Não altera licenças/status — apenas setor e area com base no DN atualizado.
    Respeita overrides fixos (setorFixo=true).
    """
    check = require_role("superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    if (
        not cfg.get("tenant_id")
        or not cfg.get("client_id")
        or not cfg.get("client_secret")
    ):
        return jsonify({"error": "Credenciais Azure não configuradas"}), 400

    try:
        domain = cfg.get("domain", "liveoficial.com.br")
        ou_root = cfg.get("ou_root", "Setores")
        token = graph_get_token(cfg)

        # Buscar apenas email + DN de todos os usuários
        users = graph_get_paginated(
            token,
            "https://graph.microsoft.com/v1.0/users",
            {
                "$select": "userPrincipalName,onPremisesDistinguishedName,department,displayName",
                "$top": "999",
                "$filter": f"endsWith(userPrincipalName,'@{domain}')",
            },
        )

        # Montar mapa email -> (setor, area) a partir do DN
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
                # Fallback: campo Department
                dept = u.get("department") or ""
                dept_setor, dept_area = _parse_dept(dept)
                if dept_setor and dept_setor != "Sem Setor":
                    dn_map[email] = {"setor": dept_setor, "area": dept_area, "subarea": None, "dn": dn}

        with get_tenant_lock(tid, "overrides"):
            ov = load_overrides(tid).get("overrides", {})

        updated = 0
        skipped_fixo = 0
        data = load_data(tid)
        for rec in data.get("db", []):
            email = (rec.get("email") or "").lower().strip()
            ov_entry = ov.get(email)
            if ov_entry and ov_entry.get("fixo"):
                skipped_fixo += 1
                continue
            mapping = dn_map.get(email)
            if mapping:
                old_setor = rec.get("setor")
                old_area = rec.get("area")
                rec["setor"] = mapping["setor"]
                rec["area"] = mapping["area"]
                rec["subarea"] = mapping.get("subarea")
                rec["dn"] = mapping.get("dn", "")
                if rec["setor"] != old_setor or rec["area"] != old_area:
                    updated += 1
        with get_tenant_lock(tid, "hierarchy"):
            hier_data_remap = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
            hier_remap = hier_data_remap.get("hierarchy", {})
        atm_remap, ms_remap = _build_area_to_macro(hier_remap)
        for rec in data.get("db", []):
            macro, hier_area = _resolve_hierarchy_server(
                rec["setor"], rec.get("area"), atm_remap, ms_remap
            )
            rec["macro"] = macro
            rec["hierArea"] = hier_area
        for snap in data.get("snapshots", []):
            for rec in snap.get("data", []):
                email = (rec.get("email") or "").lower().strip()
                ov_entry = ov.get(email)
                if ov_entry and ov_entry.get("fixo"):
                    continue
                mapping = dn_map.get(email)
                if mapping:
                    rec["setor"] = mapping["setor"]
                    rec["area"] = mapping["area"]
                    rec["subarea"] = mapping.get("subarea")
        save_data(data, tid)

        discovered = {}
        for email, m in dn_map.items():
            macro = m["setor"]
            if macro not in discovered:
                discovered[macro] = {}
            area = m.get("area")
            subarea = m.get("subarea")
            if area:
                if area not in discovered[macro]:
                    discovered[macro][area] = set()
                if subarea:
                    discovered[macro][area].add(subarea)
        if discovered:
            with get_tenant_lock(tid, "hierarchy"):
                hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
                hier = hier_data.get("hierarchy", {})
                for macro, area_map in discovered.items():
                    areas_list = sorted(area_map.keys())
                    subareas = {}
                    for area_name, subs in area_map.items():
                        if subs:
                            subareas[area_name] = sorted(subs)
                    if macro not in hier:
                        hier[macro] = {
                            "areas": areas_list,
                            "subareas": subareas,
                            "manual": False,
                            "source": "ad",
                        }
                    else:
                        if not hier[macro].get("manual"):
                            hier[macro]["areas"] = areas_list
                            hier[macro]["subareas"] = subareas
                        else:
                            existing = set(hier[macro].get("areas", []))
                            hier[macro]["areas"] = sorted(existing | set(areas_list))
                            existing_subs = hier[macro].get("subareas", {})
                            for area_name, subs in subareas.items():
                                ex = set(existing_subs.get(area_name, []))
                                existing_subs[area_name] = sorted(ex | set(subs))
                            hier[macro]["subareas"] = existing_subs
                hier_data["hierarchy"] = hier
                save_json_atomic(tenant_path(tid, "hierarchy.json"), hier_data)

        log.info(
            "Remap setores: %d atualizados, %d fixos ignorados, %d DNs do Graph",
            updated,
            skipped_fixo,
            len(dn_map),
        )
        return jsonify(
            {
                "ok": True,
                "updated": updated,
                "skipped_fixo": skipped_fixo,
                "total_dns": len(dn_map),
                "total_users": len(users),
            }
        )

    except Exception as e:
        log.exception("Erro no remap de setores")
        return jsonify({"error": "Erro interno. Verifique os logs do servidor."}), 500


def _norm_compare(s):
    """Normaliza string para comparacao: lowercase, sem acentos, sem espacos extras."""
    s = (s or "").strip().lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def _strip_name_suffix(name):
    """Remove sufixo ' - Setor' do nome (ex: 'Ana Silva - TI' -> 'Ana Silva')."""
    if not name:
        return ""
    m = NAME_SUFFIX_RE.match(name)
    return m.group(1).strip() if m else name.strip()


def _compare_records(source_map, source_label, db_map):
    """Compara dois mapas de registros (email -> dados) e retorna divergencias."""
    diffs = []
    all_emails = set(list(source_map.keys()) + list(db_map.keys()))

    for email in sorted(all_emails):
        src = source_map.get(email)
        loc = db_map.get(email)

        if src and not loc:
            diffs.append(
                {
                    "email": email,
                    "nome": _strip_name_suffix(src.get("nome", email)),
                    "tipo": "somente_fonte",
                    "campos": [],
                    "resumo": f"Existe no {source_label} mas nao no sistema",
                }
            )
            continue
        if loc and not src:
            diffs.append(
                {
                    "email": email,
                    "nome": _strip_name_suffix(loc.get("nome", email)),
                    "tipo": "somente_sistema",
                    "campos": [],
                    "resumo": f"Existe no sistema mas nao no {source_label}",
                }
            )
            continue

        # Ambos existem — comparar campos
        campos = []
        is_setor_fixo = loc.get("setorFixo", False)
        is_cargo_fixo = loc.get("cargoFixo", False)

        # Comparar campos usando definições
        field_defs = [
            (
                "nome",
                False,
                lambda s, l: (
                    _strip_name_suffix(s.get("nome", "")),
                    _strip_name_suffix(l.get("nome", "")),
                ),
            ),
            (
                "setor",
                True,
                lambda s, l: (
                    (s.get("setor") or "").strip(),
                    (l.get("setor", "") or "Sem Setor").strip(),
                ),
            ),
            (
                "area",
                True,
                lambda s, l: (
                    (s.get("area") or "").strip(),
                    (l.get("area", "") or "").strip(),
                ),
            ),
            (
                "cargo",
                True,
                lambda s, l: (
                    (s.get("cargo") or "").strip(),
                    (l.get("cargo") or "").strip(),
                ),
            ),
        ]

        for field_name, skip_if_empty, extractor in field_defs:
            src_val, loc_val = extractor(src, loc)
            if skip_if_empty and not src_val:
                continue
            if _norm_compare(src_val) != _norm_compare(loc_val):
                is_fixo = (
                    is_setor_fixo
                    if field_name in ("setor", "area")
                    else is_cargo_fixo
                    if field_name == "cargo"
                    else False
                )
                campos.append(
                    {
                        "campo": field_name,
                        "ad": src_val or "(vazio)",
                        "sistema": loc_val or "(vazio)",
                        "fixo": is_fixo,
                    }
                )

        # Campos com comparação direta (sem normalização unicode)
        src_lic = (src.get("licId") or "").strip()
        loc_lic = (loc.get("licId") or "").strip()
        if src_lic and src_lic != loc_lic:
            campos.append(
                {
                    "campo": "licenca",
                    "ad": src_lic or "none",
                    "sistema": loc_lic or "none",
                    "fixo": False,
                }
            )

        src_addons = sorted(src.get("addons") or [])
        loc_addons = sorted(loc.get("addons") or [])
        if src_addons and src_addons != loc_addons:
            campos.append(
                {
                    "campo": "addons",
                    "ad": ", ".join(src_addons) or "(nenhum)",
                    "sistema": ", ".join(loc_addons) or "(nenhum)",
                    "fixo": False,
                }
            )

        src_status = (src.get("status") or "").strip()
        loc_status = (loc.get("status") or "").strip()
        if src_status and src_status != loc_status:
            campos.append(
                {
                    "campo": "status",
                    "ad": src_status,
                    "sistema": loc_status,
                    "fixo": False,
                }
            )

        if campos:
            diffs.append(
                {
                    "email": email,
                    "nome": src.get("nome", email),
                    "tipo": "divergencia",
                    "campos": campos,
                    "resumo": ", ".join(c["campo"] for c in campos),
                }
            )

    return diffs


@app.route("/api/graph/audit", methods=["POST"])
def graph_audit():
    try:
        tid = getattr(request, "tenant_id", "live")
        cfg = load_graph_config(tid)
        has_graph = (
            cfg.get("tenant_id") and cfg.get("client_id") and cfg.get("client_secret")
        )

        data = load_data(tid)
        with get_tenant_lock(tid, "overrides"):
            ov = load_overrides(tid).get("overrides", {})
        apply_overrides(data.get("db", []), ov)
        db_list = data.get("db", [])
        db_map = {}
        for r in db_list:
            email = normalize_email(r.get("email", ""))
            if email:
                db_map[email] = r

        if has_graph:
            # ── Modo Graph API: buscar dados frescos do AD ──
            source_label = "AD"
            domain = cfg.get("domain", "liveoficial.com.br")
            ou_root = cfg.get("ou_root", "Setores")
            token = graph_get_token(cfg)

            ad_users = graph_get_paginated(
                token,
                "https://graph.microsoft.com/v1.0/users",
                {
                    "$select": "id,displayName,userPrincipalName,department,jobTitle,accountEnabled,assignedLicenses,createdDateTime,onPremisesDistinguishedName",
                    "$top": "999",
                    "$filter": f"endsWith(userPrincipalName,'@{domain}')",
                },
            )

            skus = graph_get_paginated(
                token, "https://graph.microsoft.com/v1.0/subscribedSkus"
            )
            sku_id_to_name = {s["skuId"]: s["skuPartNumber"] for s in skus}

            source_map = {}
            for u in ad_users:
                result = _process_graph_user(u, sku_id_to_name, ou_root)
                if not result:
                    continue
                source_map[result["email"]] = {
                    "nome": result["nome"],
                    "setor": result["setor"],
                    "area": result["area"],
                    "subarea": result.get("subarea"),
                    "cargo": result["cargo"],
                    "cargoOrigem": result.get("cargoOrigem", "ad"),
                    "licId": result["lic_id"],
                    "addons": result["addons"],
                    "status": result["status"],
                }
        else:
            # ── Modo local: usar ultimo snapshot (CSV) como fonte ──
            source_label = "CSV"
            snapshots = data.get("snapshots", [])
            if not snapshots:
                return (
                    jsonify(
                        {
                            "error": "Nenhum snapshot/CSV encontrado. Importe um CSV ou configure o Graph API."
                        }
                    ),
                    400,
                )

            # Ultimo snapshot ordenado por ano/mes
            snapshots_sorted = sorted(
                snapshots, key=lambda s: (s.get("ano", 0), s.get("mes", 0))
            )
            last_snap = snapshots_sorted[-1]
            snap_records = last_snap.get("data", [])
            # NAO aplicar overrides — queremos o dado bruto do CSV
            source_label = f"CSV ({last_snap.get('label', '?')})"

            source_map = {}
            for r in snap_records:
                email = normalize_email(r.get("email", ""))
                if email:
                    source_map[email] = {
                        "nome": r.get("nome", ""),
                        "setor": r.get("setor", ""),
                        "area": r.get("area"),
                        "subarea": r.get("subarea"),
                        "cargo": r.get("cargo", ""),
                        "licId": r.get("licId", "none"),
                        "addons": r.get("addons", []),
                        "status": r.get("status", ""),
                    }

        diffs = _compare_records(source_map, source_label, db_map)

        return jsonify(
            {
                "ok": True,
                "source": source_label,
                "total_fonte": len(source_map),
                "total_sistema": len(db_map),
                "total_diffs": len(diffs),
                "diffs": diffs,
            }
        )
    except Exception as e:
        log.error("Erro no audit: %s", e)
        return jsonify({"error": "Erro interno. Verifique os logs do servidor."}), 500


@app.route("/api/graph/test", methods=["POST"])
def test_graph_connection():
    """Testa conexão com Graph API sem sincronizar."""
    check = require_role("superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    payload = request.get_json(force=True, silent=True) or {}
    # Permitir testar com credenciais do payload (antes de salvar)
    for key in ["tenant_id", "client_id", "client_secret"]:
        if key in payload:
            cfg[key] = payload[key]
    try:
        if (
            not cfg.get("tenant_id")
            or not cfg.get("client_id")
            or not cfg.get("client_secret")
        ):
            return jsonify({"ok": False, "error": "Credenciais incompletas"}), 400
        token = graph_get_token(cfg)
        # Testar uma chamada simples
        resp = http_requests.get(
            "https://graph.microsoft.com/v1.0/organization",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        resp.raise_for_status()
        org = resp.json().get("value", [{}])[0]
        return jsonify(
            {
                "ok": True,
                "organization": org.get("displayName", ""),
                "tenant": org.get("id", ""),
            }
        )
    except Exception as e:
        log.exception("Erro no graph test")
        return jsonify({"ok": False, "error": "Falha ao conectar com Azure. Verifique credenciais e logs."}), 400


## ── Rotas de Relatórios (Graph API) ──────────────────────────────────────────


def _fetch_archive_sizes_batch(token, user_emails):
    """Busca tamanho do arquivo morto via batch API (requer Mail.ReadBasic.All).
    Retorna dict {email: {sizeInBytes, totalItemCount}} ou {} se sem permissão.
    sizeInBytes está disponível apenas na API beta do Graph.
    """
    if not user_emails or not http_requests:
        return {}
    result = {}
    batch_size = 20
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    for i in range(0, len(user_emails), batch_size):
        batch = user_emails[i:i + batch_size]
        requests_payload = [
            {"id": str(j), "method": "GET", "url": f"/users/{email}/mailFolders/archive"}
            for j, email in enumerate(batch)
        ]
        try:
            resp = http_requests.post(
                "https://graph.microsoft.com/beta/$batch",
                headers=headers,
                json={"requests": requests_payload},
                timeout=30,
            )
            if not resp.ok:
                log.warning("Archive batch falhou: %s %s", resp.status_code, resp.text[:200])
                break
            for item in resp.json().get("responses", []):
                if item.get("status") == 200:
                    idx = int(item["id"])
                    body = item.get("body", {})
                    result[batch[idx].lower()] = {
                        "sizeInBytes": body.get("sizeInBytes", 0) or 0,
                        "totalItemCount": body.get("totalItemCount", 0) or 0,
                    }
        except Exception:
            log.exception("Erro ao buscar archive sizes batch")
            break
    return result


def _extract_archive_fields(row):
    has_archive = False
    archive_b = "0"
    archive_items = "0"
    for key in row.keys():
        kl = key.lower().strip()
        val = (row.get(key) or "").strip()
        if not val or ("archive" not in kl and "arquivo" not in kl):
            continue
        is_storage = "storage" in kl or ("used" in kl and "byte" in kl) or "armazenamento" in kl
        is_item = ("item" in kl or "iten" in kl) and ("count" in kl or "contagem" in kl)
        is_has = kl.startswith("has") or kl.startswith("tem") or kl.startswith("possui")
        if is_storage:
            archive_b = val
        elif is_item:
            archive_items = val
        elif is_has:
            has_archive = val.lower() in ("yes", "true", "1", "sim")
    if not has_archive and archive_b not in ("0", ""):
        try:
            has_archive = int(archive_b) > 0
        except (ValueError, TypeError):
            pass
    return has_archive, archive_b, archive_items


@app.route("/api/debug/exchange-columns", methods=["GET"])
def debug_exchange_columns():
    check = require_role("admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada"}), 400
    try:
        token = graph_get_token(cfg)
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D7')")
        if not rows:
            return jsonify({"columns": [], "sample": None, "total_rows": 0})
        sample = dict(rows[0])
        archive_cols = {k: v for k, v in sample.items() if "archive" in k.lower() or "arquivo" in k.lower()}
        return jsonify({
            "total_rows": len(rows),
            "columns": list(rows[0].keys()),
            "archive_columns": archive_cols,
            "sample_user": {
                "displayName": sample.get("Display Name", ""),
                "hasArchive": sample.get("Has Archive", ""),
                "archiveStorage": sample.get("Archive Mailbox Storage Used (Byte)", "N/A"),
                "archiveItems": sample.get("Archive Mailbox Item Count", "N/A"),
            }
        })
    except Exception as e:
        log.exception("Erro ao diagnosticar colunas Exchange")
        return jsonify({"error": str(e)}), 500


@app.route("/api/reports/exchange", methods=["GET"])
def report_exchange():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada. Acesse Config para definir as credenciais."}), 400
    try:
        token = graph_get_token(cfg)
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D7')")
        data = []
        for row in rows:
            email = _get_csv_field(row, "User Principal Name", "user principal name") or ""
            display = _get_csv_field(row, "Display Name", "display name") or email.split("@")[0]
            storage_b = _get_csv_field(row, "Storage Used (Byte)", "storage used (byte)") or "0"
            items = _get_csv_field(row, "Item Count", "item count") or "0"
            last_act = _get_csv_field(row, "Last Activity Date", "last activity date") or ""
            warn_q = _get_csv_field(row, "Issue Warning Quota (Byte)", "issue warning quota (byte)") or "0"
            send_q = _get_csv_field(row, "Prohibit Send Quota (Byte)", "prohibit send quota (byte)") or "0"
            try:
                storage_mb = round(int(storage_b) / 1048576, 1)
            except (ValueError, TypeError):
                storage_mb = 0
            try:
                quota_bytes = int(send_q) if int(send_q) > 0 else int(warn_q)
            except (ValueError, TypeError):
                quota_bytes = 0
            quota_pct = round(int(storage_b) / quota_bytes * 100, 1) if quota_bytes > 0 else 0
            quota_status = "Normal" if quota_pct < 80 else ("Warning" if quota_pct < 95 else "Crítico")
            if last_act and last_act.lower() in ("", "never"):
                last_act = ""
            has_archive, archive_b, archive_items_raw = _extract_archive_fields(row)
            try:
                archive_mb = round(int(archive_b) / 1048576, 1)
            except (ValueError, TypeError):
                archive_mb = 0
            try:
                archive_item_count = int(archive_items_raw)
            except (ValueError, TypeError):
                archive_item_count = 0
            data.append({
                "email": email.strip(),
                "displayName": display.strip(),
                "storageMB": storage_mb,
                "itemCount": int(items) if items.isdigit() else 0,
                "lastActivity": last_act.strip(),
                "quotaPct": quota_pct,
                "quotaStatus": quota_status,
                "hasArchive": has_archive,
                "archiveMB": archive_mb,
                "archiveItemCount": archive_item_count,
            })
        archive_emails = [r["email"] for r in data if r["hasArchive"] and r["email"]]
        archive_sizes = _fetch_archive_sizes_batch(token, archive_emails)
        if archive_sizes:
            for r in data:
                info = archive_sizes.get(r["email"].lower())
                if info:
                    r["archiveMB"] = round(info["sizeInBytes"] / 1048576, 1)
                    r["archiveItemCount"] = info["totalItemCount"]
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter relatório Exchange D-7")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/reports/onedrive", methods=["GET"])
def report_onedrive():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada. Acesse Config para definir as credenciais."}), 400
    try:
        token = graph_get_token(cfg)
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getOneDriveUsageAccountDetail(period='D7')")
        data = []
        for row in rows:
            email = _get_csv_field(row, "Owner Principal Name", "owner principal name") or ""
            display = _get_csv_field(row, "Owner Display Name", "owner display name") or email.split("@")[0]
            storage_b = _get_csv_field(row, "Storage Used (Byte)", "storage used (byte)") or "0"
            files = _get_csv_field(row, "File Count", "file count") or "0"
            active_files = _get_csv_field(row, "Active File Count", "active file count") or "0"
            last_act = _get_csv_field(row, "Last Activity Date", "last activity date") or ""
            site_url = _get_csv_field(row, "Site URL", "site url") or ""
            try:
                storage_mb = round(int(storage_b) / 1048576, 1)
            except (ValueError, TypeError):
                storage_mb = 0
            if last_act and last_act.lower() in ("", "never"):
                last_act = ""
            data.append({
                "email": email.strip(),
                "displayName": display.strip(),
                "storageMB": storage_mb,
                "fileCount": int(files) if files.isdigit() else 0,
                "activeFileCount": int(active_files) if active_files.isdigit() else 0,
                "lastActivity": last_act.strip(),
                "siteUrl": site_url.strip(),
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter relatório OneDrive D-7")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/reports/domains", methods=["GET"])
def report_domains():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        domains = graph_get_simple(token, "https://graph.microsoft.com/v1.0/domains")
        data = []
        for d in domains:
            data.append({
                "id": d.get("id", ""),
                "authType": d.get("authenticationType", "Managed"),
                "isDefault": d.get("isDefault", False),
                "isVerified": d.get("isVerified", False),
                "services": d.get("supportedServices", []),
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter domínios")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/reports/groups", methods=["GET"])
def report_groups():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        groups = graph_get_paginated(
            token,
            "https://graph.microsoft.com/v1.0/groups",
            {
                "$select": "id,displayName,description,groupTypes,mailEnabled,securityEnabled,createdDateTime",
                "$top": "999",
            },
        )

        def _fetch_member_count(group_id):
            try:
                headers = {
                    "Authorization": f"Bearer {token}",
                    "ConsistencyLevel": "eventual",
                }
                resp = http_requests.get(
                    f"https://graph.microsoft.com/v1.0/groups/{group_id}/members/$count",
                    headers=headers,
                    params={"$count": "true"},
                    timeout=10,
                )
                if resp.ok:
                    return int(resp.text.strip())
                log.warning("memberCount falhou para %s: HTTP %s — %s", group_id, resp.status_code, resp.text[:200])
            except Exception as exc:
                log.warning("memberCount exception para %s: %s", group_id, exc)
            return None

        import concurrent.futures
        group_ids = [g.get("id", "") for g in groups]
        counts = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_map = {executor.submit(_fetch_member_count, gid): gid for gid in group_ids}
            for future in concurrent.futures.as_completed(future_map):
                counts[future_map[future]] = future.result()

        data = []
        for g in groups:
            data.append({
                "id": g.get("id", ""),
                "displayName": g.get("displayName", ""),
                "description": g.get("description", ""),
                "groupTypes": g.get("groupTypes", []),
                "mailEnabled": g.get("mailEnabled", False),
                "securityEnabled": g.get("securityEnabled", False),
                "createdDateTime": g.get("createdDateTime", ""),
                "memberCount": counts.get(g.get("id", "")),
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter grupos")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/reports/groups/<group_id>/members", methods=["GET"])
def report_group_members(group_id):
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        members = graph_get_paginated(
            token,
            f"https://graph.microsoft.com/v1.0/groups/{group_id}/members",
            {"$select": "id,displayName,userPrincipalName", "$top": "999"},
        )
        data = []
        for m in members:
            data.append({
                "id": m.get("id", ""),
                "displayName": m.get("displayName", ""),
                "email": m.get("userPrincipalName", ""),
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter membros do grupo")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/reports/applications", methods=["GET"])
def report_applications():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        apps = graph_get_paginated(
            token,
            "https://graph.microsoft.com/v1.0/applications",
            {
                "$select": "id,displayName,appId,createdDateTime,signInAudience",
                "$top": "999",
            },
        )
        data = []
        for a in apps:
            data.append({
                "id": a.get("id", ""),
                "displayName": a.get("displayName", ""),
                "appId": a.get("appId", ""),
                "createdDateTime": a.get("createdDateTime", ""),
                "signInAudience": a.get("signInAudience", ""),
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter applications")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/reports/service-principals", methods=["GET"])
def report_service_principals():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        sps = graph_get_paginated(
            token,
            "https://graph.microsoft.com/v1.0/servicePrincipals",
            {
                "$select": "id,displayName,appId,servicePrincipalType,accountEnabled,createdDateTime,appOwnerOrganizationId",
                "$top": "999",
            },
        )
        data = []
        for sp in sps:
            data.append({
                "id": sp.get("id", ""),
                "displayName": sp.get("displayName", ""),
                "appId": sp.get("appId", ""),
                "spType": sp.get("servicePrincipalType", "Application"),
                "accountEnabled": sp.get("accountEnabled", True),
                "createdDateTime": sp.get("createdDateTime", ""),
                "appOwnerOrgId": sp.get("appOwnerOrganizationId", ""),
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter service principals")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/reports/privileged-users", methods=["GET"])
def report_privileged_users():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        dir_roles = graph_get_simple(
            token, "https://graph.microsoft.com/v1.0/directoryRoles?$select=id,displayName,description"
        )
        roles_data = []
        for role in dir_roles:
            try:
                members = graph_get_paginated(
                    token,
                    f"https://graph.microsoft.com/v1.0/directoryRoles/{role['id']}/members",
                    {"$top": "999"},
                )
            except Exception as member_err:
                status_code = getattr(getattr(member_err, "response", None), "status_code", None)
                if status_code in (400, 404):
                    members = []
                else:
                    raise
            member_list = []
            for m in members:
                member_list.append({
                    "id": m.get("id", ""),
                    "displayName": m.get("displayName", ""),
                    "email": m.get("userPrincipalName") or m.get("mail") or "",
                })
            roles_data.append({
                "id": role.get("id", ""),
                "displayName": role.get("displayName", ""),
                "description": role.get("description", ""),
                "members": member_list,
            })
        return jsonify({"data": {"roles": roles_data}})
    except Exception as e:
        status_code = getattr(getattr(e, "response", None), "status_code", None)
        log.exception("Erro ao obter usuários privilegiados")
        if status_code == 400:
            return jsonify({"error": "Não foi possível carregar membros de uma função administrativa. Verifique as permissões da aplicação no Azure AD."}), 400
        return jsonify({"error": "Erro ao carregar dados de privilégios. Tente atualizar a página."}), 500


@app.route("/api/reports/policies", methods=["GET"])
def report_policies():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        policies = graph_get_paginated(
            token,
            "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies",
            {"$top": "999"},
        )
        data = []
        for p in policies:
            conditions = p.get("conditions") or {}
            grant = p.get("grantControls") or {}

            user_scope = "Todos"
            users_obj = conditions.get("users") or {}
            users_inc = users_obj.get("includeUsers") or []
            users_grp = users_obj.get("includeGroups") or []
            if users_inc and users_inc != ["All"]:
                user_scope = f"{len(users_inc)} usuário(s)"
            elif users_grp:
                user_scope = f"{len(users_grp)} grupo(s)"

            app_scope = "Todos"
            apps_obj = conditions.get("applications") or {}
            apps_inc = apps_obj.get("includeApplications") or []
            if apps_inc and apps_inc != ["All"]:
                app_scope = f"{len(apps_inc)} app(s)"

            grant_controls = grant.get("builtInControls") or [] if grant else []

            cond_list = []
            loc_obj = conditions.get("locations") or {}
            if loc_obj.get("includeLocations"):
                cond_list.append("Localização")
            plat_obj = conditions.get("platforms") or {}
            if plat_obj.get("includePlatforms"):
                cond_list.append("Plataforma")
            if conditions.get("signInRiskLevels"):
                cond_list.append("Risco de Login")
            if conditions.get("userRiskLevels"):
                cond_list.append("Risco Usuário")
            if conditions.get("clientAppTypes") and conditions["clientAppTypes"] != ["all"]:
                cond_list.append("Tipo de Aplicativo")

            data.append({
                "id": p.get("id", ""),
                "displayName": p.get("displayName", ""),
                "state": p.get("state", "disabled"),
                "userScope": user_scope,
                "appScope": app_scope,
                "grantControls": grant_controls,
                "conditions": cond_list,
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter políticas de acesso")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/security/alerts", methods=["GET"])
def security_alerts():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        data = []
        try:
            alerts = graph_get_paginated(
                token,
                "https://graph.microsoft.com/v1.0/security/alerts",
                {"$top": "100", "$orderby": "createdDateTime desc"},
            )
            for a in alerts:
                data.append({
                    "id": a.get("id", ""),
                    "title": a.get("title", a.get("alertDetections", [{}])[0].get("title", "") if a.get("alertDetections") else ""),
                    "description": a.get("description", ""),
                    "severity": a.get("severity", "informational"),
                    "status": a.get("status", "unknown"),
                    "createdDateTime": a.get("createdDateTime", ""),
                    "category": a.get("category", ""),
                })
        except Exception as e:
            if "403" in str(e) or "Forbidden" in str(e):
                return jsonify({"error": "Permissão SecurityEvents.Read.All não concedida no Azure AD. Adicione a permissão (Application) e conceda Admin Consent."})
            raise
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter alertas de segurança")
        return jsonify({"error": f"Falha ao obter alertas: {e}"}), 500


@app.route("/api/security/analysis", methods=["GET"])
def security_analysis():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check

    result = {
        "noMfa": [],
        "staleAccounts": [],
        "adminsNoMfa": [],
        "failedSignIns": [],
        "blockedWithLicense": [],
    }

    tid = getattr(request, "tenant_id", "live")
    raw = load_data(tid)
    db_local = raw.get("db", []) if isinstance(raw, dict) else raw
    usage_local = raw.get("usage", {}) if isinstance(raw, dict) else {}

    db_by_email = {r.get("email", "").lower(): r for r in db_local}

    for r in db_local:
        lic_id = r.get("licId", "none")
        if r.get("status") == "Inativo" and lic_id != "none":
            result["blockedWithLicense"].append({
                "displayName": r.get("nome", ""),
                "email": r.get("email", ""),
                "licId": lic_id,
                "custo": _compute_cost(lic_id, r.get("addons")),
                "setor": r.get("setor", ""),
                "cargo": r.get("cargo", ""),
            })

    for r in db_local:
        if r.get("status") == "Ativo":
            email = r.get("email", "").lower()
            u = usage_local.get(email, {})
            last = u.get("lastActivity", "")
            if last:
                try:
                    from datetime import datetime, timedelta
                    d = datetime.strptime(last, "%Y-%m-%d")
                    dias = (datetime.now() - d).days
                    if dias > 90:
                        lic_id = r.get("licId", "none")
                        result["staleAccounts"].append({
                            "displayName": r.get("nome", ""),
                            "email": email,
                            "lastActivity": last,
                            "diasInativo": dias,
                            "setor": r.get("setor", ""),
                            "cargo": r.get("cargo", ""),
                            "licId": lic_id,
                            "custo": _compute_cost(lic_id, r.get("addons")),
                        })
                except Exception:
                    pass

    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if cfg.get("tenant_id") and cfg.get("client_id") and cfg.get("client_secret"):
        try:
            token = graph_get_token(cfg)
        except Exception as e:
            log.warning("Falha ao obter token para análise: %s", e)
            return jsonify({"data": result})

        headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual", **_GRAPH_LANG_HEADERS}

        try:
            resp = http_requests.get(
                "https://graph.microsoft.com/beta/reports/credentialUserRegistrationDetails",
                headers=headers, params={"$top": "999"}, timeout=15,
            )
            if resp.ok:
                for cr in resp.json().get("value", []):
                    if not cr.get("isMfaRegistered", True):
                        email = cr.get("userPrincipalName", "").lower()
                        db_user = db_by_email.get(email, {})
                        result["noMfa"].append({
                            "displayName": cr.get("userDisplayName", "") or db_user.get("nome", ""),
                            "email": email,
                            "setor": db_user.get("setor", ""),
                            "cargo": db_user.get("cargo", ""),
                        })
        except Exception as e:
            log.warning("MFA check pulado: %s", e)

        try:
            resp = http_requests.get(
                "https://graph.microsoft.com/v1.0/auditLogs/signIns",
                headers=headers,
                params={"$filter": "status/errorCode ne 0", "$top": "50", "$orderby": "createdDateTime desc"},
                timeout=15,
            )
            if resp.ok:
                seen = set()
                for si in resp.json().get("value", []):
                    email = si.get("userPrincipalName", "")
                    if email and email not in seen:
                        seen.add(email)
                        status = si.get("status", {})
                        created = si.get("createdDateTime", "")
                        result["failedSignIns"].append({
                            "displayName": si.get("userDisplayName", ""),
                            "email": email,
                            "motivo": status.get("failureReason", "") or status.get("additionalDetails", ""),
                            "errorCode": status.get("errorCode", ""),
                            "data": created.split("T")[0] if created else "",
                        })
        except Exception as e:
            log.warning("Sign-ins check pulado: %s", e)

    return jsonify({"data": result})


@app.route("/api/security/secure-score", methods=["GET"])
def secure_score():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        scores = graph_get_simple(
            token, "https://graph.microsoft.com/v1.0/security/secureScores?$top=1"
        )
        if not scores:
            return jsonify({"data": {"currentScore": 0, "maxScore": 100, "controlScores": [], "averageComparativeScores": []}})
        s = scores[0] if isinstance(scores, list) else scores
        return jsonify({"data": {
            "currentScore": s.get("currentScore", 0),
            "maxScore": s.get("maxScore", 100),
            "controlScores": s.get("controlScores", []),
            "averageComparativeScores": s.get("averageComparativeScores", []),
        }})
    except Exception as e:
        log.exception("Erro ao obter Secure Score")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@app.route("/api/security/score-profiles", methods=["GET"])
def secure_score_profiles():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        profiles = graph_get_paginated(
            token,
            "https://graph.microsoft.com/v1.0/security/secureScoreControlProfiles",
            {"$top": "999"},
        )
        data = []
        for p in profiles:
            data.append({
                "controlName": p.get("id", ""),
                "title": p.get("title", ""),
                "description": p.get("implementationCost", ""),
                "controlCategory": p.get("controlCategory", ""),
                "maxScore": p.get("maxScore", 0),
                "rank": p.get("rank", 999),
                "deprecated": p.get("deprecated", False),
                "remediation": p.get("remediation", ""),
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter Secure Score profiles")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


def _get_session():
    user = getattr(request, "auth_user", None)
    if not user:
        return None
    return {
        "name": user.get("name", ""),
        "email": user.get("email", ""),
        "username": user.get("username", ""),
    }


def _read_tickets(tenant_id="live"):
    path = tenant_path(tenant_id, "tickets.json")
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _write_tickets(tickets, tenant_id="live"):
    path = tenant_path(tenant_id, "tickets.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(tickets, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


@app.route("/api/support/ticket", methods=["POST"])
def create_ticket():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    body = request.get_json(silent=True) or {}
    subject = body.get("subject", "").strip()
    message = body.get("message", "").strip()
    category = body.get("category", "Outro").strip()
    if not subject or not message:
        return jsonify({"error": "Assunto e descrição são obrigatórios."}), 400

    session = _get_session()
    user_name = session.get("name", "Anônimo") if session else "Anônimo"

    tid = getattr(request, "tenant_id", "live")
    tickets = _read_tickets(tid)
    new_id = max((t.get("id", 0) for t in tickets), default=0) + 1
    ticket = {
        "id": new_id,
        "user": user_name,
        "subject": subject,
        "message": message,
        "category": category,
        "status": "aberto",
        "created": datetime.now(timezone.utc).isoformat(),
        "replies": [],
    }
    tickets.append(ticket)
    _write_tickets(tickets, tid)
    return jsonify({"ok": True, "id": new_id})


@app.route("/api/support/tickets", methods=["GET"])
def list_tickets():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    tickets = _read_tickets(tid)
    session = _get_session()
    user_name = session.get("name", "") if session else ""
    user_tickets = [t for t in tickets if t.get("user") == user_name] if user_name else tickets
    user_tickets.sort(key=lambda t: t.get("created", ""), reverse=True)
    return jsonify({"data": user_tickets})


def _ensure_sync_thread(tenant_id="live"):
    t = _sync_threads.get(tenant_id)
    if t is None or not t.is_alive():
        _sync_threads[tenant_id] = threading.Thread(
            target=_auto_sync_loop, args=(tenant_id,), daemon=True
        )
        _sync_threads[tenant_id].start()


# ── Sem cache para JS e HTML ───────────────────────────────────────────────────
@app.after_request
def add_security_headers(response):
    """Adiciona headers de segurança e desabilita cache para JS/HTML."""
    # Security headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' fonts.googleapis.com; "
        "font-src 'self' fonts.gstatic.com; "
        "connect-src 'self' https://sso.liveoficial.ind.br https://cdn.jsdelivr.net; "
        "img-src 'self' data:; "
        "frame-ancestors 'none'"
    )
    if request.path.startswith("/api/") or request.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    elif request.path.endswith((".js", ".css")):
        response.headers["Cache-Control"] = "no-cache"
        response.headers.pop("Pragma", None)
        response.headers.pop("Expires", None)
    return response


# Extensões permitidas para arquivos estáticos
STATIC_ALLOWED_EXT = {
    ".html",
    ".css",
    ".js",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".map",
}


# ── Arquivos estáticos ─────────────────────────────────────────────────────────
# ── Páginas (multi-page) ──────────────────────────────────────────────────────
_PAGES = {
    'dashboard': 'dashboard.html',
    'colaboradores': 'colaboradores.html',
    'licencas': 'licencas.html',
    'setores': 'setores.html',
    'historico': 'historico.html',
    'radar': 'radar.html',
    'contratos': 'contratos.html',
    'relatorio': 'relatorio.html',
    'auditoria': 'auditoria.html',
    'sugestoes': 'sugestoes.html',
    'config': 'config.html',
    'exchange': 'exchange.html',
    'onedrive': 'onedrive.html',
    'dominios': 'dominios.html',
    'grupos': 'grupos.html',
    'aplicativos': 'aplicativos.html',
    'privilegios': 'privilegios.html',
    'politicas': 'politicas.html',
    'alertas': 'alertas.html',
    'assessment': 'assessment.html',
    'suporte': 'suporte.html',
}

@app.route("/")
def root():
    """Serve página principal (dashboard)."""
    return render_template('dashboard.html', active_page='dashboard')


@app.route("/<page>")
def page_view(page):
    """Serve páginas do sistema (cada aba = uma página)."""
    if page in _PAGES:
        return render_template(_PAGES[page], active_page=page)
    # Se não é uma página conhecida, tenta servir como arquivo estático
    return static_files(page)


@app.route("/<path:path>")
def static_files(path):
    """Serve arquivos estáticos do diretório base com proteção contra path traversal."""
    # Bloquear path traversal
    if ".." in path or path.startswith("/"):
        abort(404)
    # Validar que o path resolve dentro de BASE_DIR
    full = os.path.realpath(os.path.join(BASE_DIR, path))
    if not full.startswith(os.path.realpath(BASE_DIR)):
        abort(404)
    # Bloquear acesso a arquivos de dados sensíveis
    basename = os.path.basename(path).lower()
    if basename in (
        "data.json",
        "overrides.json",
        "graph_config.json",
        "changelog.json",
        "hierarchy.json",
        "suggestions.json",
        "annotations.json",
        "roles.json",
        ".env",
        "server.py",
    ):
        abort(404)
    # Permitir apenas extensões conhecidas
    _, ext = os.path.splitext(path)
    if ext.lower() not in STATIC_ALLOWED_EXT:
        abort(404)
    return send_from_directory(BASE_DIR, path)


# ──────────────────────────────────────────────────────────────────────────────
# IA — Assistente de análise M365
# ──────────────────────────────────────────────────────────────────────────────

_AI_SYSTEM_PROMPT = """Você é o assistente de IA do painel LIVE! Microsoft 365. Você analisa dados reais de licenças, custos e uso do Microsoft 365 da empresa LIVE (liveoficial.com.br).

Suas capacidades:
- Responder sobre custos atuais, por setor, por licença
- Identificar desperdício e sugerir otimizações concretas
- Comparar meses/tendências históricas
- Explicar os tipos de licença M365 e suas diferenças
- Sugerir ações concretas de redução de custo com impacto financeiro

Regras:
- Responda SEMPRE em português brasileiro
- Use os dados fornecidos como base factual — não invente números
- Formate valores monetários como R$ 1.234,56
- Seja conciso mas completo, use bullet points quando apropriado
- Quando sugerir mudanças, cite o impacto financeiro estimado
- Se não tiver dados suficientes para responder, diga claramente
- Use negrito (**texto**) para destacar valores importantes

Preços das licenças (R$/mês por usuário):
- M365 Business Standard: R$78,15
- M365 Business Basic: R$31,21
- M365 Apps for Business: R$51,54 (add-on, sem Exchange/Teams)
- Office 365 F3: R$25,00 (frontline, básico)
- Office 365 E3: R$90,29 (enterprise, completo)
- Power BI Pro: R$87,55 (add-on)"""


def _build_ai_data_summary(tenant_id="live"):
    data = load_data(tenant_id)
    db = data.get("db", [])
    if not db:
        return "Nenhum dado disponível. O sistema ainda não foi sincronizado."

    # Single-pass: coleta todas as estatísticas em um único loop
    total = len(db)
    ativos = 0
    tipos = {}
    lic_stats = {}
    total_custo = 0
    setor_stats = {}
    inativos_com_licenca_count = 0
    custo_inativos = 0

    for r in db:
        custo = r.get("custo", 0) or 0
        status = r.get("status")
        lid = r.get("licId", "none")
        is_ativo = status == "Ativo"

        # Contagens básicas
        if is_ativo:
            ativos += 1
        t = r.get("tipo", "Pessoa")
        tipos[t] = tipos.get(t, 0) + 1

        # Custo por licença
        if lid not in lic_stats:
            lic_stats[lid] = {"count": 0, "custo": 0}
        lic_stats[lid]["count"] += 1
        lic_stats[lid]["custo"] += custo
        total_custo += custo

        # Custo por setor
        s = r.get("setor") or "Sem Setor"
        if s not in setor_stats:
            setor_stats[s] = {"count": 0, "custo": 0, "ativos": 0}
        setor_stats[s]["count"] += 1
        setor_stats[s]["custo"] += custo
        if is_ativo:
            setor_stats[s]["ativos"] += 1

        # Oportunidades de economia
        if not is_ativo and lid not in ("none", "other", None):
            inativos_com_licenca_count += 1
            custo_inativos += custo

    inativos = total - ativos

    lic_names = {
        "bstd": "Business Standard", "bbasic": "Business Basic",
        "apps": "Apps for Business", "f3": "Office 365 F3",
        "e3": "Office 365 E3", "pbi": "Power BI Pro",
        "none": "Sem licença", "other": "Outra"
    }

    top_setores = sorted(setor_stats.items(), key=lambda x: -x[1]["custo"])[:10]

    # Uso (se disponível)
    usage = data.get("usage", {})
    uso_info = ""
    if usage:
        com_mailbox = sum(1 for u in usage.values() if u.get("mailboxMB"))
        com_onedrive = sum(1 for u in usage.values() if u.get("onedriveMB"))
        baixo_mail = sum(1 for u in usage.values() if u.get("mailboxMB") and u["mailboxMB"] < 100)
        baixo_drive = sum(1 for u in usage.values() if u.get("onedriveMB") and u["onedriveMB"] < 100)
        uso_info = f"\nUSO:\n- {com_mailbox} com dados de mailbox ({baixo_mail} com menos de 100MB)"
        uso_info += f"\n- {com_onedrive} com dados de OneDrive ({baixo_drive} com menos de 100MB)"

    # Snapshots (tendência)
    snaps = data.get("snapshots", [])
    tendencia = ""
    if len(snaps) >= 2:
        last = snaps[-1]
        prev = snaps[-2]
        custo_last = sum(r.get("custo", 0) or 0 for r in last.get("data", []))
        custo_prev = sum(r.get("custo", 0) or 0 for r in prev.get("data", []))
        delta = custo_last - custo_prev
        sinal = "+" if delta >= 0 else ""
        tendencia = f"\nTENDÊNCIA:\n- {prev.get('label','?')} → {last.get('label','?')}: R$ {custo_prev:,.2f} → R$ {custo_last:,.2f} ({sinal}R$ {delta:,.2f})"

    # Montar resumo
    lines = [f"=== RESUMO M365 — {datetime.now().strftime('%d/%m/%Y')} ==="]
    lines.append(f"Total: {total} contas ({', '.join(f'{v} {k}' for k, v in sorted(tipos.items()))})")
    lines.append(f"Ativos: {ativos} | Inativos: {inativos}")
    lines.append(f"\nCUSTO MENSAL POR LICENÇA:")
    for lid in ["e3", "bstd", "bbasic", "apps", "f3", "pbi", "none", "other"]:
        st = lic_stats.get(lid)
        if st and st["count"] > 0:
            lines.append(f"- {lic_names.get(lid, lid)}: {st['count']} usuários, R$ {st['custo']:,.2f}/mês")
    lines.append(f"TOTAL MENSAL: R$ {total_custo:,.2f} | ANUAL: R$ {total_custo * 12:,.2f}")
    lines.append(f"\nTOP SETORES POR CUSTO:")
    for s, st in top_setores:
        lines.append(f"- {s}: {st['count']} pessoas ({st['ativos']} ativos), R$ {st['custo']:,.2f}/mês")
    if inativos_com_licenca_count:
        lines.append(f"\nOPORTUNIDADES:")
        lines.append(f"- {inativos_com_licenca_count} inativos com licença paga: economia potencial R$ {custo_inativos:,.2f}/mês")
    if uso_info:
        lines.append(uso_info)
    if tendencia:
        lines.append(tendencia)

    return "\n".join(lines)


@app.route("/api/ai/chat", methods=["POST"])
def ai_chat():
    """Endpoint streaming para chat com IA usando dados reais do M365."""
    check = require_auth()
    if check:
        return check
    if not http_requests:
        return jsonify({"error": "Módulo requests não instalado"}), 500

    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    api_key = cfg.get("ai_api_key", "")
    if not api_key:
        return jsonify({"error": "API key da IA não configurada. Acesse Config para configurar."}), 400

    body = request.get_json(silent=True) or {}
    messages = body.get("messages", [])
    if not messages or not isinstance(messages, list):
        return jsonify({"error": "Nenhuma mensagem enviada"}), 400

    # Validar estrutura das mensagens
    valid_roles = {"user", "assistant"}
    sanitized = []
    for msg in messages[-20:]:
        if not isinstance(msg, dict) or "role" not in msg or "content" not in msg:
            continue
        if msg["role"] not in valid_roles:
            continue
        if not isinstance(msg["content"], str) or len(msg["content"]) > 10000:
            continue
        sanitized.append({"role": msg["role"], "content": msg["content"]})
    if not sanitized:
        return jsonify({"error": "Nenhuma mensagem válida"}), 400
    messages = sanitized

    # Montar contexto com dados reais
    tid = getattr(request, "tenant_id", "live")
    data_summary = _build_ai_data_summary(tid)
    system_prompt = _AI_SYSTEM_PROMPT + "\n\n" + data_summary

    def generate():
        resp = None
        try:
            resp = http_requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 1024,
                    "system": system_prompt,
                    "messages": messages,
                    "stream": True,
                },
                stream=True,
                timeout=60,
            )
            if resp.status_code != 200:
                error_text = resp.text[:200]
                yield f"data: {json.dumps({'error': f'API error {resp.status_code}: {error_text}'})}\n\n"
                return

            for line in resp.iter_lines():
                if not line:
                    continue
                line = line.decode("utf-8", errors="replace")
                if line.startswith("data: "):
                    payload = line[6:]
                    if payload.strip() == "[DONE]":
                        break
                    try:
                        evt = json.loads(payload)
                        if evt.get("type") == "content_block_delta":
                            text = evt.get("delta", {}).get("text", "")
                            if text:
                                yield f"data: {json.dumps({'text': text})}\n\n"
                    except json.JSONDecodeError:
                        log.warning("AI chat: malformed SSE chunk: %s", payload[:200])
            yield "data: [DONE]\n\n"
        except Exception as e:
            log.exception("Erro no AI chat")
        finally:
            if resp is not None:
                resp.close()
            yield f"data: {json.dumps({'error': 'Erro interno ao processar chat. Verifique os logs.'})}\n\n"

    return Response(generate(), content_type="text/event-stream")


@app.route("/api/ai/test", methods=["POST"])
def ai_test():
    """Testa conexão com a API da Anthropic."""
    check = require_role("superadmin")
    if check:
        return check
    if not http_requests:
        return jsonify({"error": "Módulo requests não instalado"}), 500

    body = request.get_json(silent=True) or {}
    cfg = load_graph_config(getattr(request, "tenant_id", "live"))
    api_key = body.get("ai_api_key") or cfg.get("ai_api_key", "")
    if not api_key:
        return jsonify({"ok": False, "error": "Nenhuma API key configurada"}), 400

    try:
        resp = http_requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 10,
                "messages": [{"role": "user", "content": "oi"}],
            },
            timeout=15,
        )
        if resp.status_code == 200:
            return jsonify({"ok": True, "model": "claude-sonnet-4-20250514"})
        else:
            return jsonify({"ok": False, "error": f"HTTP {resp.status_code}: resposta inesperada da API"})
    except Exception as e:
        log.exception("Erro no AI test")
        return jsonify({"ok": False, "error": "Erro ao conectar com a API. Verifique os logs."})


# ── API: tenants ──────────────────────────────────────────────────────────────
@app.route("/api/tenants", methods=["GET"])
def list_tenants():
    user = getattr(request, "auth_user", {})
    uname = user.get("username") or user.get("email") or user.get("name", "")
    tid = getattr(request, "tenant_id", "live")
    cfg = _load_tenants_config()
    tenants = cfg.get("tenants", {})
    clean_uname = uname.split("@")[0].lower().strip() if uname else ""
    if _is_global_admin(uname):
        result = [
            {"slug": slug, "name": t.get("name", slug), "active": t.get("active", False)}
            for slug, t in tenants.items()
            if t.get("active")
        ]
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


@app.route("/api/tenant/switch", methods=["POST"])
def switch_tenant():
    user = getattr(request, "auth_user", {})
    uname = user.get("username") or user.get("email") or user.get("name", "")
    body = request.get_json(silent=True) or {}
    new_tid = (body.get("tenant") or "").strip()
    if not new_tid or not _is_valid_tenant(new_tid):
        return jsonify({"error": "Tenant inválido"}), 400
    if not _is_global_admin(uname):
        clean_uname = uname.split("@")[0].lower().strip() if uname else ""
        roles = load_json_safe(tenant_path(new_tid, "roles.json"), {})
        if clean_uname not in [k.lower() for k in roles]:
            return jsonify({"error": "Sem permissão"}), 403
    cfg = _load_tenants_config()
    cfg["default_tenant"] = new_tid
    save_json_atomic(TENANTS_CONFIG_FILE, cfg)
    resp = jsonify({"ok": True, "tenant": new_tid})
    resp.set_cookie("active_tenant", new_tid, httponly=True, samesite="Lax")
    return resp


@app.route("/api/admin/tenants", methods=["POST"])
def create_tenant():
    user = getattr(request, "auth_user", {})
    uname = user.get("username") or user.get("email") or user.get("name", "")
    if not _is_global_admin(uname):
        return jsonify({"error": "Sem permissão"}), 403
    body = request.get_json(silent=True) or {}
    slug = re.sub(r"[^a-z0-9-]", "", (body.get("slug") or "").lower().strip())
    name = (body.get("name") or "").strip()
    if not slug or not name:
        return jsonify({"error": "slug e name são obrigatórios"}), 400
    cfg = _load_tenants_config()
    if slug in cfg.get("tenants", {}):
        return jsonify({"error": "Tenant já existe"}), 409
    new_dir = os.path.join(TENANTS_DIR, slug)
    os.makedirs(new_dir, exist_ok=True)
    save_json_atomic(os.path.join(new_dir, "data.json"), DEFAULT_DATA)
    save_json_atomic(os.path.join(new_dir, "roles.json"), {})
    save_json_atomic(os.path.join(new_dir, "hierarchy.json"), {"hierarchy": {}})
    save_json_atomic(os.path.join(new_dir, "overrides.json"), {"overrides": {}})
    save_json_atomic(os.path.join(new_dir, "annotations.json"), [])
    save_json_atomic(os.path.join(new_dir, "changelog.json"), [])
    initial_graph_cfg = {
        "tenant_id": "", "client_id": "", "client_secret": "",
        "domain": "", "ou_root": "Setores", "auto_sync": False, "sync_interval_hours": 24,
    }
    provided_config = body.get("config") or {}
    for key in ("tenant_id", "client_id", "client_secret", "domain", "ou_root"):
        if provided_config.get(key):
            initial_graph_cfg[key] = provided_config[key]
    save_graph_config(initial_graph_cfg, slug)
    cfg.setdefault("tenants", {})[slug] = {
        "name": name, "slug": slug, "subdomains": [slug], "active": True
    }
    save_json_atomic(TENANTS_CONFIG_FILE, cfg)
    return jsonify({"ok": True, "slug": slug})


@app.route("/health")
def health_check():
    import resource
    rusage = resource.getrusage(resource.RUSAGE_SELF)
    return jsonify({
        "status": "ok",
        "uptime_seconds": round(time.time() - _server_start_time, 1),
        "memory_mb": round(rusage.ru_maxrss / 1024, 1),
        "token_cache_size": len(_token_cache),
        "sync_threads": {k: v.is_alive() for k, v in _sync_threads.items()},
        "sync_status": {k: {"running": v.get("running"), "lastSync": v.get("lastSync")} for k, v in _sync_status.items()},
    })


# ──────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    tenants_cfg = _load_tenants_config()
    for tid, t in tenants_cfg.get("tenants", {}).items():
        if t.get("active"):
            _ensure_sync_thread(tid)
    print(f"LIVE! M365 rodando em http://0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
