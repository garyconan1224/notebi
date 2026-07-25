from __future__ import annotations

import asyncio

from backend.app import main


def test_lifespan_runs_metadata_migration_after_legacy_purge(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(main, "_seed_siliconflow_provider", lambda: calls.append("seed"))
    monkeypatch.setattr(main, "_purge_legacy_replica_data", lambda: calls.append("purge"))
    monkeypatch.setattr(main, "_migrate_legacy_metadata", lambda: calls.append("migrate"))

    async def exercise() -> None:
        async with main.lifespan(main.app):
            calls.append("serve")

    asyncio.run(exercise())

    assert calls == ["seed", "purge", "migrate", "serve"]
