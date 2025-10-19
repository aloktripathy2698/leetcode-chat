from fastapi import APIRouter

api_router = APIRouter()

from . import routes  # noqa: E402  # pylint: disable=wrong-import-position

__all__ = ["api_router"]
