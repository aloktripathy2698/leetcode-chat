from fastapi import APIRouter

from app.api import api_router
from app.api.endpoints.chat import router as chat_router
from app.api.endpoints.documents import router as documents_router

router = APIRouter()


@router.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """
    Basic health-check endpoint used by orchestrators and smoke tests.
    """

    return {"status": "healthy"}


api_router.include_router(router)
api_router.include_router(chat_router)
api_router.include_router(documents_router)
