from __future__ import annotations

import textwrap
from typing import Any, AsyncIterator, Dict, List, TypedDict

from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from app.core.config import settings
from app.schemas.chat import ChatRequest, ChatResponse, SourceDocument
from app.services.cache import CacheService
from app.services.retriever import DocumentChunk, DocumentRetriever


class PipelineState(TypedDict, total=False):
    question: str
    problem: Dict[str, Any]
    history: List[Dict[str, str]]
    context: List[DocumentChunk]
    answer: str
    summary: str
    sources: List[SourceDocument]


class RAGPipeline:
    def __init__(self, retriever: DocumentRetriever, cache: CacheService) -> None:
        self._retriever = retriever
        self._cache = cache
        self._answer_llm = ChatOpenAI(
            temperature=0.2,
            model=settings.openai_model,
            openai_api_key=settings.openai_api_key,
            streaming=True,
        )
        self._summary_llm = ChatOpenAI(
            temperature=0.2,
            model=settings.openai_model,
            openai_api_key=settings.openai_api_key,
        )
        self._answer_prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    textwrap.dedent(
                        """
                        You are an elite software engineering mentor helping users solve LeetCode problems.
                        Use the retrieved contextual snippets to craft explanations that are:
                        - precise, technically accurate, and aligned with the problem's constraints
                        - structured with clear steps, highlighting trade-offs when relevant
                        - encouraging, yet honest about complexities

                        Respond with detailed guidance in Markdown. Do not wrap your response in JSON.
                        """,
                    ).strip(),
                ),
                (
                    "human",
                    textwrap.dedent(
                        """
                        Problem:
                        Title: {problem_title}
                        Difficulty: {difficulty}
                        URL: {url}

                        Canonical description:
                        {problem_description}

                        Retrieved snippets:
                        {context}

                        Recent conversation:
                        {history}

                        Learner's latest question:
                        {question}
                        """,
                    ).strip(),
                ),
            ],
        )
        self._summary_prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    textwrap.dedent(
                        """
                        Summarise the mentor's answer into two or three concise bullet points.
                        Each bullet must be short (max 16 words) and highlight a key insight, strategy, or next step.
                        Output only the bullet list in Markdown.
                        """,
                    ).strip(),
                ),
                (
                    "human",
                    textwrap.dedent(
                        """
                        Problem: {problem_title} ({difficulty})
                        Learner question: {question}

                        Mentor answer:
                        {answer}
                        """,
                    ).strip(),
                ),
            ],
        )

    async def _retrieve_documents(self, state: PipelineState) -> PipelineState:
        problem_description = state["problem"].get("description", "")
        history_snippets = [message["content"] for message in state.get("history", [])[-3:]]
        context_chunks = await self._retriever.search(
            slug=state["problem"]["slug"],
            query=state["question"],
            additional_context=[problem_description, *history_snippets] if problem_description else history_snippets,
        )
        return {**state, "context": context_chunks}

    async def _prepare_prompt_inputs(self, request: ChatRequest) -> PipelineState:
        initial_state: PipelineState = {
            "question": request.question,
            "problem": request.problem.model_dump(),
            "history": [message.model_dump() for message in request.history],
        }
        state_with_context = await self._retrieve_documents(initial_state)
        return state_with_context

    @staticmethod
    def _build_prompt_variables(state: PipelineState) -> Dict[str, str]:
        context_snippets = "\n\n".join(chunk.to_prompt_snippet() for chunk in state.get("context", [])) or "No extra context available."
        history_lines = "\n".join(f"{message['role'].title()}: {message['content']}" for message in state.get("history", [])) or "No prior conversation."
        return {
            "problem_title": state["problem"]["title"],
            "difficulty": state["problem"]["difficulty"],
            "url": state["problem"].get("url", "n/a"),
            "problem_description": state["problem"].get("description", "Not provided."),
            "context": context_snippets,
            "history": history_lines,
            "question": state["question"],
        }

    @staticmethod
    def _build_sources(chunks: List[DocumentChunk]) -> List[SourceDocument]:
        return [
            SourceDocument(
                title=chunk.title,
                snippet=chunk.content[:500],
                metadata={**chunk.metadata, "distance": round(chunk.distance, 4)},
            )
            for chunk in chunks
        ]

    async def _run_answer_chain(self, state: PipelineState) -> str:
        variables = self._build_prompt_variables(state)
        response = await (self._answer_prompt | self._answer_llm).ainvoke(variables)
        return response.content.strip()

    async def _run_summary_chain(self, state: PipelineState, answer: str) -> str:
        summary_response = await (
            self._summary_prompt
            | self._summary_llm
        ).ainvoke(
            {
                "problem_title": state["problem"]["title"],
                "difficulty": state["problem"]["difficulty"],
                "question": state["question"],
                "answer": answer,
            }
        )
        return summary_response.content.strip()

    async def run(self, request: ChatRequest) -> ChatResponse:
        cache_key = self._cache.build_key(
            request.problem.slug,
            {"question": request.question, "history": [message.model_dump() for message in request.history]},
        )
        cached = await self._cache.get(cache_key)
        if cached:
            return ChatResponse(**cached)

        state = await self._prepare_prompt_inputs(request)
        answer_text = await self._run_answer_chain(state)
        summary_text = await self._run_summary_chain(state, answer_text)
        sources = self._build_sources(state.get("context", []))

        response_payload = ChatResponse(
            answer=answer_text,
            summary=summary_text,
            sources=sources,
        )

        await self._cache.set(cache_key, response_payload.model_dump())
        return response_payload

    async def stream(self, request: ChatRequest) -> AsyncIterator[Dict[str, Any]]:
        cache_key = self._cache.build_key(
            request.problem.slug,
            {"question": request.question, "history": [message.model_dump() for message in request.history]},
        )
        cached = await self._cache.get(cache_key)
        if cached:
            yield {"type": "cached", "payload": cached}
            return

        state = await self._prepare_prompt_inputs(request)
        sources = self._build_sources(state.get("context", []))
        yield {"type": "sources", "sources": [source.model_dump() for source in sources]}

        variables = self._build_prompt_variables(state)

        answer_parts: List[str] = []
        async for chunk in (self._answer_prompt | self._answer_llm).astream(variables):
            content_piece = ""
            if isinstance(chunk.content, str):
                content_piece = chunk.content
            elif isinstance(chunk.content, list):
                content_piece = "".join(
                    part.get("text", "")
                    if isinstance(part, dict)
                    else getattr(part, "text", str(part))
                    for part in chunk.content
                )
            else:
                content_piece = getattr(chunk, "text", "") or ""

            if not content_piece:
                continue
            answer_parts.append(content_piece)
            yield {"type": "token", "token": content_piece}

        answer_text = "".join(answer_parts).strip()
        summary_text = await self._run_summary_chain(state, answer_text)
        yield {"type": "summary", "summary": summary_text}

        response_payload = ChatResponse(answer=answer_text, summary=summary_text, sources=sources)
        await self._cache.set(cache_key, response_payload.model_dump())
        yield {"type": "end", "payload": response_payload.model_dump()}
