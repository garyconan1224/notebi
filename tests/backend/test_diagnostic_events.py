"""Q7：用户诊断事件层（事件代码映射 / 脱敏 / 聚合 / 日志目录隔离）。"""

from __future__ import annotations

from backend.app.services.diagnostic_events import (
    DiagnosticAggregator,
    describe_event,
    redact_event,
    redact_text,
)


def test_describe_known_event_has_summary_cause_action() -> None:
    info = describe_event("bilibili_meta_failed")
    assert "B 站" in info["summary"]
    assert info["cause"]
    assert info["action"]


def test_describe_unknown_event_falls_back() -> None:
    info = describe_event("something_new")
    assert info["summary"] == "something_new"
    assert info["action"]


def test_redact_text_removes_tokens_and_paths() -> None:
    text = (
        "access_token=abc123secret; "
        "Authorization: Bearer NTsecrettokenvalue123 "
        "文件在 /Users/conan/Desktop/secret/video.mp4"
    )
    cleaned = redact_text(text)
    assert "abc123secret" not in cleaned
    assert "NTsecrettokenvalue123" not in cleaned
    assert "/Users/conan/Desktop/secret" not in cleaned
    assert "<path>" in cleaned


def test_redact_event_cleans_message_fields() -> None:
    event = {
        "event_code": "export_failed",
        "message": "token=verysecretvalue 导出失败",
        "task_id": "t1",
    }
    cleaned = redact_event(event)
    assert "verysecretvalue" not in cleaned["message"]
    assert cleaned["task_id"] == "t1"


def test_aggregator_counts_repeats_within_window() -> None:
    agg = DiagnosticAggregator(window_seconds=30)
    first = agg.record("asr_failed", task_id="t1", now=100.0)
    second = agg.record("asr_failed", task_id="t1", now=110.0)
    assert first is second
    assert second["count"] == 2

    # 超出窗口后开新条目
    third = agg.record("asr_failed", task_id="t1", now=200.0)
    assert third["count"] == 1


def test_aggregator_separates_by_task_id() -> None:
    agg = DiagnosticAggregator(window_seconds=30)
    a = agg.record("asr_failed", task_id="t1", now=100.0)
    b = agg.record("asr_failed", task_id="t2", now=100.0)
    assert a is not b
    assert len(agg.recent()) == 2


def test_log_dir_respects_env_override(monkeypatch, tmp_path) -> None:
    import importlib
    from backend.app.services import runtime_log_store

    monkeypatch.setenv("NOTEBI_LOG_DIR", str(tmp_path / "tmp-logs"))
    assert runtime_log_store.resolve_log_dir() == tmp_path / "tmp-logs"

    monkeypatch.delenv("NOTEBI_LOG_DIR", raising=False)
    default = runtime_log_store.resolve_log_dir()
    assert default.name == "logs"
    assert default.parent.name == "data"
