from collections.abc import AsyncIterator
from functools import lru_cache

from fastapi import Depends
from redis import asyncio as aioredis
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_session
from app.services.cache import CacheService
from app.services.embeddings import EmbeddingService
from app.services.rag import RAGPipeline
from app.services.retriever import DocumentRetriever


async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with get_session() as session:
        yield session


_redis_client: Redis | None = None


async def get_redis_client() -> Redis:
    global _redis_client  # noqa: PLW0603 - module-level cache is intentional
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def get_cache_service(
    redis_client=Depends(get_redis_client),
) -> CacheService:
    return CacheService(redis_client)


@lru_cache
def get_embedding_service() -> EmbeddingService:
    return EmbeddingService()


async def get_rag_pipeline(
    session: AsyncSession = Depends(get_db_session),
    embeddings: EmbeddingService = Depends(get_embedding_service),
    cache: CacheService = Depends(get_cache_service),
) -> RAGPipeline:
    retriever = DocumentRetriever(session=session, embeddings=embeddings)
    return RAGPipeline(retriever=retriever, cache=cache)
