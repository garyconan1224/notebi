"""R7 运行时验收：干净启动冒烟回归测试。

对应 fix(startup) ec227d3 —— 干净 checkout 没有 data/（被 .gitignore 排除），
而 StaticFiles 默认 check_dir=True 会在导入期因目录缺失抛错。修复在挂载 /static
前执行 ``(_ROOT_DIR / "data").mkdir(parents=True, exist_ok=True)``。

本测试锁定该契约：导入 backend.app.main 后 data/ 必存在且 /static 已挂载，
使无 data/ 的全新检出无需手工 mkdir 即可启动与运行完整后端测试。
"""
from __future__ import annotations

import asyncio

from backend.app.services.runtime_log_store import RuntimeLogStore


def test_main_imports_successfully():
    import backend.app.main as main

    assert main.app is not None
    assert main.app.title == "NoteBi API"


def test_data_dir_ensured_on_import():
    """导入后 data/ 目录必须存在（挂载前 mkdir 的契约）。"""
    import backend.app.main as main

    data_dir = main._ROOT_DIR / "data"
    assert data_dir.is_dir(), "data/ 应在导入时被自动创建，干净 checkout 无需手工 mkdir"


def test_static_route_mounted():
    """/static 静态文件挂载存在。"""
    import backend.app.main as main

    mounted = [getattr(route, "path", "") for route in main.app.routes]
    assert any(path.startswith("/static") for path in mounted), (
        f"/static 挂载缺失，实际路由前缀样本={mounted[:10]}"
    )


def test_lifespan_writes_application_started(tmp_path, monkeypatch):
    import backend.app.main as main
    from backend.app.services import runtime_log_store

    store = RuntimeLogStore(tmp_path / "logs")
    monkeypatch.setattr(runtime_log_store, "_default_store", store)
    monkeypatch.setattr(main, "_seed_siliconflow_provider", lambda: None)
    monkeypatch.setattr(main, "_purge_legacy_replica_data", lambda: None)
    monkeypatch.setattr(main, "_migrate_legacy_metadata", lambda: None)

    async def run_lifespan():
        async with main.lifespan(main.app):
            pass

    asyncio.run(run_lifespan())
    events = store.query(limit=10).entries
    assert events[-1].stage == "application_started"
