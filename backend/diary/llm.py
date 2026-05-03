"""Ollama HTTP client.

Wraps the subset of `localhost:11434` we need:
  - GET  /api/tags          → list installed models
  - POST /api/pull          → stream pull progress (NDJSON)
  - POST /api/embeddings    → embed text
  - POST /api/generate      → JSON-mode completion

Everything is async via httpx so the FastAPI worker can pump SSE while
extraction runs in parallel.
"""
from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from .config import EMBED_DIM, EMBED_MODEL, LLM_MODEL, OLLAMA_URL


class OllamaError(Exception):
    """Raised for any Ollama-side problem we want to bubble up."""


class OllamaClient:
    def __init__(self, base_url: str = OLLAMA_URL, *, timeout: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout

    # ---------------------------------------------------------------- status

    async def is_reachable(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                r = await client.get(f"{self.base_url}/api/version")
                return r.status_code == 200
        except (httpx.HTTPError, OSError):
            return False

    async def list_models(self) -> list[str]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                r = await client.get(f"{self.base_url}/api/tags")
            except (httpx.HTTPError, OSError) as e:
                raise OllamaError(f"ollama unreachable: {e}") from e
        if r.status_code != 200:
            raise OllamaError(f"ollama returned {r.status_code}: {r.text}")
        data = r.json()
        return [m["name"] for m in data.get("models", [])]

    async def status(self) -> dict[str, object]:
        """Compact status object for /api/llm/status."""
        if not await self.is_reachable():
            return {
                "ollama": False,
                "url": self.base_url,
                "models": {LLM_MODEL: False, EMBED_MODEL: False},
            }
        try:
            installed = set(await self.list_models())
        except OllamaError:
            installed = set()
        # Match either by exact tag or by the bare name (Ollama appends ":latest").
        def has(name: str) -> bool:
            return name in installed or f"{name}:latest" in installed or any(
                m.split(":")[0] == name.split(":")[0] for m in installed
            )

        return {
            "ollama": True,
            "url": self.base_url,
            "models": {LLM_MODEL: has(LLM_MODEL), EMBED_MODEL: has(EMBED_MODEL)},
            "installed": sorted(installed),
        }

    # ---------------------------------------------------------------- pull

    async def pull(self, model: str) -> AsyncIterator[dict]:
        """Streams the NDJSON progress objects from `POST /api/pull`."""
        url = f"{self.base_url}/api/pull"
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream("POST", url, json={"name": model, "stream": True}) as r:
                    if r.status_code != 200:
                        body = await r.aread()
                        raise OllamaError(
                            f"ollama pull failed {r.status_code}: {body.decode(errors='replace')}"
                        )
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        try:
                            yield json.loads(line)
                        except json.JSONDecodeError:
                            continue
            except (httpx.HTTPError, OSError) as e:
                raise OllamaError(f"ollama unreachable: {e}") from e

    # ---------------------------------------------------------------- embed

    async def embed(self, text: str, model: str | None = None) -> list[float]:
        m = model or EMBED_MODEL
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                r = await client.post(
                    f"{self.base_url}/api/embeddings",
                    json={"model": m, "prompt": text},
                )
            except (httpx.HTTPError, OSError) as e:
                raise OllamaError(f"ollama unreachable: {e}") from e
        if r.status_code != 200:
            raise OllamaError(f"embeddings {r.status_code}: {r.text}")
        data = r.json()
        emb = data.get("embedding")
        if not isinstance(emb, list):
            raise OllamaError(f"unexpected embeddings response: {data}")
        if len(emb) != EMBED_DIM:
            # Some models return larger vectors. Truncate or pad to keep schema stable.
            if len(emb) > EMBED_DIM:
                emb = emb[:EMBED_DIM]
            else:
                emb = emb + [0.0] * (EMBED_DIM - len(emb))
        return emb

    # ---------------------------------------------------------------- generate

    async def generate_json(
        self,
        prompt: str,
        *,
        model: str | None = None,
        format_schema: dict | None = None,
        system: str | None = None,
    ) -> dict:
        """JSON-mode completion. Returns parsed dict; raises if invalid JSON."""
        m = model or LLM_MODEL
        body: dict[str, object] = {
            "model": m,
            "prompt": prompt,
            "stream": False,
            "format": format_schema if format_schema is not None else "json",
            "options": {"temperature": 0.1},
        }
        if system:
            body["system"] = system
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                r = await client.post(f"{self.base_url}/api/generate", json=body)
            except (httpx.HTTPError, OSError) as e:
                raise OllamaError(f"ollama unreachable: {e}") from e
        if r.status_code != 200:
            raise OllamaError(f"generate {r.status_code}: {r.text}")
        data = r.json()
        raw = data.get("response", "")
        if not isinstance(raw, str):
            raise OllamaError(f"unexpected generate response: {data}")
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise OllamaError(f"model returned non-JSON: {raw[:200]}") from e
