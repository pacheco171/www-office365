"""Utilitários de I/O, locks, caches, validação e overrides."""

import json
import os
import re
import tempfile
import threading
import time
import logging

from app.config import TENANTS_DIR, TENANTS_CONFIG_FILE

log = logging.getLogger("graph-sync")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

DEFAULT_DATA = {"db": [], "snapshots": [], "contracts": [], "acoes": [], "usage": {}, "fatura": []}

# ── Locks por tenant ──────────────────────────────────────────────────────────

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


# ── Estado de sync (compartilhado com blueprints) ────────────────────────────

_sync_threads: dict = {}
_sync_status: dict = {}
_server_start_time = time.time()


# ── I/O atômico ──────────────────────────────────────────────────────────────

def tenant_path(tenant_id: str, filename: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", tenant_id)
    return os.path.join(TENANTS_DIR, safe, filename)


def load_json_safe(path, default):
    """Carrega JSON de forma segura, retornando default se falhar."""
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default() if callable(default) else default


def save_json_atomic(path, data):
    """Grava JSON de forma atômica (escreve em temp e renomeia)."""
    dir_name = os.path.dirname(path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


# ── Caches de dados ───────────────────────────────────────────────────────────

_data_response_cache: dict = {}
_boot_cache: dict = {}
_processed_rows_cache: dict = {}


def _invalidate_data_cache(tenant_id: str = "live"):
    _data_response_cache.pop(tenant_id, None)
    _boot_cache.pop(tenant_id, None)
    _processed_rows_cache.pop(tenant_id, None)


def _invalidate_boot_cache(tenant_id: str = "live"):
    _boot_cache.pop(tenant_id, None)


# ── Dados (data.json) ─────────────────────────────────────────────────────────

def load_data(tenant_id: str = "live") -> dict:
    return load_json_safe(
        tenant_path(tenant_id, "data.json"),
        lambda: {
            k: list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v
            for k, v in DEFAULT_DATA.items()
        },
    )


def save_data(data: dict, tenant_id: str = "live"):
    with get_tenant_lock(tenant_id, "data"):
        save_json_atomic(tenant_path(tenant_id, "data.json"), data)
    _invalidate_data_cache(tenant_id)


# ── Overrides ─────────────────────────────────────────────────────────────────

def load_overrides(tenant_id: str = "live") -> dict:
    return load_json_safe(tenant_path(tenant_id, "overrides.json"), {"overrides": {}})


def save_overrides(data: dict, tenant_id: str = "live"):
    with get_tenant_lock(tenant_id, "overrides"):
        save_json_atomic(tenant_path(tenant_id, "overrides.json"), data)


def apply_overrides(records: list, overrides_map: dict):
    """Aplica setor/cargo fixo dos overrides nos registros."""
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


# ── Validação de input ────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$")
MAX_FIELD_LEN = 200


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def validate_email_format(email: str):
    """Retorna email normalizado ou None se inválido."""
    email = normalize_email(email)
    if not email or len(email) > MAX_FIELD_LEN or not _EMAIL_RE.match(email):
        return None
    return email


def validate_text_field(val, field_name: str, max_len: int = MAX_FIELD_LEN):
    """Valida campo de texto. Retorna (valor, None) ou (None, mensagem_erro)."""
    if not val or not isinstance(val, str):
        return None, f'Campo "{field_name}" é obrigatório'
    val = val.strip()
    if len(val) > max_len:
        return None, f'Campo "{field_name}" excede {max_len} caracteres'
    if "\x00" in val or any(ord(c) < 32 and c not in ("\n", "\r", "\t") for c in val):
        return None, f'Campo "{field_name}" contém caracteres inválidos'
    return val, None
