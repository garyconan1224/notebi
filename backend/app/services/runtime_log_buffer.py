"""R6-A — 脱敏运行日志缓冲。

设计目标（作业书 R6-A）：
1. ``deque(maxlen=5000)`` 环形缓冲，满后丢弃最旧条目；
2. 自定义 ``logging.Handler`` 将应用日志写入缓冲；
3. 每条记录含单调 ID、timestamp、level、category、message；
4. 线程安全（``threading.Lock`` 保护写入与查询）；
5. lifespan 只挂载一次，shutdown 移除；
6. 进入缓冲前脱敏 Authorization/Bearer/api_key/token/secret/credential/URL key；
7. 绝对用户路径只保留文件名或逻辑位置；
8. 不记录 prompt、字幕、OCR、正文、请求/响应 body（约束由调用方遵守，
   本模块只对消息做密钥与路径脱敏，不主动抓取任何请求体）。

本模块只做只读观测，不提供任何清空 / 删除接口。
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass
from typing import Deque, Dict, List, Optional, Protocol

#: 环形缓冲默认上限。
DEFAULT_MAX_ENTRIES: int = 5000


@dataclass(frozen=True)
class LogEntry:
    """单条运行日志。"""

    id: int
    timestamp: float
    level: str
    category: str
    message: str

    def to_dict(self) -> Dict[str, object]:
        return asdict(self)


# --------------------------------------------------------------------------- #
# 脱敏
# --------------------------------------------------------------------------- #
# Authorization: Bearer <token> / Authorization: <value>
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-+/=]+")
_AUTH_HEADER_RE = re.compile(r"(?i)\bAuthorization\b\s*[:=]\s*[^\s,;]+")
# key=value / key: value 形式的密钥字段
_KEY_VALUE_RE = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|"
    r"client[_-]?secret|credential|password|passwd)\b\s*[:=]\s*[\"']?[^\s\"',;&]+"
)
# URL 查询串中的敏感参数 ?token=xxx&api_key=yyy
_URL_PARAM_RE = re.compile(
    r"(?i)([?&])(api[_-]?key|access[_-]?token|token|secret|key|credential|password)="
    r"[^&\s]+"
)
# POSIX 绝对路径（两段及以上），保留最后一段文件名
_POSIX_PATH_RE = re.compile(r"(?:/[\w.\-]+){2,}")
# Windows 绝对路径 C:\Users\... ，保留最后一段
_WIN_PATH_RE = re.compile(r"[A-Za-z]:\\(?:[\w.\-]+\\)*[\w.\-]+")


def _mask_path(match: re.Match) -> str:
    path = match.group(0)
    filename = path.rstrip("/").rsplit("/", 1)[-1]
    return filename or path


def _mask_win_path(match: re.Match) -> str:
    path = match.group(0)
    filename = path.rstrip("\\").rsplit("\\", 1)[-1]
    return filename or path


def sanitize_message(text: str) -> str:
    """对日志消息做密钥与绝对路径脱敏。

    - Bearer / Authorization / api_key / token / secret / credential / password
      的值替换为 ``***``；
    - URL 查询参数中的敏感键值替换为 ``***``；
    - 绝对用户路径只保留文件名。
    """
    result = text
    result = _BEARER_RE.sub("Bearer ***", result)
    result = _AUTH_HEADER_RE.sub("Authorization: ***", result)
    result = _KEY_VALUE_RE.sub(lambda m: f"{m.group(1)}=***", result)
    result = _URL_PARAM_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}=***", result)
    result = _WIN_PATH_RE.sub(_mask_win_path, result)
    result = _POSIX_PATH_RE.sub(_mask_path, result)
    return result


# --------------------------------------------------------------------------- #
# 缓冲
# --------------------------------------------------------------------------- #
class RuntimeLogBuffer:
    """线程安全的环形日志缓冲。"""

    def __init__(self, maxlen: int = DEFAULT_MAX_ENTRIES) -> None:
        self._entries: Deque[LogEntry] = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self._next_id = 1

    def append(self, level: str, category: str, message: str) -> LogEntry:
        """写入一条日志（写入前脱敏），返回生成的条目。"""
        sanitized = sanitize_message(message)
        with self._lock:
            entry = LogEntry(
                id=self._next_id,
                timestamp=time.time(),
                level=level,
                category=category,
                message=sanitized,
            )
            self._next_id += 1
            self._entries.append(entry)
            return entry

    def query(
        self,
        after_id: int = 0,
        level: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 200,
    ) -> List[LogEntry]:
        """按 after_id / level / category / limit 增量查询。"""
        with self._lock:
            result: List[LogEntry] = []
            for entry in self._entries:
                if entry.id <= after_id:
                    continue
                if level and entry.level != level:
                    continue
                if category and entry.category != category:
                    continue
                result.append(entry)
                if len(result) >= limit:
                    break
            return result

    @property
    def latest_id(self) -> int:
        """当前已分配的最大 ID（无条目时为 0）。"""
        with self._lock:
            return self._next_id - 1


# --------------------------------------------------------------------------- #
# logging.Handler
# --------------------------------------------------------------------------- #
class LogSink(Protocol):
    """RuntimeLogHandler 可写入的最小接口。"""

    def append(self, level: str, category: str, message: str) -> object: ...


class RuntimeLogHandler(logging.Handler):
    """把 LogRecord 写入统一日志 sink 的 handler。"""

    def __init__(self, buffer: LogSink) -> None:
        super().__init__()
        self.buffer = buffer

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001
            message = str(record.msg)
        try:
            self.buffer.append(record.levelname, record.name, message)
        except Exception:  # noqa: BLE001
            # 观测 handler 绝不允许把异常抛回业务日志链路
            self.handleError(record)


# --------------------------------------------------------------------------- #
# 安装 / 卸载（幂等）
# --------------------------------------------------------------------------- #
_INSTALL_LOCK = threading.Lock()


def install(
    buffer: Optional[LogSink] = None,
    logger: Optional[logging.Logger] = None,
) -> RuntimeLogHandler:
    """把 RuntimeLogHandler 挂到目标 logger（默认 root）。

    幂等：若目标 logger 已挂载 RuntimeLogHandler，直接返回既有实例，
    避免测试 / 热重载重复安装造成日志翻倍。
    """
    target = logger or logging.getLogger()
    with _INSTALL_LOCK:
        for handler in target.handlers:
            if isinstance(handler, RuntimeLogHandler):
                return handler
        if buffer is None:
            # 延迟导入避免 runtime_log_store 复用 sanitize_message 时形成循环导入。
            from backend.app.services.runtime_log_store import get_default_store

            buffer = get_default_store()
        buf = buffer
        handler = RuntimeLogHandler(buf)
        target.addHandler(handler)
        return handler


def uninstall(logger: Optional[logging.Logger] = None) -> None:
    """从目标 logger（默认 root）移除所有 RuntimeLogHandler。"""
    target = logger or logging.getLogger()
    with _INSTALL_LOCK:
        for handler in list(target.handlers):
            if isinstance(handler, RuntimeLogHandler):
                target.removeHandler(handler)


# --------------------------------------------------------------------------- #
# 默认单例（供 lifespan 与 /admin/logs 路由共享）
# --------------------------------------------------------------------------- #
_default_buffer: Optional[RuntimeLogBuffer] = None
_default_lock = threading.Lock()


def get_default_buffer() -> RuntimeLogBuffer:
    """返回进程级默认缓冲单例（惰性创建）。"""
    global _default_buffer
    if _default_buffer is None:
        with _default_lock:
            if _default_buffer is None:
                _default_buffer = RuntimeLogBuffer()
    return _default_buffer
