"""S1 Task 4: 下载目录和文件名测试。"""

from __future__ import annotations

from pathlib import Path

import pytest

from shared.download_helpers import (
    ensure_directory_exists,
    resolve_workspace_media_dir,
    validate_filename_template,
)
from shared.settings_store import DownloadConfig


# ── Task 4.1: 目录解析 ───────────────────────────────────────────────────────


def test_custom_output_root_is_scoped_by_workspace(tmp_path: Path) -> None:
    """非空 output_dir 时使用 <root>/<workspace_id>/videos。"""
    config = DownloadConfig(output_dir=str(tmp_path))
    result = resolve_workspace_media_dir(config, "ws-1")
    assert result == tmp_path / "ws-1" / "videos"


def test_empty_output_dir_raises() -> None:
    """空 output_dir 抛异常（调用方使用默认目录）。"""
    config = DownloadConfig(output_dir="")
    with pytest.raises(ValueError, match="output_dir is empty"):
        resolve_workspace_media_dir(config, "ws-1")


# ── Task 4.2: 文件名模板验证 ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("template", "expected_valid"),
    [
        ("%(title)s.%(ext)s", True),
        ("%(title)s-%(id)s.%(ext)s", True),
        ("video_%(upload_date)s.%(ext)s", True),
        ("/absolute/path.%(ext)s", False),  # 绝对路径
        ("../relative.%(ext)s", False),  # 包含 ..
        ("", False),  # 空
        ("   ", False),  # 空白
        ("C:\\Windows\\path.%(ext)s", False),  # Windows 绝对路径
    ],
)
def test_filename_template_validation(template: str, expected_valid: bool) -> None:
    """文件名模板验证。"""
    is_valid, _ = validate_filename_template(template)
    assert is_valid == expected_valid


# ── Task 4.3: 目录创建 ───────────────────────────────────────────────────────


def test_ensure_directory_creates(tmp_path: Path) -> None:
    """目录不存在时创建。"""
    target = tmp_path / "new" / "nested" / "dir"
    success, error = ensure_directory_exists(target)
    assert success
    assert error == ""
    assert target.is_dir()


def test_ensure_directory_existing(tmp_path: Path) -> None:
    """目录已存在时成功。"""
    success, error = ensure_directory_exists(tmp_path)
    assert success
    assert error == ""
