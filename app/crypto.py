"""Criptografia Fernet para secrets em disco."""

import os
import base64
from hashlib import sha256

from app.config import BASE_DIR, _HAS_FERNET, InvalidToken

try:
    from cryptography.fernet import Fernet
except ImportError:
    Fernet = None  # type: ignore


def _derive_fernet_key() -> bytes:
    """Deriva chave Fernet. Prioridade: env FERNET_KEY → derivação por máquina."""
    env_key = os.environ.get("FERNET_KEY")
    if env_key:
        return env_key.encode() if isinstance(env_key, str) else env_key
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
    """Decifra um secret armazenado. Aceita 'enc:...' ou texto puro (legado)."""
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
