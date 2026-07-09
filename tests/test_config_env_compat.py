"""
VIDMIRROR_* 环境变量单元测试

验证 VIDMIRROR_* 变量的优先级和基本功能。
覆盖 get_backend_base_url() 与 _select_python_for_backend() 中的变量解析逻辑。
"""

from __future__ import annotations

import warnings

import pytest

from shared.config import get_backend_base_url


# ── 环境变量清单 ──────────────────────────────────────────────
_BACKEND_URL_ENV_KEYS = ("VIDMIRROR_BACKEND_URL", "BACKEND_URL")


@pytest.fixture(autouse=True)
def _clear_backend_url_envs(monkeypatch):
    # 每个用例都从干净环境开始，避免 CI 或本地 .env 的干扰
    for key in _BACKEND_URL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    yield


# ── get_backend_base_url：四种组合 ─────────────────────────────

def test_vidmirror_backend_url_preferred(monkeypatch):
    """只设 VIDMIRROR_BACKEND_URL → 返回新值，不触发 deprecation 警告"""
    monkeypatch.setenv("VIDMIRROR_BACKEND_URL", "http://new-host:9000/")
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        result = get_backend_base_url()
    assert result == "http://new-host:9000"
    assert not any(issubclass(w.category, DeprecationWarning) for w in captured)



def test_default_when_no_env_set(monkeypatch):
    """两个都不设（且无 BACKEND_URL）→ 返回默认值"""
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        result = get_backend_base_url()
    assert result == "http://127.0.0.1:8000"
    assert not any(issubclass(w.category, DeprecationWarning) for w in captured)


# ── 补充：BACKEND_URL 通用变量在 VIDMIRROR/VPS 都缺失时仍可用 ─────

def test_generic_backend_url_used_when_vidmirror_and_vps_absent(monkeypatch):
    monkeypatch.setenv("BACKEND_URL", "http://generic:7000/")
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        result = get_backend_base_url()
    assert result == "http://generic:7000"
    assert not any(issubclass(w.category, DeprecationWarning) for w in captured)


# ── _select_python_for_backend：VIDMIRROR_BACKEND_PYTHON 迁移 ──

@pytest.fixture(autouse=True)
def _clear_backend_python_envs(monkeypatch):
    for key in ("VIDMIRROR_BACKEND_PYTHON", "VPS_BACKEND_PYTHON"):
        monkeypatch.delenv(key, raising=False)
    yield



def test_vidmirror_backend_python_no_deprecation(monkeypatch):
    """只设 VIDMIRROR_BACKEND_PYTHON 应该不触发 deprecation 警告"""
    from shared.backend_launcher import _select_python_for_backend

    monkeypatch.setenv("VIDMIRROR_BACKEND_PYTHON", "/nonexistent/python-for-test")
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        try:
            _select_python_for_backend()
        except Exception:
            pass
    dep = [w for w in captured if issubclass(w.category, DeprecationWarning)]
    assert not any("VPS_BACKEND_PYTHON" in str(w.message) for w in dep)
