from typing import List, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db_session, get_embedding_service
from app.schemas.documents import DocumentChunkPayload, DocumentIngestRequest, DocumentIngestResponse
from app.services.embeddings import EmbeddingService
from app.services.retriever import DocumentRetriever

router = APIRouter(prefix="/documents", tags=["documents"])


def build_chunks(request: DocumentIngestRequest) -> List[Tuple[str, str, dict]]:
    if request.chunks:
        return [(chunk.heading, chunk.content, chunk.metadata) for chunk in request.chunks]

    assembled: List[Tuple[str, str, dict]] = []

    if request.description:
        assembled.append(
            (
                "Problem description",
                request.description,
                {"section": "description", "difficulty": request.difficulty},
            ),
        )

    if request.constraints:
        assembled.append(
            (
                "Constraints",
                request.constraints,
                {"section": "constraints"},
            ),
        )

    if request.examples:
        examples_text = "\n\n".join(request.examples)
        assembled.append(
            (
                "Worked examples",
                examples_text,
                {"section": "examples", "count": len(request.examples)},
            ),
        )

    if not assembled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No content to index.")

    return assembled


@router.post("", response_model=DocumentIngestResponse)
async def ingest_problem_document(
    request: DocumentIngestRequest,
    session: AsyncSession = Depends(get_db_session),
    embeddings: EmbeddingService = Depends(get_embedding_service),
) -> DocumentIngestResponse:
    retriever = DocumentRetriever(session=session, embeddings=embeddings)

    chunks = build_chunks(request)
    await retriever.upsert(
        slug=request.slug,
        base_title=request.title,
        chunks=chunks,
    )

    return DocumentIngestResponse(chunks_indexed=len(chunks))
