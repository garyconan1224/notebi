from __future__ import annotations

"""Phase 3B.3：跨工作空间 RAG 检索路由。

POST /search
  请求体：{query: str, top_k?: int = 10, workspace_ids?: string[]}
  返回：{answer, sources[]}
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.routes.pipeline import _runner as _pipeline_runner
from backend.app.services.workspace_search_service import search_across_workspaces

router = APIRouter(tags=["search"])


class GlobalSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=30)
    workspace_ids: Optional[List[str]] = None


@router.post("/search")
def global_search(req: GlobalSearchRequest) -> Dict[str, Any]:
    """跨工作空间检索；workspace_ids 为空 = 全部。"""
    try:
        return search_across_workspaces(
            query=req.query,
            top_k=req.top_k,
            workspace_ids=req.workspace_ids,
            task_store=_pipeline_runner.store,
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
