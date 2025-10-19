from __future__ import annotations

import json
from hashlib import sha256
from typing import Any, Dict, Optional

from redis.asyncio import Redis

from app.core.config import settings


class CacheService:
    """
    Thin wrapper around Redis for namespaced caching of chat responses.
    """

    def __init__(self, client: Redis) -> None:
        self._client = client
        self._ttl = settings.cache_ttl_seconds

    @staticmethod
    def build_key(slug: str, payload: Dict[str, Any]) -> str:
        serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        digest = sha256(serialized.encode("utf-8")).hexdigest()
        return f"chat:{slug}:{digest}"

    async def get(self, key: str) -> Optional[Dict[str, Any]]:
        value = await self._client.get(key)
        if value is None:
            return None
        return json.loads(value)

    async def set(self, key: str, data: Dict[str, Any]) -> None:
        await self._client.set(key, json.dumps(data), ex=self._ttl)
