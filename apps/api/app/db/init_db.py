from sqlalchemy import text

from app.db.base import Base
from app.db.session import engine
from app import models  # noqa: F401 -- ensure models are registered with metadata


async def init_db() -> None:
    """
    Ensure database extensions and tables exist before serving traffic.
    """

    async with engine.begin() as connection:
        await connection.execute(text('CREATE EXTENSION IF NOT EXISTS "vector";'))
        await connection.run_sync(Base.metadata.create_all)
