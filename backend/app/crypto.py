"""Encrypts Google refresh tokens before they are stored in the database."""

import base64
import hashlib
import os

from cryptography.fernet import Fernet


def _fernet() -> Fernet:
    key = os.environ.get("TOKEN_ENCRYPTION_KEY")
    if not key:
        # Dev fallback: derive a key from SECRET_KEY. Set TOKEN_ENCRYPTION_KEY in production.
        secret = os.environ.get("SECRET_KEY", "dev-only-change-me").encode()
        key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest()).decode()
    return Fernet(key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()
