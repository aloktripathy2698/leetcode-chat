from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, HttpUrl


class DocumentChunkPayload(BaseModel):
    heading: str = Field(default="")
    content: str
    metadata: Dict[str, str] = Field(default_factory=dict)


class DocumentIngestRequest(BaseModel):
    slug: str
    title: str
    difficulty: Literal["Easy", "Medium", "Hard"]
    url: Optional[HttpUrl] = None
    description: str
    examples: List[str] = Field(default_factory=list)
    constraints: str = ""
    chunks: List[DocumentChunkPayload] = Field(default_factory=list)


class DocumentIngestResponse(BaseModel):
    success: bool = True
    chunks_indexed: int
