from fastapi.testclient import TestClient

from backend.app.main import app


def test_system_stats_returns_cpu_and_ram():
    client = TestClient(app)
    r = client.get("/system/stats")
    assert r.status_code == 200
    data = r.json()
    assert "cpu" in data and "percent" in data["cpu"]
    assert "ram" in data and "total_gb" in data["ram"]
    assert "gpu" in data


def test_system_stats_gpu_field_is_dict_or_none():
    client = TestClient(app)
    data = client.get("/system/stats").json()
    assert data["gpu"] is None or isinstance(data["gpu"], dict)
