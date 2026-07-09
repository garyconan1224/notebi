"""shared/video_analyzer.py 最小 smoke 测试。

仅验证模块可被 import 且核心状态类可被实例化，不触发任何真实的视频/网络调用。
注：当前实现未提供名为 ``VideoAnalyzer`` 的类，核心状态载体是 ``AnalysisState``
（线程安全的批量进度容器），这里用它覆盖"核心类可实例化"的 smoke 目标。
"""

from __future__ import annotations


def test_video_analyzer_module_imports() -> None:
    """shared/video_analyzer.py 能被 import，且暴露关键符号。"""
    from shared import video_analyzer

    # 核心 pipeline 入口 + 关键辅助函数都应存在
    for name in (
        "AnalysisState",
        "VideoProgress",
        "process_video",
        "run_batch_analysis",
        "format_timestamp",
    ):
        assert hasattr(video_analyzer, name), f"missing symbol: {name}"


def test_analysis_state_instantiates_without_external_calls() -> None:
    """核心状态类 ``AnalysisState`` 能在无外部依赖下实例化并提供空快照。"""
    from shared.video_analyzer import AnalysisState, VideoProgress

    state = AnalysisState()
    # 默认空状态不触发任何 IO / 网络
    assert state.snapshot() == []
    assert state.live_frames_snapshot() == []
    assert state.finished is False

    # 追加一条进度记录后 snapshot 能正常序列化
    state.videos.append(VideoProgress(video_name="smoke.mp4"))
    snap = state.snapshot()
    assert len(snap) == 1
    assert snap[0]["video_name"] == "smoke.mp4"
    assert snap[0]["status"] == "pending"

