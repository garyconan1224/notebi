"""WorkspaceRecord.kind 字段测试：旧数据兜底 + 显式 replica 透传。"""

from backend.app.models.workspace import WorkspaceRecord


def test_from_dict_missing_kind_defaults_to_note():
    """旧数据（无 kind 字段）from_dict 应默认 kind='note'。"""
    data = {
        "workspace_id": "ws-old",
        "name": "旧合集",
    }
    rec = WorkspaceRecord.from_dict(data)
    assert rec.kind == "note"


def test_from_dict_explicit_replica():
    """显式 kind='replica' 应透传。"""
    data = {
        "workspace_id": "ws-replica",
        "name": "复刻合集",
        "kind": "replica",
    }
    rec = WorkspaceRecord.from_dict(data)
    assert rec.kind == "replica"


def test_from_dict_invalid_kind_defaults_to_note():
    """kind 值非法时应兜底为 note。"""
    data = {
        "workspace_id": "ws-bad",
        "name": "坏数据",
        "kind": "invalid_value",
    }
    rec = WorkspaceRecord.from_dict(data)
    assert rec.kind == "note"


def test_to_dict_includes_kind():
    """to_dict 应输出 kind 字段。"""
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试", kind="replica")
    d = rec.to_dict()
    assert d["kind"] == "replica"


def test_to_dict_default_kind_is_note():
    """默认构造 kind='note'。"""
    rec = WorkspaceRecord(workspace_id="ws-2", name="默认")
    d = rec.to_dict()
    assert d["kind"] == "note"
