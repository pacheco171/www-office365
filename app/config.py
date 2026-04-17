"""Configurações globais e recursos compartilhados do servidor."""

import os

try:
    from cryptography.fernet import Fernet, InvalidToken  # noqa: F401
    _HAS_FERNET = True
except ImportError:
    _HAS_FERNET = False
    InvalidToken = Exception  # fallback para evitar NameError

try:
    from flask_compress import Compress  # noqa: F401
    _HAS_COMPRESS = True
except ImportError:
    _HAS_COMPRESS = False

try:
    import requests as _requests_mod
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    _retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "POST"],
    )
    _adapter = HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=_retry)
    http_requests = _requests_mod.Session()
    http_requests.mount("https://", _adapter)
    http_requests.mount("http://", _adapter)
except ImportError:
    http_requests = None

# Diretórios base (app/ está um nível abaixo do projeto)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TENANTS_DIR = os.path.join(BASE_DIR, "tenants")
TENANTS_CONFIG_FILE = os.path.join(BASE_DIR, "tenants.json")
PORT = int(os.environ.get("PORT", 7319))

# SSO / Auth
SSO_API = os.environ.get("SSO_API", "https://sso.liveoficial.ind.br")
REQUIRED_GROUP = "Acesso Licencas 365 SSO"
TOKEN_CACHE_TTL = 300
AUTH_DOMAIN = "live.local"

# Roles — roles válidas: superadmin, admin, tecnico, gestor
DEFAULT_ROLE = "tecnico"
_DEFAULT_ROLES = {
    "enzzo.pacheco": "superadmin",
    "alex.fagundes": "superadmin",
    "douglas.preto": "superadmin",
}

# Grupos de roles para uso em require_role()
ROLES_ALL        = ("admin", "tecnico", "gestor", "superadmin")
ROLES_NO_GESTOR  = ("admin", "tecnico", "superadmin")
ROLES_ADMIN_UP   = ("admin", "superadmin")
ROLES_ADMIN_TECH = ("admin", "superadmin", "tecnico")

# Rotas públicas (não exigem autenticação)
PUBLIC_PREFIXES = ("/login", "/src/", "/favicon", "/api/auth/")
PUBLIC_EXACT = {"/", "/login.html", "/health"}

# Opções de cookie HTTP-only
_COOKIE_OPTS = {
    "httponly": True,
    "secure": os.environ.get("COOKIE_SECURE", "false").lower() in ("true", "1", "yes"),
    "samesite": "Lax",
    "path": "/",
}

# Extensões permitidas para arquivos estáticos
STATIC_ALLOWED_EXT = {
    ".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif",
    ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".map",
}
