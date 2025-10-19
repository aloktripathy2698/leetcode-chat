from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, HttpUrl


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ProblemPayload(BaseModel):
    slug: str
    title: str
    difficulty: Literal["Easy", "Medium", "Hard"]
    description: str
    url: Optional[HttpUrl] = None


class SourceDocument(BaseModel):
    title: str
    snippet: str
    metadata: dict = Field(default_factory=dict)


class ChatRequest(BaseModel):
    question: str
    problem: ProblemPayload
    history: List[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    success: bool = True
    answer: str
    summary: str
    sources: List[SourceDocument] = Field(default_factory=list)
