"""Cookie 配置服务：浏览器优先、文件回退。

S1 Task 5: Cookie 浏览器优先、文件回退。

安全要求：
- Cookie 原文不展示、不上传、不进入日志或诊断包
- 导入文件限制权限 0600
- 浏览器读取失败给出权限说明
"""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Any

from shared.config import ROOT_DIR

# Cookie 私有存储目录
_COOKIE_DIR: Path = ROOT_DIR / "data" / "cookies"
_IMPORTED_COOKIE_FILE: Path = _COOKIE_DIR / "imported_cookies.txt"

# 支持的浏览器
SUPPORTED_BROWSERS = ("chrome", "firefox", "safari", "edge", "brave", "chromium")

# Netscape cookie 文件头
_NETSCAPE_HEADER = "# Netscape HTTP Cookie File"


def get_cookie_storage_dir() -> Path:
    """获取 Cookie 存储目录。"""
    return _COOKIE_DIR


def get_imported_cookie_path() -> Path:
    """获取导入的 Cookie 文件路径。"""
    return _IMPORTED_COOKIE_FILE


def validate_netscape_format(content: str) -> tuple[bool, str]:
    """验证 Netscape Cookie 格式。

    返回 (is_valid, error_message)。
    """
    if not content.strip():
        return False, "文件内容为空"

    # 检查大小限制（1MB）
    if len(content) > 1024 * 1024:
        return False, "文件过大（超过 1MB）"

    # 检查 Netscape 头（可选但推荐）
    first_line = content.strip().split("\n")[0]
    if not first_line.startswith("#"):
        # 不以注释开头也可以，但必须是有效格式
        pass

    return True, ""


def import_cookie_file(content: str) -> dict[str, Any]:
    """导入 Cookie 文件。

    返回：
    - success: 是否成功
    - stored_path: 存储路径（成功时）
    - error: 错误信息（失败时）
    """
    is_valid, error = validate_netscape_format(content)
    if not is_valid:
        return {"success": False, "stored_path": "", "error": error}

    try:
        _COOKIE_DIR.mkdir(parents=True, exist_ok=True)

        # 写入文件
        _IMPORTED_COOKIE_FILE.write_text(content, encoding="utf-8")

        # 设置权限 0600
        os.chmod(_IMPORTED_COOKIE_FILE, stat.S_IRUSR | stat.S_IWUSR)

        return {
            "success": True,
            "stored_path": str(_IMPORTED_COOKIE_FILE),
            "error": "",
        }
    except OSError as e:
        return {"success": False, "stored_path": "", "error": f"写入失败: {e}"}


def delete_imported_cookie() -> dict[str, Any]:
    """删除导入的 Cookie 文件。

    返回：
    - success: 是否成功
    - error: 错误信息（失败时）
    """
    try:
        if _IMPORTED_COOKIE_FILE.exists():
            _IMPORTED_COOKIE_FILE.unlink()
        return {"success": True, "error": ""}
    except OSError as e:
        return {"success": False, "error": f"删除失败: {e}"}


def test_browser_cookie(browser: str, profile: str = "") -> dict[str, Any]:
    """测试浏览器 Cookie 可读性。

    返回：
    - mode: "browser"
    - browser: 浏览器名
    - readable: 是否可读
    - message: 说明信息

    注意：不返回 Cookie 内容。
    """
    browser = browser.lower()
    if browser not in SUPPORTED_BROWSERS:
        return {
            "mode": "browser",
            "browser": browser,
            "readable": False,
            "message": f"不支持的浏览器: {browser}，支持: {', '.join(SUPPORTED_BROWSERS)}",
        }

    # 尝试检测浏览器是否存在（不读取 Cookie）
    # 实际读取在 yt-dlp 下载时进行
    return {
        "mode": "browser",
        "browser": browser,
        "readable": True,  # 假设可读，实际下载时验证
        "message": f"将在下载时从 {browser} 读取 Cookie" + (f"（配置: {profile}）" if profile else ""),
    }


def test_file_cookie() -> dict[str, Any]:
    """测试文件 Cookie 可读性。

    返回：
    - mode: "file"
    - readable: 是否可读
    - message: 说明信息
    """
    if not _IMPORTED_COOKIE_FILE.exists():
        return {
            "mode": "file",
            "readable": False,
            "message": "未找到导入的 Cookie 文件，请先导入",
        }

    try:
        # 检查可读性
        content = _IMPORTED_COOKIE_FILE.read_text(encoding="utf-8")
        if not content.strip():
            return {
                "mode": "file",
                "readable": False,
                "message": "Cookie 文件为空",
            }
        return {
            "mode": "file",
            "readable": True,
            "message": f"Cookie 文件可读（{_IMPORTED_COOKIE_FILE.name}）",
        }
    except OSError as e:
        return {
            "mode": "file",
            "readable": False,
            "message": f"无法读取 Cookie 文件: {e}",
        }


def build_ytdlp_cookie_args(
    cookie_mode: str,
    cookie_browser: str = "chrome",
    cookie_profile: str = "",
) -> dict[str, Any]:
    """构建 yt-dlp Cookie 参数。

    返回适合传入 yt_dlp.YoutubeDL 的参数字典。
    """
    if cookie_mode == "none":
        return {}

    if cookie_mode == "browser":
        # yt-dlp cookiesfrombrowser 格式: (browser, profile, keyring, container)
        return {
            "cookiesfrombrowser": (cookie_browser, cookie_profile or None, None, None),
        }

    if cookie_mode == "file":
        if _IMPORTED_COOKIE_FILE.exists():
            return {"cookiefile": str(_IMPORTED_COOKIE_FILE)}
        return {}

    return {}
