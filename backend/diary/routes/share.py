"""QR share-token endpoints + the public read-only `/share/<token>/...` route.

Two halves live here:

  - `/api/export/qr-session` (auth-required): the journal owner mints a
    one-shot share token, gets a URL + QR data-URL back, and shows it to
    the clinician.

  - `/share/<token>/brief.html` (public, no auth): the clinician's phone
    fetches the brief by token. Validity = token exists + not expired +
    journal still unlocked. There is no session cookie for the clinician
    — the share token *is* the credential, and it expires.
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .. import brief
from ..config import db_path, salt_path
from ..deps import require_unlocked
from ..qr_share import (
    DEFAULT_TTL_MINUTES,
    MAX_TTL_MINUTES,
    SCOPES,
    detect_lan_ip,
    is_lan_ip,
    render_qr_data_url,
    share_url,
    store as share_store,
)
from ..session import store as session_store


router = APIRouter(tags=["share"])


# ---------- request / response models ---------------------------------------


class QrSessionRequest(BaseModel):
    ttl_minutes: int = Field(DEFAULT_TTL_MINUTES, ge=1, le=MAX_TTL_MINUTES)
    scope: str = Field("brief")


def _backend_port() -> int:
    return int(os.environ.get("DIARY_PORT", "8765"))


def _backend_host_override() -> str | None:
    """If `DIARY_LAN_HOST` is set, use that — useful when running behind a
    static-DNS hostname like `diary.local`."""
    v = os.environ.get("DIARY_LAN_HOST", "").strip()
    return v or None


# ---------- owner-side endpoints --------------------------------------------


@router.post("/api/export/qr-session")
def create_qr_session(body: QrSessionRequest, _conn=Depends(require_unlocked)) -> dict[str, Any]:
    if body.scope not in SCOPES:
        raise HTTPException(status_code=400, detail=f"unknown_scope:{body.scope}")
    if body.scope != "brief":
        # MVP-4 only ships the brief scope; "full" stays reserved for later.
        raise HTTPException(status_code=400, detail="scope_not_implemented")

    token = share_store.create(scope=body.scope, ttl_minutes=body.ttl_minutes)
    host = _backend_host_override() or detect_lan_ip()
    port = _backend_port()
    url = share_url(token.token, scope=token.scope, host=host, port=port)
    qr_data_url = render_qr_data_url(url)

    return {
        **token.to_public(),
        "url": url,
        "qr_data_url": qr_data_url,
        "lan_ok": is_lan_ip(host),
        "host": host,
        "port": port,
    }


@router.get("/api/export/qr-sessions")
def list_qr_sessions(_conn=Depends(require_unlocked)) -> dict[str, Any]:
    active = [t.to_public() for t in share_store.list_active()]
    return {"sessions": active}


@router.delete("/api/export/qr-session/{token}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_qr_session(token: str, _conn=Depends(require_unlocked)) -> None:
    share_store.revoke(token)
    return None


# ---------- public share endpoint -------------------------------------------


_SHARE_DISCLAIMER = (
    '<div style="background:#fff3cd;border:1px solid #f0c36d;padding:10px 14px;'
    'border-radius:8px;margin:0 0 18px 0;font-size:13px;color:#7a4f00;">'
    'Read-only patient summary. Patient-reported context — not a diagnosis. '
    'This view will become unavailable when the share token expires or the '
    'journal is locked.</div>'
)


@router.get("/share/{token}/brief.html", response_class=HTMLResponse)
def share_brief(token: str, _request: Request) -> HTMLResponse:
    st = share_store.consume(token)
    if st is None:
        raise HTTPException(status_code=410, detail="token_expired_or_invalid")
    if st.scope != "brief":
        raise HTTPException(status_code=403, detail="scope_mismatch")

    # Need the user's connection — peek so we don't bump the session.
    conn = session_store.peek_conn()
    if conn is None:
        # User locked or auto-locked — surface a graceful "owner is offline"
        # rather than rendering stale data.
        return HTMLResponse(
            content=_locked_html(), status_code=410, media_type="text/html; charset=utf-8"
        )
    if not db_path().exists() or not salt_path().exists():
        # Defensive — should never happen if conn is present.
        raise HTTPException(status_code=410, detail="install_missing")

    ctx = brief.gather_context(conn)
    md = brief.render_markdown(ctx)
    html = brief.render_html(md)
    # Inject the share-mode banner just after the <body> tag.
    html = html.replace("<body>", "<body>\n" + _SHARE_DISCLAIMER, 1)
    return HTMLResponse(content=html, media_type="text/html; charset=utf-8")


def _locked_html() -> str:
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<title>Symptom Diary — share unavailable</title>"
        "<style>body{font:14px/1.55 -apple-system,system-ui,sans-serif;"
        "color:#444;max-width:520px;margin:60px auto;padding:0 24px;text-align:center;}"
        "h1{font-size:20px;color:#222;}"
        "</style></head><body>"
        "<h1>Share link is no longer available</h1>"
        "<p>The patient's journal is locked or the share token has expired. "
        "Please ask the patient to unlock the journal and create a fresh QR share.</p>"
        "</body></html>"
    )
