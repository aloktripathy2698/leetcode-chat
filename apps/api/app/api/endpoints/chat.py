from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_rag_pipeline
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.rag import RAGPipeline

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def create_chat_completion(
    request: ChatRequest,
    pipeline: RAGPipeline = Depends(get_rag_pipeline),
) -> ChatResponse:
    if not request.question.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Question cannot be empty.")

    try:
        return await pipeline.run(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
