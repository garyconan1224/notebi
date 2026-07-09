"""
在导入其他 shared 模块前加载项目根目录的 .env（若存在 python-dotenv）。
不提交 .env；仅本地/Cursor 测试时使用。
"""

from __future__ import annotations

from pathlib import Path


def load_dotenv_if_present() -> None:
    try:
        from dotenv import load_dotenv as _load
    except ImportError:
        return
    root = Path(__file__).resolve().parent.parent
    env_path = root / ".env"
    if env_path.is_file():
        _load(env_path)
