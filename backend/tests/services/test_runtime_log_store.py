"""S6 — 诊断日志核心测试。

覆盖：
- runtime_log_store 结构化可选字段写入 / 持久化 / 查询（JSONL 往返）
- 旧日志兼容：缺少新字段仍可读取，字段为 None
- 所有导出/查询路径继续脱敏（message 与结构化文本字段）
- contextvars 日志上下文：任务/批次/合集/相关 ID 自动进入日志
- logging handler 接入：上下文随普通 logger 调用写入存储
- 上下文退出后复位，不在线程复用时泄漏
"""

from __future__ import annotations

import json
import logging

from backend.app.services.log_context import log_context
from backend.app.services.runtime_log_buffer import RuntimeLogHandler
from backend.app.services.runtime_log_store import RuntimeLogStore


def _store(tmp_path) -> RuntimeLogStore:
    return RuntimeLogStore(tmp_path / "logs")


# ── 结构化字段 ────────────────────────────────────────────────


def test_append_structured_fields_roundtrip(tmp_path):
    """结构化字段写入后能从磁盘重新读出（JSONL 往返）。"""
    store = _store(tmp_path)
    store.append(
        "ERROR",
        "provider",
        "provider timeout",
        task_id="t1",
        event_code="E_PROVIDER_TIMEOUT",
        operation="summarize",
        component="summary_generator",
        outcome="failure",
        summary="总结生成超时",
        probable_cause="上游模型响应过慢",
        suggested_action="稍后重试或更换模型",
        error_code="TIMEOUT",
        retry_count=2,
        retry_max=3,
        engine="vllm",
        provider="siliconflow",
        model="qwen-max",
        device="cpu",
        correlation_id="corr-1",
        technical_detail="ReadTimeout after 60s",
    )

    reopened = RuntimeLogStore(tmp_path / "logs")
    entries = reopened.query().entries
    assert len(entries) == 1
    event = entries[0]
    assert event.event_code == "E_PROVIDER_TIMEOUT"
    assert event.operation == "summarize"
    assert event.component == "summary_generator"
    assert event.outcome == "failure"
    assert event.summary == "总结生成超时"
    assert event.probable_cause == "上游模型响应过慢"
    assert event.suggested_action == "稍后重试或更换模型"
    assert event.error_code == "TIMEOUT"
    assert event.retry_count == 2
    assert event.retry_max == 3
    assert event.engine == "vllm"
    assert event.provider == "siliconflow"
    assert event.model == "qwen-max"
    assert event.device == "cpu"
    assert event.correlation_id == "corr-1"
    assert event.technical_detail == "ReadTimeout after 60s"


def test_legacy_append_signature_and_missing_fields(tmp_path):
    """旧调用签名不传新字段：事件正常生成，新字段为 None。"""
    store = _store(tmp_path)
    event = store.append("INFO", "app", "started", stage="application_started")
    assert event.summary is None
    assert event.probable_cause is None
    assert event.suggested_action is None
    assert event.technical_detail is None
    assert event.correlation_id is None
    assert event.retry_max is None


def test_legacy_jsonl_lines_still_load(tmp_path):
    """磁盘上的旧 JSONL（没有新字段）能被读取且不崩溃。"""
    log_dir = tmp_path / "logs"
    log_dir.mkdir(parents=True)
    legacy = {
        "id": 1,
        "timestamp": "2026-01-01T00:00:00+00:00",
        "level": "INFO",
        "category": "app",
        "message": "old line",
    }
    (log_dir / "log-2026-01-01.jsonl").write_text(
        json.dumps(legacy) + "\n", encoding="utf-8"
    )

    store = RuntimeLogStore(log_dir)
    entries = store.query().entries
    assert len(entries) == 1
    assert entries[0].message == "old line"
    assert entries[0].summary is None
    # 新写入 ID 不与旧 ID 冲突
    new_event = store.append("INFO", "app", "new line")
    assert new_event.id == 2


# ── 脱敏 ──────────────────────────────────────────────────────


