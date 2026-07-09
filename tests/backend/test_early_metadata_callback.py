"""R15: info_callback 在 yt-dlp 第一次 info_dict 时即时回调元数据。

不实际起 yt-dlp，只验证 info_callback wiring：
直接构造 fake hook payload 并断言 _apply_ytdlp_metadata_to_task 把元数据写进 record.result。
"""
from __future__ import annotations

from typing import Any, Dict

from backend.app.services.pipeline_tasks import _apply_ytdlp_metadata_to_task


class _FakeRecord:
    def __init__(self) -> None:
        self.task_id = "download-fake-1"
        self.result: Dict[str, Any] = {}
        self.payload: Dict[str, Any] = {"url": "https://www.bilibili.com/video/BV1xxx"}


class _FakeStore:
    def __init__(self) -> None:
        self.updates: list[Dict[str, Any]] = []

    def update(self, task_id: str, **kwargs: Any) -> None:
        self.updates.append({"task_id": task_id, **kwargs})


class _FakeRunner:
    def __init__(self) -> None:
        self.store = _FakeStore()


def test_info_callback_payload_writes_metadata_into_task_result() -> None:
    """模拟 yt-dlp 在下载中调用 info_callback 一次：record.result 应立即含 video_title。"""
    record = _FakeRecord()
    runner = _FakeRunner()

    # 模拟 R15 在 video_download_ytdlp._hook 内构造的 meta dict
    fake_meta = {
        "title": "三代封神！那四代呢？",
        "duration": 402,
        "uploader": "测试 UP 主",
        "thumbnail_url": "https://example.com/cover.jpg",
    }
    returned = _apply_ytdlp_metadata_to_task(record, runner, fake_meta)

    # 返回值含规整后的 key
    assert returned == {
        "video_title": "三代封神！那四代呢？",
        "video_duration": 402,
        "video_uploader": "测试 UP 主",
        "video_thumbnail_url": "https://example.com/cover.jpg",
    }
    # store.update 被调用，result 含元数据
    assert len(runner.store.updates) == 1
    update_kwargs = runner.store.updates[0]
    assert update_kwargs["task_id"] == "download-fake-1"
    assert update_kwargs["result"]["video_title"] == "三代封神！那四代呢？"


def test_info_callback_empty_meta_is_noop() -> None:
    """没有 title 时 _apply_ytdlp_metadata_to_task 不调 store.update（避免空 update 噪音）。"""
    record = _FakeRecord()
    runner = _FakeRunner()
    returned = _apply_ytdlp_metadata_to_task(record, runner, {"title": "", "duration": 0})
    assert returned == {}
    assert runner.store.updates == []
