"""R13.6.1：_apply_ytdlp_metadata_to_task 共享工具测试。"""
from __future__ import annotations
from backend.app.services.pipeline_tasks import _apply_ytdlp_metadata_to_task
from backend.app.models.tasks import TaskRecord


def test_apply_metadata_writes_to_task_result_and_returns_meta():
    """构造 fake record + runner，调用工具，断言 record.result 含 video_title 等字段。"""
    record = TaskRecord(
        task_id="audio-test-001",
        project_id="ws-test",
        task_type="audio",
        payload={"url": "https://www.bilibili.com/video/BV1xxx", "source": "https://www.bilibili.com/video/BV1xxx"},
        result={},
    )

    updated_results: list = []

    class _FakeStore:
        @staticmethod
        def update(task_id, **kwargs):
            updated_results.append(kwargs)

    class _FakeRunner:
        store = _FakeStore()

    fake_runner = _FakeRunner()

    dl_result = {
        "ok": True,
        "title": "三代封神！那四代呢？",
        "duration": 402,
        "uploader": "测试UP主",
        "thumbnail_url": "https://example.com/thumb.jpg",
        "save_path": "/tmp/audio.mp3",
    }

    meta = _apply_ytdlp_metadata_to_task(record, fake_runner, dl_result)

    assert meta["video_title"] == "三代封神！那四代呢？"
    assert meta["video_duration"] == 402
    assert meta["video_uploader"] == "测试UP主"
    assert meta["video_thumbnail_url"] == "https://example.com/thumb.jpg"
    # save_path 不属于 metadata 映射，不出现在 meta 中
    assert "video_save_path" not in meta

    # 验证 runner.store.update 被调用，且 result 含 metadata
    assert updated_results, "应至少调用一次 store.update"
    last_update = updated_results[-1]
    assert "result" in last_update
    assert last_update["result"].get("video_title") == "三代封神！那四代呢？"


def test_apply_metadata_no_title_returns_empty_meta():
    """yt-dlp 没有返回 title 时，meta 应为空，且不触发 store.update。"""
    record = TaskRecord(
        task_id="audio-test-002",
        project_id="ws-test",
        task_type="audio",
        payload={"url": "https://example.com/audio.mp3"},
        result={},
    )

    updated_results: list = []

    class _FakeStore:
        @staticmethod
        def update(task_id, **kwargs):
            updated_results.append(kwargs)

    class _FakeRunner:
        store = _FakeStore()

    fake_runner = _FakeRunner()

    dl_result = {"ok": True, "save_path": "/tmp/audio.mp3"}

    meta = _apply_ytdlp_metadata_to_task(record, fake_runner, dl_result)

    assert meta == {}
    assert not updated_results, "无 metadata 时不应调用 store.update"
