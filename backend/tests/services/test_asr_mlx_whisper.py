"""mlx-whisper download progress regression tests."""

from __future__ import annotations

from tqdm.contrib.concurrent import thread_map

from backend.app.services.asr_mlx_whisper import (
    _DownloadProgressAggregator,
    _FileProgress,
)


def test_file_progress_is_compatible_with_snapshot_download_thread_map() -> None:
    """snapshot_download passes tqdm_class to thread_map, not per-file downloads."""
    progress: list[tuple[float, str]] = []
    logs: list[str] = []

    _DownloadProgressAggregator.reset(
        lambda ratio, msg: progress.append((ratio, msg)),
        logs.append,
    )

    result = thread_map(
        lambda value: value * 2,
        [1, 2, 3],
        desc="Fetching 3 files",
        max_workers=1,
        tqdm_class=_FileProgress,
    )

    assert result == [2, 4, 6]
    assert logs == ["📥 开始下载模型文件..."]
    assert progress[-1] == (1.0, "📥 下载模型 | 3/3 files")
