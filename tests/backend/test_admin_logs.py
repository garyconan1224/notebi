"""R6-A + S2 — 脱敏运行日志与只读 API 测试。

覆盖点：
- 上限：deque(maxlen) 满后丢弃最旧；
- after_id：增量查询只返回更新的条目；
- before_id：向前分页；
- 过滤：level / category / task_id / batch_id / workspace_id / limit；
- 重复 handler：install 幂等，uninstall 移除；
- 脱敏：密钥（Bearer/api_key/token/secret）与绝对路径；
- 422：非法 after_id / limit 参数；
- 只读：POST/DELETE /admin/logs 返回 405。
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import admin as admin_module
from backend.app.services import runtime_log_buffer as rlb
from backend.app.services import runtime_log_store as rls
from backend.app.services.runtime_log_store import RuntimeLogStore


@pytest.fixture()
def buffer() -> rlb.RuntimeLogBuffer:
    return rlb.RuntimeLogBuffer()


@pytest.fixture()
def store(tmp_path: Path) -> RuntimeLogStore:
    return RuntimeLogStore(tmp_path, max_bytes=1024 * 1024)


@pytest.fixture()
def client(store: RuntimeLogStore):
    app = FastAPI()
    app.include_router(admin_module.router)
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(admin_module, "get_default_store", lambda: store)
        with TestClient(app) as c:
            yield c


# --------------------------------------------------------------------------- #
# Buffer 单元行为
# --------------------------------------------------------------------------- #
def test_buffer_respects_maxlen() -> None:
    buf = rlb.RuntimeLogBuffer(maxlen=10)
    for i in range(25):
        buf.append("INFO", "test", f"msg-{i}")
    entries = buf.query(limit=100)
    assert len(entries) == 10
    # 最旧的被丢弃，保留最新 10 条
    assert entries[0].message == "msg-15"
    assert entries[-1].message == "msg-24"


def test_ids_are_monotonic() -> None:
    buf = rlb.RuntimeLogBuffer()
    e1 = buf.append("INFO", "a", "m1")
    e2 = buf.append("INFO", "a", "m2")
    e3 = buf.append("INFO", "a", "m3")
    assert e1.id < e2.id < e3.id
    assert e2.id == e1.id + 1


def test_entries_carry_timestamp_level_category() -> None:
    buf = rlb.RuntimeLogBuffer()
    entry = buf.append("WARNING", "app.startup", "ready")
    assert entry.timestamp > 0
    assert entry.level == "WARNING"
    assert entry.category == "app.startup"
    assert entry.message == "ready"


def test_query_after_id() -> None:
    buf = rlb.RuntimeLogBuffer()
    for i in range(5):
        buf.append("INFO", "cat", f"m{i}")
    entries = buf.query(after_id=3, limit=100)
    assert [e.id for e in entries] == [4, 5]


def test_query_level_filter() -> None:
    buf = rlb.RuntimeLogBuffer()
    buf.append("INFO", "app", "info-app")
    buf.append("ERROR", "app", "error-app")
    buf.append("INFO", "db", "info-db")
    assert [e.message for e in buf.query(level="ERROR")] == ["error-app"]


def test_query_category_filter() -> None:
    buf = rlb.RuntimeLogBuffer()
    buf.append("INFO", "app", "info-app")
    buf.append("INFO", "db", "info-db")
    assert [e.message for e in buf.query(category="db")] == ["info-db"]


def test_query_limit() -> None:
    buf = rlb.RuntimeLogBuffer()
    for i in range(10):
        buf.append("INFO", "c", f"m{i}")
    assert len(buf.query(limit=3)) == 3


def test_latest_id() -> None:
    buf = rlb.RuntimeLogBuffer()
    assert buf.latest_id == 0
    buf.append("INFO", "c", "m1")
    buf.append("INFO", "c", "m2")
    assert buf.latest_id == 2


# --------------------------------------------------------------------------- #
# Handler 安装 / 卸载
# --------------------------------------------------------------------------- #
def test_install_handler_is_idempotent() -> None:
    logger = logging.getLogger("r6a.dup.test")
    logger.handlers.clear()
    buf = rlb.RuntimeLogBuffer()
    h1 = rlb.install(buf, logger=logger)
    h2 = rlb.install(buf, logger=logger)
    assert h1 is h2
    assert sum(1 for h in logger.handlers if isinstance(h, rlb.RuntimeLogHandler)) == 1
    rlb.uninstall(logger=logger)
    assert not any(isinstance(h, rlb.RuntimeLogHandler) for h in logger.handlers)


def test_handler_stores_sanitized_message() -> None:
    buf = rlb.RuntimeLogBuffer()
    logger = logging.getLogger("r6a.capture.test")
    logger.handlers.clear()
    logger.setLevel(logging.DEBUG)
    rlb.install(buf, logger=logger)
    try:
        logger.info("using api_key=supersecretvalue now")
    finally:
        rlb.uninstall(logger=logger)
    entries = buf.query()
    assert entries
    assert "supersecretvalue" not in entries[-1].message


def test_default_handler_writes_to_persistent_store(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """生产默认 handler 必须写入 /admin/logs 使用的持久 store。"""
    store = RuntimeLogStore(tmp_path / "logs")
    monkeypatch.setattr(rls, "_default_store", store)
    logger = logging.getLogger("standard-log.production-chain")
    logger.handlers.clear()
    logger.setLevel(logging.INFO)

    rlb.install(logger=logger)
    try:
        logger.info("persistent-standard-log")
    finally:
        rlb.uninstall(logger=logger)

    entries = store.query(limit=10).entries
    assert [entry.message for entry in entries] == ["persistent-standard-log"]


# --------------------------------------------------------------------------- #
# 脱敏
# --------------------------------------------------------------------------- #
def test_sanitize_bearer_token() -> None:
    out = rlb.sanitize_message("Authorization: Bearer sk-abc123xyz")
    assert "sk-abc123xyz" not in out
    assert "***" in out


def test_sanitize_api_key_value() -> None:
    out = rlb.sanitize_message("provider api_key=abc123secret loaded")
    assert "abc123secret" not in out
    assert "***" in out


def test_sanitize_url_key_param() -> None:
    out = rlb.sanitize_message("GET https://api.example.com/v1?token=tok-xyz789&x=1")
    assert "tok-xyz789" not in out
    assert "***" in out


def test_sanitize_secret_and_credential() -> None:
    assert "s3cr3t" not in rlb.sanitize_message("client secret=s3cr3t")
    assert "pw123" not in rlb.sanitize_message("credential: pw123")


def test_sanitize_absolute_path_keeps_filename() -> None:
    out = rlb.sanitize_message(
        "reading /Users/conan/Desktop/notebi/data/workspaces/ws-1/audio.mp3"
    )
    assert "/Users/conan" not in out
    assert "audio.mp3" in out


# --------------------------------------------------------------------------- #
# 只读 API（使用新 RuntimeLogStore）
# --------------------------------------------------------------------------- #
def test_get_logs_returns_entries(client: TestClient, store: RuntimeLogStore) -> None:
    store.append(level="INFO", category="app", message="hello")
    resp = client.get("/admin/logs")
    assert resp.status_code == 200
    data = resp.json()
    assert data["latest_id"] == 1
    assert data["entries"][0]["message"] == "hello"
    assert data["entries"][0]["level"] == "INFO"
    assert data["entries"][0]["category"] == "app"


def test_get_logs_after_id(client: TestClient, store: RuntimeLogStore) -> None:
    for i in range(5):
        store.append(level="INFO", category="app", message=f"m{i}")
    resp = client.get("/admin/logs", params={"after_id": 3})
    assert resp.status_code == 200
    ids = [e["id"] for e in resp.json()["entries"]]
    assert ids == [4, 5]


def test_get_logs_level_filter(client: TestClient, store: RuntimeLogStore) -> None:
    store.append(level="INFO", category="app", message="i")
    store.append(level="ERROR", category="app", message="e")
    resp = client.get("/admin/logs", params={"level": "ERROR"})
    assert [e["message"] for e in resp.json()["entries"]] == ["e"]


def test_get_logs_invalid_limit_returns_422(client: TestClient) -> None:
    assert client.get("/admin/logs", params={"limit": 0}).status_code == 422
    assert client.get("/admin/logs", params={"limit": 100000}).status_code == 422


def test_get_logs_invalid_after_id_returns_422(client: TestClient) -> None:
    assert client.get("/admin/logs", params={"after_id": -1}).status_code == 422


def test_logs_endpoint_is_read_only(client: TestClient) -> None:
    assert client.post("/admin/logs").status_code == 405
    assert client.delete("/admin/logs").status_code == 405


def test_get_logs_before_id(client: TestClient, store: RuntimeLogStore) -> None:
    """向前分页。"""
    for i in range(10):
        store.append(level="INFO", category="app", message=f"m{i}")
    resp = client.get("/admin/logs", params={"before_id": 6})
    assert resp.status_code == 200
    ids = [e["id"] for e in resp.json()["entries"]]
    assert all(i < 6 for i in ids)


def test_get_logs_after_and_before_422(client: TestClient, store: RuntimeLogStore) -> None:
    """after_id 和 before_id 不能同时使用。"""
    store.append(level="INFO", category="app", message="test")
    resp = client.get("/admin/logs", params={"after_id": 1, "before_id": 5})
    assert resp.status_code == 422
