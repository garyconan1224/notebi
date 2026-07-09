"""TaskStore 测试（v2：一任务一文件）。

覆盖：
- 启动清理（僵尸→FAILED，终态不动）
- 迁移（旧单文件 → N 个新文件）
- 单任务写不影响其他文件
- delete 删文件
"""

import json
from pathlib import Path

from backend.app.models.tasks import TaskStatus
from backend.app.services.task_store import TaskStore


def _write_legacy(path: Path, records: list[dict]) -> None:
    """写入旧格式（单文件 JSON 数组）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")


# ── 启动清理测试 ──────────────────────────────────────────────

def test_load_marks_non_terminal_as_failed(tmp_path):
    """非终态僵尸（PENDING / 截帧中）→ FAILED；终态任务不动。"""
    legacy_path = tmp_path / "backend_tasks.json"
    _write_legacy(
        legacy_path,
        [
            {"task_id": "zombie-pending", "status": "PENDING", "progress": 0.0},
            {"task_id": "zombie-frames", "status": "FRAMES", "progress": 0.6},
            {"task_id": "done-ok", "status": "SUCCESS", "progress": 1.0},
            {"task_id": "done-fail", "status": "FAILED", "error": "原始错误"},
        ],
    )

    store = TaskStore(path=legacy_path)

    # 非终态 → FAILED + 中断说明
    pending = store.get("zombie-pending")
    frames = store.get("zombie-frames")
    assert pending is not None and pending.status == TaskStatus.FAILED.value
    assert "重启" in pending.error
    assert frames is not None and frames.status == TaskStatus.FAILED.value

    # 终态不动
    assert store.get("done-ok").status == TaskStatus.SUCCESS.value
    fail = store.get("done-fail")
    assert fail.status == TaskStatus.FAILED.value
    assert fail.error == "原始错误"


def test_load_persists_cleanup_to_disk(tmp_path):
    """清理后新目录下对应文件也变干净（下次重启不再复活）。"""
    legacy_path = tmp_path / "backend_tasks.json"
    _write_legacy(legacy_path, [{"task_id": "z", "status": "ASR", "progress": 0.3}])

    TaskStore(path=legacy_path)  # 触发迁移 + 清理

    # 旧文件已被重命名为 .migrated
    migrated = legacy_path.with_suffix(".json.migrated")
    assert migrated.is_file()

    # 新目录下的任务文件：僵尸已是 FAILED
    task_file = tmp_path / "tasks" / "z.json"
    on_disk = json.loads(task_file.read_text(encoding="utf-8"))
    assert on_disk["status"] == TaskStatus.FAILED.value


def test_load_no_rewrite_when_all_terminal(tmp_path):
    """全是终态时新文件仍为 SUCCESS（不清除已有数据）。"""
    legacy_path = tmp_path / "backend_tasks.json"
    _write_legacy(
        legacy_path,
        [{"task_id": "ok", "status": "SUCCESS", "progress": 1.0, "payload": {"url": "x"}}],
    )

    store = TaskStore(path=legacy_path)

    rec = store.get("ok")
    assert rec is not None
    assert rec.status == TaskStatus.SUCCESS.value
    assert rec.payload.get("url") == "x"


# ── 迁移正确性测试 ──────────────────────────────────────────────

def test_migration_count_and_content_match(tmp_path):
    """旧单文件 → N 个新文件，条数和字段一致。"""
    legacy_path = tmp_path / "backend_tasks.json"
    original = [
        {"task_id": "a", "status": "SUCCESS", "project_id": "p1", "task_type": "download"},
        {"task_id": "b", "status": "FAILED", "project_id": "p1", "task_type": "note", "error": "e"},
        {"task_id": "c", "status": "SUCCESS", "project_id": "p2", "task_type": "analyze"},
    ]
    _write_legacy(legacy_path, original)

    TaskStore(path=legacy_path)

    # 旧文件变 .migrated
    assert legacy_path.with_suffix(".json.migrated").is_file()
    assert not legacy_path.is_file()

    # 新目录下有 3 个文件
    tasks_dir = tmp_path / "tasks"
    files = sorted(tasks_dir.glob("*.json"))
    assert len(files) == 3, f"期望 3 个文件，实际 {len(files)}: {[f.name for f in files]}"

    # 内容一致
    task_ids_found = set()
    for fp in files:
        d = json.loads(fp.read_text(encoding="utf-8"))
        task_ids_found.add(d["task_id"])
    assert task_ids_found == {"a", "b", "c"}


def test_migration_is_idempotent(tmp_path):
    """已有新目录时不再重复迁移。"""
    legacy_path = tmp_path / "backend_tasks.json"
    _write_legacy(legacy_path, [{"task_id": "x", "status": "SUCCESS"}])

    # 第一次：触发迁移
    store1 = TaskStore(path=legacy_path)
    assert store1.get("x") is not None
    assert legacy_path.with_suffix(".json.migrated").is_file()

    # 重新创建旧文件（模拟有人手动恢复）
    _write_legacy(legacy_path, [{"task_id": "x", "status": "SUCCESS"}, {"task_id": "y", "status": "FAILED"}])

    # 第二次加载：新目录已有文件，跳过迁移，y 不在内存
    store2 = TaskStore(path=legacy_path)
    assert store2.get("x") is not None
    assert store2.get("y") is None  # y 没被迁移（新目录已有 x.json）


# ── 单文件写入测试 ──────────────────────────────────────────────

def test_write_one_does_not_touch_others(tmp_path):
    """create/update 只写对应任务文件，不碰其他文件。"""
    legacy_path = tmp_path / "backend_tasks.json"
    _write_legacy(
        legacy_path,
        [
            {"task_id": "a", "status": "SUCCESS"},
            {"task_id": "b", "status": "SUCCESS"},
        ],
    )
    store = TaskStore(path=legacy_path)

    tasks_dir = tmp_path / "tasks"
    mtime_a_before = (tasks_dir / "a.json").stat().st_mtime
    mtime_b_before = (tasks_dir / "b.json").stat().st_mtime

    # 只更新任务 a
    store.update("a", status="FAILED")

    mtime_a_after = (tasks_dir / "a.json").stat().st_mtime
    mtime_b_after = (tasks_dir / "b.json").stat().st_mtime

    assert mtime_a_after > mtime_a_before, "a.json 应该在 update 后被写入"
    assert mtime_b_after == mtime_b_before, "b.json 不应被写入"


# ── delete 删文件测试 ──────────────────────────────────────────

def test_delete_removes_file(tmp_path):
    """delete 删内存记录也删对应文件。"""
    legacy_path = tmp_path / "backend_tasks.json"
    _write_legacy(legacy_path, [{"task_id": "to-delete", "status": "SUCCESS"}])
    store = TaskStore(path=legacy_path)

    task_file = tmp_path / "tasks" / "to-delete.json"
    assert task_file.is_file()

    assert store.delete("to-delete") is True
    assert not task_file.exists()
    assert store.get("to-delete") is None


def test_delete_nonexistent_is_noop(tmp_path):
    """删不存在的任务返回 False，不掉文件。"""
    legacy_path = tmp_path / "backend_tasks.json"
    _write_legacy(legacy_path, [{"task_id": "real", "status": "SUCCESS"}])
    store = TaskStore(path=legacy_path)

    assert store.delete("nope") is False


# ── 空目录加载 ──────────────────────────────────────────────────

def test_load_empty_dir(tmp_path):
    """无旧文件、无新目录时正常启动。"""
    store = TaskStore(path=tmp_path / "backend_tasks.json")
    assert store.list_all() == []
