"""F1.7 URL 规整 + 去重 后端单测。

覆盖：
- _normalize_media_url 4 种规整变体
- task_runner._normalize_url_for_dedup 去重比较
- 同一视频带不同追踪参数应去重
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestNormalizeMediaUrl:
    """workspaces.py _normalize_media_url 单元测试。"""

    def test_pure_bv_number(self):
        """纯 BV 号 → 完整 B 站 URL。"""
        from backend.app.routes.workspaces import _normalize_media_url
        result = _normalize_media_url("BV1qA5j6jEJC")
        assert result == "https://www.bilibili.com/video/BV1qA5j6jEJC"

    def test_missing_scheme(self):
        """缺 scheme → 补 https://。"""
        from backend.app.routes.workspaces import _normalize_media_url
        result = _normalize_media_url("bilibili.com/video/BV1xx/")
        assert result == "https://bilibili.com/video/BV1xx"

    def test_remove_tracking_params(self):
        """带追踪参数 → 参数被清除。"""
        from backend.app.routes.workspaces import _normalize_media_url
        raw = (
            "https://www.bilibili.com/video/BV1qA5j6jEJC/"
            "?spm_id_from=333.1007.tianma.6-2-20.click"
            "&vd_source=d0c732f14ae6900c501b38a4d1c34b7d"
        )
        result = _normalize_media_url(raw)
        assert result == "https://www.bilibili.com/video/BV1qA5j6jEJC"

    def test_already_clean_noop(self):
        """已规整 URL 不变。"""
        from backend.app.routes.workspaces import _normalize_media_url
        clean = "https://www.bilibili.com/video/BV1qA5j6jEJC"
        assert _normalize_media_url(clean) == clean

    def test_preserve_non_tracking_params(self):
        """非追踪参数（如 YouTube v= / list=）应保留。"""
        from backend.app.routes.workspaces import _normalize_media_url
        result = _normalize_media_url(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxx"
        )
        assert "v=dQw4w9WgXcQ" in result
        assert "list=PLxxx" in result

    def test_different_tracking_params_same_result(self):
        """同一视频带不同追踪参数 → 规整后 key 相同。"""
        from backend.app.routes.workspaces import _normalize_media_url
        a = _normalize_media_url(
            "https://www.bilibili.com/video/BV1qA5j6jEJC/?spm_id_from=333.1007&vd_source=abc"
        )
        b = _normalize_media_url(
            "https://www.bilibili.com/video/BV1qA5j6jEJC/?spm_id_from=444.2008&vd_source=xyz"
        )
        assert a == b == "https://www.bilibili.com/video/BV1qA5j6jEJC"


class TestTaskRunnerDedup:
    """task_runner URL 去重单元测试。"""

    def test_normalize_url_for_dedup_basic(self):
        """去重用正则 → 追踪参数剥离。"""
        from backend.app.services.task_runner import TaskRunner
        from backend.app.services.task_store import TaskStore

        store = TaskStore.__new__(TaskStore)
        runner = TaskRunner.__new__(TaskRunner)
        runner.store = store

        raw = (
            "https://www.bilibili.com/video/BV1qA5j6jEJC/"
            "?spm_id_from=333.1007&vd_source=abc"
        )
        result = runner._normalize_url_for_dedup(raw)
        assert result == "https://www.bilibili.com/video/bv1qa5j6jejc"

    def test_duplicate_detection_with_different_tracking_params(self):
        """同一视频带不同追踪参数 → _has_active_duplicate 返回 True。"""
        from backend.app.services.task_runner import TaskRunner
        from backend.app.services.task_store import TaskStore
        from backend.app.models.tasks import TaskRecord, TaskStatus

        store = TaskStore.__new__(TaskStore)
        runner = TaskRunner.__new__(TaskRunner)
        runner.store = store

        # 模拟已有一个带追踪参数的下载任务
        existing = TaskRecord(
            task_id="download-abc",
            project_id="proj-1",
            task_type="download",
            payload={
                "url": "https://www.bilibili.com/video/BV1qA5j6jEJC/?spm_id_from=333.1007&vd_source=abc"
            },
            status=TaskStatus.DOWNLOAD.value,
        )
        store.list_all = MagicMock(return_value=[existing])

        # 新提交的同一视频，但追踪参数不同
        dup_id = runner._has_active_duplicate(
            "proj-1",
            "download",
            {
                "url": "https://www.bilibili.com/video/BV1qA5j6jEJC/?spm_id_from=444.2008&vd_source=xyz"
            },
        )
        assert dup_id == "download-abc"

    def test_no_duplicate_for_different_videos(self):
        """不同视频 → 不去重。"""
        from backend.app.services.task_runner import TaskRunner
        from backend.app.services.task_store import TaskStore
        from backend.app.models.tasks import TaskRecord, TaskStatus

        store = TaskStore.__new__(TaskStore)
        runner = TaskRunner.__new__(TaskRunner)
        runner.store = store

        existing = TaskRecord(
            task_id="download-abc",
            project_id="proj-1",
            task_type="download",
            payload={"url": "https://www.bilibili.com/video/BV1xx/"},
            status=TaskStatus.DOWNLOAD.value,
        )
        store.list_all = MagicMock(return_value=[existing])

        dup_id = runner._has_active_duplicate(
            "proj-1",
            "download",
            {"url": "https://www.bilibili.com/video/BV1yy/"},
        )
        assert dup_id is None
