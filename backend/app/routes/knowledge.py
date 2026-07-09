from __future__ import annotations

"""Global knowledge endpoints."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.routes.pipeline import _runner as _pipeline_runner
from backend.app.services.global_knowledge import (
    ask_global,
    get_global_status,
    start_global_rebuild,
)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class KnowledgeAskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=30)
    workspace_ids: Optional[List[str]] = None
    kinds: Optional[List[str]] = None


class KnowledgeRebuildRequest(BaseModel):
    force: bool = False
    kinds: Optional[List[str]] = None


@router.get("/status")
def knowledge_status(kinds: Optional[List[str]] = Query(default=None)) -> Dict[str, Any]:
    try:
        return get_global_status(task_store=_pipeline_runner.store, allowed_kinds=kinds)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/rebuild")
def knowledge_rebuild(req: KnowledgeRebuildRequest | None = None) -> Dict[str, Any]:
    try:
        return start_global_rebuild(
            force=bool(req.force) if req else False,
            task_store=_pipeline_runner.store,
            allowed_kinds=req.kinds if req else None,
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/ask")
def knowledge_ask(req: KnowledgeAskRequest) -> Dict[str, Any]:
    try:
        return ask_global(
            question=req.question,
            top_k=req.top_k,
            workspace_ids=req.workspace_ids,
            allowed_kinds=req.kinds,
            task_store=_pipeline_runner.store,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
