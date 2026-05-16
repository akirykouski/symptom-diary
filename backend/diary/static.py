"""Serve the built single-page app for end users.

In development the React app is served by the Vite dev server (port 5173)
and this module is a no-op. For end users the launcher builds the frontend
into ``frontend/dist`` and the same FastAPI process serves it, so the whole
app is a single process on a single URL (http://127.0.0.1:8765).

The catch-all is registered *after* every API router, so `/api/*`,
`/docs`, and `/openapi.json` always win. Any other path serves the matching
static file if it exists, otherwise falls back to ``index.html`` so the
client-side router (incl. the `/m/*` mobile routes) works on deep links and
hard refreshes.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response

from .config import frontend_dist


def mount_spa(app: FastAPI) -> None:
    dist = frontend_dist()
    if dist is None:
        return  # development — Vite serves the frontend

    index = dist / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> Response:
        # Never shadow the API surface — let it 404 through the API layer.
        if full_path == "api" or full_path.startswith("api/"):
            return Response(status_code=404)

        if full_path:
            candidate = (dist / full_path).resolve()
            # Guard against path traversal, then serve real static assets
            # (JS/CSS bundles, manifest.json, sw.js, icons, …).
            if dist in candidate.parents and candidate.is_file():
                return FileResponse(candidate)

        return FileResponse(index)
