"""Maintainer accounts: sign up with a GitHub username and a password, then sign in.

Sign-up checks three things:
1. the GitHub username exists (public GitHub API),
2. it is listed as a maintainer of at least one project that was uploaded, and
3. the username is not already registered.

Limit: GitHub does not accept passwords through its API, so the password is Sniffer's own. Proving that the
person owns the GitHub account needs GitHub sign-in (OAuth), which is not implemented here.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from .db import Database
from .github import GitHubError, valid_login
from .github import user as github_user

SESSION_SECONDS = 12 * 3600
ITERATIONS = 200_000


class AuthError(Exception):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS).hex()


def _check_password_rules(password: str) -> None:
    if len(password) < 10:
        raise AuthError("Use a password of at least 10 characters.", 422)


def sign_up(db: Database, login: str, password: str) -> str:
    login = (login or "").strip()
    if not valid_login(login):
        raise AuthError("That is not a valid GitHub username.", 422)
    _check_password_rules(password)
    if db.user(login):
        raise AuthError("An account for this username already exists. Sign in instead.", 409)
    try:
        canonical = github_user(db, login)["login"]
    except GitHubError as err:
        if err.status == 404:
            raise AuthError(f"No GitHub user called '{login}' exists.", 404) from err
        raise AuthError(str(err), err.status) from err
    if not db.projects_for(canonical):
        raise AuthError(
            "This GitHub user is not listed as a maintainer of any project. Ask a maintainer to upload a project "
            "file that lists you.",
            403,
        )
    salt = secrets.token_hex(16)
    db.create_user(canonical, salt, _hash(password, salt))
    return open_session(db, canonical)


def sign_in(db: Database, login: str, password: str) -> str:
    account = db.user((login or "").strip())
    # Same message for "no such user" and "wrong password", and the hash is computed either way.
    salt = account["salt"] if account else secrets.token_hex(16)
    ok = hmac.compare_digest(_hash(password or "", salt), account["pw_hash"] if account else "")
    if not account or not ok:
        raise AuthError("Username or password is incorrect.", 401)
    return open_session(db, account["login"])


def open_session(db: Database, login: str) -> str:
    token = secrets.token_urlsafe(32)
    db.add_session(token, login, int(time.time()) + SESSION_SECONDS)
    return token


def current_login(db: Database, token: str | None) -> str | None:
    if not token:
        return None
    s = db.session(token)
    if not s or s["expires_at"] < time.time():
        return None
    return s["login"]
