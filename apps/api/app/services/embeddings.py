from __future__ import annotations

from typing import List

from langchain_openai import OpenAIEmbeddings

from app.core.config import settings


class EmbeddingService:
    """
    Provides access to OpenAI embeddings for queries and documents.
    """

    def __init__(self) -> None:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured. Update apps/api/.env before running the service.")

        self._model = settings.embedding_model
        self._embedder = OpenAIEmbeddings(
            model=self._model,
            openai_api_key=settings.openai_api_key,
        )

    async def embed_query(self, text: str) -> List[float]:
        return await self._embedder.aembed_query(text)

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._embedder.aembed_documents(texts)
