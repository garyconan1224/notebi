from __future__ import annotations

"""Pipeline public API contracts for supported task types."""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import pipeline as pipeline_module
from backend.app.services.pipeline_tasks import register_pipeline_handlers
from backend.app.services.task_runner import TaskRunner
from backend.app.services.task_store import TaskStore


@pytest.fixture()
def client(tmp_path: Path):
    """Use an isolated runner so rejected requests cannot create real tasks."""
    runner = TaskRunner(TaskStore(path=tmp_path / "tasks.json"))
    register_pipeline_handlers(runner)
    app = FastAPI()
    with patch.object(pipeline_module, "_runner", runner):
        app.include_router(pipeline_module.router)
        with TestClient(app) as test_client:
            yield test_client, runner


@pytest.mark.parametrize("task_type", ["create", "storyboard"])
def test_retired_task_type_is_rejected_before_task_is_persisted(
    client: tuple[TestClient, TaskRunner], task_type: str,
) -> None:
    """Removed product tasks must not become accepted-and-later-failed records."""
    test_client, runner = client

    response = test_client.post(
        "/pipeline/tasks",
        json={"project_id": "project-1", "task_type": task_type, "payload": {}},
    )

    assert response.status_code == 400
    assert "unsupported task_type" in response.json()["detail"]
    assert runner.store.list_all() == []
