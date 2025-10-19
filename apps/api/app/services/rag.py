from __future__ import annotations

import json
import textwrap
from typing import Any, Dict, List, TypedDict

from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

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
        self._llm = ChatOpenAI(
            temperature=0.2,
            model=settings.openai_model,
            openai_api_key=settings.openai_api_key,
        )
        self._prompt = ChatPromptTemplate.from_messages(
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

                        Always respond STRICTLY as JSON with keys "answer" and "summary".
                        Example:
                        {{"answer": "<detailed guidance>", "summary": "<2-3 bullet takeaway>"}}
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

                        Retrieved knowledge:
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
        self._graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(PipelineState)
        graph.add_node("retrieve", self._retrieve_documents)
        graph.add_node("generate", self._generate_answer)
        graph.set_entry_point("retrieve")
        graph.add_edge("retrieve", "generate")
        graph.add_edge("generate", END)
        return graph.compile()

    async def _retrieve_documents(self, state: PipelineState) -> PipelineState:
        problem_description = state["problem"].get("description", "")
        history_snippets = [message["content"] for message in state.get("history", [])[-3:]]
        context_chunks = await self._retriever.search(
            slug=state["problem"]["slug"],
            query=state["question"],
            additional_context=[problem_description, *history_snippets] if problem_description else history_snippets,
        )
        return {**state, "context": context_chunks}

    async def _generate_answer(self, state: PipelineState) -> PipelineState:
        context_snippets = "\n\n".join(chunk.to_prompt_snippet() for chunk in state.get("context", [])) or "No extra context available."
        history_lines = "\n".join(f"{message['role'].title()}: {message['content']}" for message in state.get("history", [])) or "No prior conversation."

        variables = {
            "problem_title": state["problem"]["title"],
            "difficulty": state["problem"]["difficulty"],
            "url": state["problem"].get("url", "n/a"),
            "problem_description": state["problem"].get("description", "Not provided."),
            "context": context_snippets,
            "history": history_lines,
            "question": state["question"],
        }

        response = await (self._prompt | self._llm).ainvoke(variables)
        content = response.content.strip()

        cleaned = content
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            payload = json.loads(cleaned)
        except json.JSONDecodeError:
            payload = {"answer": content, "summary": "Review detailed guidance above."}

        sources = [
            SourceDocument(
                title=chunk.title,
                snippet=chunk.content[:500],
                metadata={**chunk.metadata, "distance": round(chunk.distance, 4)},
            )
            for chunk in state.get("context", [])
        ]

        summary_value = payload.get("summary", "")
        if isinstance(summary_value, list):
            summary_value = "\n".join(str(item) for item in summary_value if item)
        elif summary_value is None:
            summary_value = ""

        return {
            **state,
            "answer": payload.get("answer", content),
            "summary": summary_value,
            "sources": sources,
        }

    async def run(self, request: ChatRequest) -> ChatResponse:
        cache_key = self._cache.build_key(
            request.problem.slug,
            {"question": request.question, "history": [message.model_dump() for message in request.history]},
        )
        cached = await self._cache.get(cache_key)
        if cached:
            return ChatResponse(**cached)

        initial_state: PipelineState = {
            "question": request.question,
            "problem": request.problem.model_dump(),
            "history": [message.model_dump() for message in request.history],
        }

        final_state = await self._graph.ainvoke(initial_state)
        response_payload = ChatResponse(
            answer=final_state["answer"],
            summary=final_state["summary"],
            sources=[source if isinstance(source, SourceDocument) else SourceDocument(**source) for source in final_state.get("sources", [])],
        )

        await self._cache.set(cache_key, response_payload.model_dump())
        return response_payload
