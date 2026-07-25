from __future__ import annotations

"""Global knowledge endpoints."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.routes.pipeline import _runner as _pipeline_runner
from backend.app.services.retrieval_service import RetrievalService

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class KnowledgeAskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=30)
    workspace_ids: Optional[List[str]] = None


class KnowledgeRebuildRequest(BaseModel):
    force: bool = False


@router.get("/status")
def knowledge_status() -> Dict[str, Any]:
    try:
        return RetrievalService(task_store=_pipeline_runner.store).status()
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/rebuild")
def knowledge_rebuild(req: KnowledgeRebuildRequest | None = None) -> Dict[str, Any]:
    try:
        return RetrievalService(task_store=_pipeline_runner.store).start_rebuild(
            force=bool(req.force) if req else False
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/ask")
def knowledge_ask(req: KnowledgeAskRequest) -> Dict[str, Any]:
    try:
        return RetrievalService(task_store=_pipeline_runner.store).search(
            query=req.question,
            mode="smart",
            top_k=req.top_k,
            workspace_ids=req.workspace_ids,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
