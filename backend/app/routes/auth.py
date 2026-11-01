"""Sign up, sign in, sign out, and "who am I". The session is an HttpOnly cookie."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from ..auth import SESSION_SECONDS, AuthError, current_login, sign_in, sign_up
from ..db import Database
from ..models import Credentials
from .deps import database

router = APIRouter(prefix="/api/auth", tags=["auth"])
COOKIE = "sniffer_session"


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, samesite="strict", path="/")


@router.post("/signup")
def signup(body: Credentials, response: Response, db: Database = Depends(database)):
    try:
        token = sign_up(db, body.login, body.password)
    except AuthError as err:
        return _error(response, err)
    _set_cookie(response, token)
    return {"login": current_login(db, token)}


@router.post("/login")
def login(body: Credentials, response: Response, db: Database = Depends(database)):
    try:
        token = sign_in(db, body.login, body.password)
    except AuthError as err:
        return _error(response, err)
    _set_cookie(response, token)
    return {"login": current_login(db, token)}


@router.post("/logout")
def logout(request: Request, response: Response, db: Database = Depends(database)):
    token = request.cookies.get(COOKIE)
    if token:
        db.end_session(token)
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request, db: Database = Depends(database)):
    login = current_login(db, request.cookies.get(COOKIE))
    if not login:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    return {"login": login}


def _error(response: Response, err: AuthError):
    return JSONResponse(status_code=err.status, content={"error": str(err)})
