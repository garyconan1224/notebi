from __future__ import annotations

"""RAG QA routes."""

from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.app.services.rag_qa_service import ask_with_sources
from shared.config import EMBEDDING_MODEL

router = APIRouter(prefix="/rag", tags=["rag"])


class RagAskRequest(BaseModel):
    project_json_dir: str
    query: str
    embedding_model: str = EMBEDDING_MODEL
    api_key: str = ""


@router.post("/ask")
def rag_ask(req: RagAskRequest) -> Dict[str, Any]:
    try:
        return ask_with_sources(
            project_json_dir=req.project_json_dir,
            query=req.query,
            embedding_model=req.embedding_model,
            api_key=req.api_key,
        )
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(err)) from err
