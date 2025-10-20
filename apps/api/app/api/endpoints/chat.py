import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

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


@router.post("/stream")
async def stream_chat_completion(
    request: ChatRequest,
    pipeline: RAGPipeline = Depends(get_rag_pipeline),
) -> StreamingResponse:
    if not request.question.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Question cannot be empty.")

    async def event_generator():
        try:
            async for event in pipeline.stream(request):
                yield f"{json.dumps(event, ensure_ascii=False)}\n"
        except Exception as exc:  # noqa: BLE001
            yield f'{json.dumps({"type": "error", "error": str(exc)})}\n'

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")
