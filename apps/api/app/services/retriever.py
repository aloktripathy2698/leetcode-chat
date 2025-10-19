from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Sequence

from sqlalchemy import Select, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document
from app.services.embeddings import EmbeddingService


@dataclass
class DocumentChunk:
    title: str
    content: str
    metadata: Dict[str, Any]
    distance: float

    def to_prompt_snippet(self) -> str:
        source = self.metadata.get("source", "LeetCode")
        return f"[{source}] {self.title}\n{self.content}"


class DocumentRetriever:
    def __init__(self, session: AsyncSession, embeddings: EmbeddingService, top_k: int = 4) -> None:
        self._session = session
        self._embeddings = embeddings
        self._top_k = top_k

    async def search(self, slug: str, query: str, additional_context: Sequence[str] | None = None) -> List[DocumentChunk]:
        augmented_query = query
        if additional_context:
            augmented_query = f"{query}\n\n" + "\n\n".join(additional_context)

        query_vector = await self._embeddings.embed_query(augmented_query)

        stmt: Select[tuple[Document, float]] = (
            select(
                Document,
                Document.embedding.cosine_distance(query_vector).label("distance"),
            )
            .where(Document.slug == slug)
            .order_by(Document.embedding.cosine_distance(query_vector))
            .limit(self._top_k)
        )

        result = await self._session.execute(stmt)
        chunks: List[DocumentChunk] = []
        for document, distance in result.all():
            chunks.append(
                DocumentChunk(
                    title=document.title,
                    content=document.content,
                    metadata=document.metadata_json or {},
                    distance=float(distance or 0.0),
                ),
            )

        return chunks

    async def upsert(
        self,
        slug: str,
        base_title: str,
        chunks: Sequence[tuple[str, str, Dict[str, Any]]],
    ) -> None:
        if not chunks:
            return

        contents = [content for _, content, _ in chunks]
        embeddings = await self._embeddings.embed_documents(contents)

        await self._session.execute(delete(Document).where(Document.slug == slug))

        for index, ((chunk_title, content, metadata), vector) in enumerate(zip(chunks, embeddings, strict=True)):
            document = Document(
                slug=slug,
                title=f"{base_title} | {chunk_title}" if chunk_title else base_title,
                content=content,
                metadata_json={**metadata, "chunk_index": index, "base_title": base_title},
                embedding=vector,
            )
            self._session.add(document)

        await self._session.commit()
