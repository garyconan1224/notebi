"""R13.6.2：handle_audio_task 中 yt-dlp metadata 回写测试。"""
from __future__ import annotations
from backend.app.services.pipeline_tasks import _apply_ytdlp_metadata_to_task
from backend.app.models.tasks import TaskRecord


def test_audio_ytdlp_result_writes_video_title_to_record():
    """yt-dlp bestaudio 返回 title → _apply_ytdlp_metadata_to_task 写回 record.result。"""
    record = TaskRecord(
        task_id="audio-bilibili-001",
        project_id="ws-audio-1",
        task_type="audio",
        payload={
            "source": "https://www.bilibili.com/video/BV1xxx",
            "source_type": "url",
        },
        result={},
    )

    updated: list = []

    class _FakeStore:
        @staticmethod
        def update(task_id, **kwargs):
            updated.append((task_id, kwargs))

    class _FakeRunner:
        store = _FakeStore()

    fake_runner = _FakeRunner()

    # yt-dlp bestaudio 返回的结果（audio 路径不会抽 thumbnail）
    dl_result = {
        "ok": True,
        "title": "三代封神！那四代呢？",
        "duration": 402,
        "uploader": "测试UP主",
        "save_path": "/tmp/workspace/audio/audio-test-001_三代封神！那四代呢？.mp3",
    }

    meta = _apply_ytdlp_metadata_to_task(record, fake_runner, dl_result)

    assert meta["video_title"] == "三代封神！那四代呢？"
    assert meta["video_duration"] == 402
    assert meta["video_uploader"] == "测试UP主"
    # thumbnail_url 不存在，不出现在 meta 中
    assert "video_thumbnail_url" not in meta

    # store.update 被调用
    assert updated
    _, kw = updated[-1]
    assert kw["result"]["video_title"] == "三代封神！那四代呢？"
