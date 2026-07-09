"""WorkspaceRecord.source 字段测试：旧数据兜底 + 显式值透传。"""

from backend.app.models.workspace import WorkspaceRecord


def test_from_dict_missing_source_defaults_to_manual():
    """旧数据（无 source 字段）from_dict 应默认 source='manual'。"""
    data = {
        "workspace_id": "ws-old",
        "name": "旧合集",
    }
    rec = WorkspaceRecord.from_dict(data)
    assert rec.source == "manual"
    assert rec.source_meta == {}


def test_from_dict_explicit_bilibili_favorites():
    """显式 source='bilibili_favorites' 应透传，source_meta 保留。"""
    data = {
        "workspace_id": "ws-fav",
        "name": "收藏夹合集",
        "source": "bilibili_favorites",
        "source_meta": {"fav_id": "123", "fav_title": "默认收藏夹"},
    }
    rec = WorkspaceRecord.from_dict(data)
    assert rec.source == "bilibili_favorites"
    assert rec.source_meta == {"fav_id": "123", "fav_title": "默认收藏夹"}


def test_from_dict_invalid_source_defaults_to_manual():
    """source 值非法时应兜底为 manual。"""
    data = {
        "workspace_id": "ws-bad",
        "name": "坏数据",
        "source": "invalid_value",
    }
    rec = WorkspaceRecord.from_dict(data)
    assert rec.source == "manual"


def test_to_dict_includes_source():
    """to_dict 应输出 source + source_meta 字段。"""
    rec = WorkspaceRecord(
        workspace_id="ws-1",
        name="测试",
        source="bilibili_multipart",
        source_meta={"bvid": "BV1xx", "part_count": 3},
    )
    d = rec.to_dict()
    assert d["source"] == "bilibili_multipart"
    assert d["source_meta"] == {"bvid": "BV1xx", "part_count": 3}


def test_from_dict_source_meta_not_dict_falls_back():
    """source_meta 不是 dict 时应兜底为空 dict。"""
    data = {
        "workspace_id": "ws-meta-bad",
        "name": "坏meta",
        "source_meta": "not_a_dict",
    }
    rec = WorkspaceRecord.from_dict(data)
    assert rec.source_meta == {}


def test_roundtrip():
    """to_dict → from_dict 往返应保留 source 信息。"""
    original = WorkspaceRecord(
        workspace_id="ws-rt",
        name="往返测试",
        source="bilibili_uploader",
        source_meta={"uid": "12345", "uploader_name": "UP主"},
    )
    rec = WorkspaceRecord.from_dict(original.to_dict())
    assert rec.source == "bilibili_uploader"
    assert rec.source_meta == {"uid": "12345", "uploader_name": "UP主"}
