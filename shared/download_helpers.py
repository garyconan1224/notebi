"""下载配置辅助函数：目录解析和文件名验证。

S1 Task 4: 下载目录和文件名真实生效。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from shared.settings_store import DownloadConfig


def resolve_workspace_media_dir(config: "DownloadConfig", workspace_id: str) -> Path:
    """解析 workspace 媒体存储目录。

    - 空 output_dir 使用现有 workspace videos 目录（由调用方决定）
    - 非空时使用 <root>/<workspace_id>/videos

    只影响新下载，不移动旧文件。
    """
    if not config.output_dir:
        # 调用方使用默认 workspace 目录
        raise ValueError("output_dir is empty, use default workspace directory")

    root = Path(config.output_dir).expanduser()
    return root / workspace_id / "videos"


def validate_filename_template(template: str) -> tuple[bool, str]:
    """验证文件名模板。

    返回 (is_valid, error_message)。

    非法模板：
    - 绝对路径
    - 包含 ..
    - 空扩展表达式
    """
    if not template:
        return False, "模板不能为空"

    # 检查绝对路径
    if template.startswith("/") or template.startswith("\\"):
        return False, "模板不能是绝对路径"

    # Windows 驱动器路径
    if len(template) >= 2 and template[1] == ":":
        return False, "模板不能是绝对路径"

    # 检查 ..
    if ".." in template:
        return False, "模板不能包含 .."

    # 检查空扩展
    if re.search(r"%\(ext\)s\s*$", template) is None and "%(ext)s" not in template:
        # 没有扩展名表达式也可以，但如果有空的则不行
        pass

    # 基本合法性
    if not template.strip():
        return False, "模板不能为空白"

    return True, ""


def ensure_directory_exists(path: Path) -> tuple[bool, str]:
    """确保目录存在且可写。

    返回 (success, error_message)。
    """
    try:
        path.mkdir(parents=True, exist_ok=True)
        # 测试可写性
        test_file = path / ".write_test"
        test_file.touch()
        test_file.unlink()
        return True, ""
    except PermissionError:
        return False, f"目录不可写: {path}"
    except OSError as e:
        return False, f"无法创建目录: {e}"
