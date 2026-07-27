"""S2 Task 1: 持久日志存储测试。"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.services.runtime_log_store import LogEvent, RuntimeLogStore


@pytest.fixture()
def store(tmp_path: Path) -> RuntimeLogStore:
    return RuntimeLogStore(tmp_path, max_bytes=1024 * 1024)


# ── Task 1.1: 重启持久性 ─────────────────────────────────────────────────────


def test_events_survive_store_recreation(tmp_path: Path) -> None:
    """重启后仍能读取之前写入的事件。"""
    first = RuntimeLogStore(tmp_path, max_bytes=50 * 1024 * 1024)
    event = first.append(level="INFO", category="app", message="started")

    second = RuntimeLogStore(tmp_path, max_bytes=50 * 1024 * 1024)
    result = second.query(limit=10)
    assert len(result.entries) == 1
    assert result.entries[0].id == event.id
    assert result.entries[0].message == "started"


# ── Task 1.2: 严格递增 ID ────────────────────────────────────────────────────


def test_strictly_increasing_ids(store: RuntimeLogStore) -> None:
    """ID 严格递增。"""
    e1 = store.append(level="INFO", category="test", message="first")
    e2 = store.append(level="INFO", category="test", message="second")
    e3 = store.append(level="INFO", category="test", message="third")

    assert e1.id < e2.id < e3.id


# ── Task 1.3: 并发 append ────────────────────────────────────────────────────


def test_concurrent_append(store: RuntimeLogStore) -> None:
    """并发写入不丢失。"""
    import threading

    results: list[LogEvent] = []
    lock = threading.Lock()

    def worker(n: int) -> None:
        for i in range(10):
            event = store.append(level="INFO", category="test", message=f"worker-{n}-{i}")
            with lock:
                results.append(event)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == 50
    # 所有 ID 唯一
    ids = [e.id for e in results]
    assert len(set(ids)) == 50


# ── Task 1.4: after_id 增量查询 ──────────────────────────────────────────────


def test_after_id_incremental(store: RuntimeLogStore) -> None:
    """after_id 只返回新记录。"""
    for i in range(10):
        store.append(level="INFO", category="test", message=f"msg-{i}")

    result = store.query(after_id=5, limit=100)
    assert len(result.entries) == 5
    assert all(e.id > 5 for e in result.entries)


# ── Task 1.5: before_id 向前分页 ─────────────────────────────────────────────


def test_before_id_pagination(store: RuntimeLogStore) -> None:
    """before_id 返回更早记录。"""
    for i in range(10):
        store.append(level="INFO", category="test", message=f"msg-{i}")

    result = store.query(before_id=6, limit=100)
    assert len(result.entries) == 5
    assert all(e.id < 6 for e in result.entries)


# ── Task 1.6: after_id 和 before_id 互斥 ─────────────────────────────────────


def test_after_and_before_mutually_exclusive(store: RuntimeLogStore) -> None:
    """after_id 和 before_id 不能同时使用。"""
    store.append(level="INFO", category="test", message="test")

    with pytest.raises(ValueError, match="mutually exclusive"):
        store.query(after_id=1, before_id=5)


# ── Task 1.7: 过滤器 ─────────────────────────────────────────────────────────


def test_level_filter(store: RuntimeLogStore) -> None:
    """按级别过滤。"""
    store.append(level="INFO", category="test", message="info")
    store.append(level="ERROR", category="test", message="error")
    store.append(level="INFO", category="test", message="info2")

    result = store.query(level="ERROR", limit=100)
    assert len(result.entries) == 1
    assert result.entries[0].level == "ERROR"


def test_category_filter(store: RuntimeLogStore) -> None:
    """按类别过滤。"""
    store.append(level="INFO", category="app", message="app")
    store.append(level="INFO", category="task", message="task")

    result = store.query(category="task", limit=100)
    assert len(result.entries) == 1
    assert result.entries[0].category == "task"


def test_task_id_filter(store: RuntimeLogStore) -> None:
    """按 task_id 过滤。"""
    store.append(level="INFO", category="test", message="a", task_id="t1")
    store.append(level="INFO", category="test", message="b", task_id="t2")

    result = store.query(task_id="t1", limit=100)
    assert len(result.entries) == 1
    assert result.entries[0].task_id == "t1"


# ── Task 1.8: 默认返回最新 ───────────────────────────────────────────────────


def test_default_returns_latest(store: RuntimeLogStore) -> None:
    """无游标返回最新 limit 条。"""
    for i in range(10):
        store.append(level="INFO", category="test", message=f"msg-{i}")

    result = store.query(limit=5)
    assert len(result.entries) == 5
    # 按 ID 升序
    assert result.entries == sorted(result.entries, key=lambda e: e.id)
    # 是最新的 5 条
    assert result.entries[0].id == 6
    assert result.entries[-1].id == 10
    assert result.has_more_older is True


# ── Task 1.9: 脱敏 ───────────────────────────────────────────────────────────


def test_sensitive_values_redacted(store: RuntimeLogStore) -> None:
    """敏感值被脱敏。"""
    event = store.append(
        level="INFO",
        category="test",
        message="Authorization: Bearer secret123",
    )
    assert "secret123" not in event.message
    assert "***" in event.message
