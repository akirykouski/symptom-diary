"""FastAPI application factory."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import ollama_setup
from .config import DEV_FRONTEND_ORIGIN
from .extraction import worker_loop
from .routes.auth import router as auth_router
from .routes.demo import router as demo_router
from .routes.documents import router as documents_router
from .routes.entities import router as entities_router
from .routes.entries import router as entries_router
from .routes.graph import router as graph_router
from .routes.hypotheses import router as hypotheses_router
from .routes.insights import router as insights_router
from .routes.llm import router as llm_router
from .routes.media import router as media_router
from .routes.ollama_admin import router as ollama_admin_router
from .routes.tags import router as tags_router


@asynccontextmanager
async def _lifespan(_: FastAPI):
    """Spawn one extraction worker for the life of the app, and tear down the
    managed Ollama daemon (if any) on shutdown."""
    task = asyncio.create_task(worker_loop(), name="extraction-worker")
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        ollama_setup.shutdown()


app = FastAPI(title="Symptom Diary", version="0.1.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[DEV_FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(entries_router)
app.include_router(tags_router)
app.include_router(llm_router)
app.include_router(entities_router)
app.include_router(graph_router)
app.include_router(media_router)
app.include_router(documents_router)
app.include_router(hypotheses_router)
app.include_router(insights_router)
app.include_router(demo_router)
app.include_router(ollama_admin_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
