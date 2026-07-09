"""R13.1：download task SUCCESS 时把 yt-dlp metadata 传给 analyze task。"""
from __future__ import annotations
from backend.app.routes import workspaces as ws_routes


def test_on_download_success_copies_yt_dlp_metadata_to_analyze_payload(tmp_path):
    """download task.result 里的 video_title 等应该出现在新建的 analyze task.payload。"""
    created: list = []

    class _FakeRunner:
        @staticmethod
        def create_task(project_id, task_type, payload):
            rec = type("T", (), {"task_id": "analyze-fake-xxx"})()
            created.append({"project_id": project_id, "task_type": task_type, "payload": payload})
            return rec

    fake_runner = _FakeRunner()

    fake_dl = type("DL", (), {
        "task_id": "note-xxx",
        "project_id": "ws-1",
        "result": {
            "save_path": str(tmp_path / "test.mp4"),
            "video_title": "三代封神！那四代呢？",
            "video_duration": 402,
            "video_uploader": "测试 UP 主",
            "video_thumbnail_url": "https://example.com/cover.jpg",
        },
        "payload": {"url": "https://www.bilibili.com/video/BV1xxx"},
    })()
    (tmp_path / "test.mp4").touch()

    ws_routes._on_download_success(fake_dl, fake_runner)

    assert created, "应该至少创建了一个 analyze task"
    payload = created[0]["payload"]
    assert payload["video_title"] == "三代封神！那四代呢？"
    assert payload["video_duration"] == 402
    assert payload["video_uploader"] == "测试 UP 主"
    assert payload["video_thumbnail_url"] == "https://example.com/cover.jpg"
    assert payload["source_url"] == "https://www.bilibili.com/video/BV1xxx"
