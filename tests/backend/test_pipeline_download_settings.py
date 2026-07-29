from pathlib import Path
from backend.app.models.tasks import TaskRecord
from backend.app.services import pipeline_tasks
from shared.settings_store import AppSettings, DownloadConfig, NetworkConfig


class _Runner:
    def set_progress(self, *_args, **_kwargs):
        return None

    def append_log(self, *_args, **_kwargs):
        return None

    def set_download_speed(self, *_args, **_kwargs):
        return None


def test_download_task_uses_network_proxy_and_ignores_legacy_download_override(
    tmp_path: Path,
    monkeypatch,
) -> None:
    captured = {}
    settings = AppSettings(
        network=NetworkConfig(
            routing_mode="smart",
            global_proxy="http://127.0.0.1:7890",
        ),
        download=DownloadConfig(
            output_dir=str(tmp_path / "downloads"),
            filename_template="%(title)s-%(id)s.%(ext)s",
            # 旧字段仍可读，但下载任务必须只服从 network 设置。
            proxy_mode="direct",
            cookie_mode="browser",
            cookie_browser="firefox",
            cookie_profile="profile-a",
            concurrency_limit=4,
            retry_count=3,
            socket_timeout=45,
        ),
    )
    monkeypatch.setattr(pipeline_tasks, "load_settings", lambda: settings)
    monkeypatch.setattr(
        pipeline_tasks,
        "run_ytdlp_download",
        lambda **kwargs: captured.update(kwargs)
        or {
            "ok": True,
            "save_path": str(tmp_path / "video.mp4"),
            "file_name": "video.mp4",
        },
    )

    record = TaskRecord(
        task_id="task-1",
        project_id="workspace-1",
        task_type="download",
        payload={
            "url": "https://www.youtube.com/watch?v=test",
            "po_token": "must-not-pass",
            "visitor_data": "must-not-pass",
            "cookie_base_dirs": ["/must/not/pass"],
        },
    )
    pipeline_tasks.handle_download_task(record, _Runner())

    assert captured["output_dir"] == str(
        tmp_path / "downloads" / "workspace-1" / "videos"
    )
    assert captured["proxy"] == "http://127.0.0.1:7890"
    assert captured["cookie_options"] == {
        "cookiesfrombrowser": ("firefox", "profile-a", None, None)
    }
    assert captured["filename_template"] == "%(title)s-%(id)s.%(ext)s"
    assert captured["retry_count"] == 3
    assert captured["socket_timeout"] == 45
    assert captured["concurrent_fragment_downloads"] == 4
    assert "po_token" not in captured
    assert "visitor_data" not in captured
    assert "cookie_base_dirs_list" not in captured
