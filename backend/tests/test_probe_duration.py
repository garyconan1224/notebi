"""probe-duration 端点：复用 fetch_ytdlp_metadata 取时长，失败回退 0。"""

from fastapi.testclient import TestClient

from backend.app.main import app


def test_probe_duration_returns_seconds(monkeypatch):
    import shared.video_download_ytdlp as vd
    monkeypatch.setattr(vd, "fetch_ytdlp_metadata", lambda url, **kw: {"duration": 308})
    client = TestClient(app)
    r = client.post("/workspaces/probe-duration", json={"url": "https://example.com/v"})
    assert r.status_code == 200
    assert r.json()["duration_sec"] == 308


def test_probe_duration_failure_returns_zero(monkeypatch):
    import shared.video_download_ytdlp as vd

    def _boom(url, **kw):
        raise RuntimeError("yt-dlp down")

    monkeypatch.setattr(vd, "fetch_ytdlp_metadata", _boom)
    client = TestClient(app)
    r = client.post("/workspaces/probe-duration", json={"url": "https://example.com/v"})
    assert r.status_code == 200
    assert r.json()["duration_sec"] == 0