def test_structured_text_fields_are_sanitized(tmp_path):
    """结构化文本字段与 message 一样做密钥脱敏，导出 dump 同样脱敏。"""
    store = _store(tmp_path)
    store.append(
        "ERROR",
        "provider",
        "request failed with api_key=SECRET123",
        summary="调用失败 api_key=SECRET123",
        probable_cause="token=SECRET123 过期",
        suggested_action="Authorization: Bearer SECRET123 请更换",
        technical_detail="curl https://x.com?api_key=SECRET123",
    )
    event = store.query().entries[0]
    for value in (
        event.message,
        event.summary,
        event.probable_cause,
        event.suggested_action,
        event.technical_detail,
    ):
        assert "SECRET123" not in value

    # /admin/logs/export 走 model_dump(mode="json")，同样不能泄露
    dumped = json.dumps(event.model_dump(mode="json"))
    assert "SECRET123" not in dumped


# ── contextvars 日志上下文 ────────────────────────────────────


def test_log_context_fills_missing_identifiers(tmp_path):
    """上下文中的任务/批次/合集/相关 ID 自动进入日志，显式参数优先。"""
    store = _store(tmp_path)
    with log_context(
        task_id="t1",
        batch_id="b1",
        workspace_id="w1",
        correlation_id="corr-9",
    ):
        auto = store.append("INFO", "pipeline", "transcribing")
        explicit_wins = store.append("INFO", "pipeline", "other", task_id="t2")

    assert auto.task_id == "t1"
    assert auto.batch_id == "b1"
    assert auto.workspace_id == "w1"
    assert auto.correlation_id == "corr-9"
    assert explicit_wins.task_id == "t2"
    # 其余字段仍从上下文补齐
    assert explicit_wins.batch_id == "b1"


def test_log_context_can_be_filtered_and_resets(tmp_path):
    """上下文写入的 ID 可被 query 过滤；退出后不再泄漏。"""
    store = _store(tmp_path)
    with log_context(task_id="t1", correlation_id="corr-1"):
        store.append("INFO", "pipeline", "inside")
    outside = store.append("INFO", "pipeline", "outside")

    assert outside.task_id is None
    assert outside.correlation_id is None

    filtered = store.query(task_id="t1").entries
    assert [e.message for e in filtered] == ["inside"]


def test_log_context_nested_and_reset(tmp_path):
    """嵌套上下文：内层覆盖、外层保留；退出内层后恢复外层。"""
    store = _store(tmp_path)
    with log_context(batch_id="b1"):
        with log_context(task_id="t-inner"):
            inner = store.append("INFO", "x", "inner")
        outer_after = store.append("INFO", "x", "outer-after")

    assert inner.batch_id == "b1"
    assert inner.task_id == "t-inner"
    assert outer_after.batch_id == "b1"
    assert outer_after.task_id is None


# ── logging handler 接入 ──────────────────────────────────────


def test_runtime_log_handler_carries_context_into_store(tmp_path):
    """普通 logger 调用在上下文内自动带上 ID，且消息仍脱敏。"""
    store = _store(tmp_path)
    logger = logging.getLogger("s6.handler.test")
    logger.setLevel(logging.INFO)
    handler = RuntimeLogHandler(store)
    logger.addHandler(handler)
    try:
        with log_context(task_id="t-log", correlation_id="corr-log"):
            logger.info("boom api_key=SECRET123")
    finally:
        logger.removeHandler(handler)

    entries = store.query().entries
    assert len(entries) == 1
    event = entries[0]
    assert event.task_id == "t-log"
    assert event.correlation_id == "corr-log"
    assert "SECRET123" not in event.message


def test_runtime_log_handler_without_context_keeps_legacy_shape(tmp_path):
    """无上下文时 handler 写入与旧行为一致，不额外带 ID。"""
    store = _store(tmp_path)
    logger = logging.getLogger("s6.handler.plain")
    logger.setLevel(logging.INFO)
    handler = RuntimeLogHandler(store)
    logger.addHandler(handler)
    try:
        logger.info("plain message")
    finally:
        logger.removeHandler(handler)

    event = store.query().entries[0]
    assert event.task_id is None
    assert event.batch_id is None
    assert event.correlation_id is None
    assert event.message == "plain message"
