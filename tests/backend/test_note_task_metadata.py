"""R13.6.3：handle_note_task download 步骤 yt-dlp metadata 回写测试。"""
from __future__ import annotations
from backend.app.services.pipeline_tasks import _apply_ytdlp_metadata_to_task
from backend.app.models.tasks import TaskRecord


def test_note_download_writes_video_metadata_to_record():
    """note task download 步骤 yt-dlp 返回 metadata → 回写到 record.result。"""
    record = TaskRecord(
        task_id="note-dl-001",
        project_id="ws-note-1",
        task_type="note",
        payload={
            "url": "https://www.bilibili.com/video/BV1xxx",
            "steps": ["download", "transcribe", "analyze", "note"],
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

    dl_result = {
        "ok": True,
        "title": "三代封神！那四代呢？",
        "duration": 402,
        "uploader": "测试UP主",
        "thumbnail_url": "https://example.com/thumb.jpg",
        "save_path": "/tmp/videos/三代封神！那四代呢？-BV1xxx.mp4",
    }

    meta = _apply_ytdlp_metadata_to_task(record, fake_runner, dl_result)

    assert meta["video_title"] == "三代封神！那四代呢？"
    assert meta["video_uploader"] == "测试UP主"
    assert meta["video_thumbnail_url"] == "https://example.com/thumb.jpg"

    # store.update 写入了 record.result
    assert updated
    _, kw = updated[-1]
    assert kw["result"]["video_title"] == "三代封神！那四代呢？"
    assert kw["result"]["video_thumbnail_url"] == "https://example.com/thumb.jpg"
