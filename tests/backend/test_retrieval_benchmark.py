from __future__ import annotations

from scripts.benchmark_retrieval_cache import choose_cache_strategy


def test_choose_workspace_cache_when_selective_queries_are_bounded() -> None:
    result = choose_cache_strategy(
        {
            "global": {
                "build_ms": 100.0,
                "cache_bytes": 1_000,
                "scopes": {
                    "1": {"hit_ms": 12.0},
                    "5": {"hit_ms": 15.0},
                    "all": {"hit_ms": 20.0},
                },
            },
            "workspace": {
                "build_ms": 110.0,
                "cache_bytes": 1_100,
                "scopes": {
                    "1": {"hit_ms": 4.0},
                    "5": {"hit_ms": 8.0},
                    "all": {"hit_ms": 25.0},
                },
            },
        }
    )

    assert result["strategy"] == "workspace"
    assert "selective" in result["reason"]


def test_keep_global_cache_when_workspace_overhead_is_excessive() -> None:
    result = choose_cache_strategy(
        {
            "global": {
                "build_ms": 100.0,
                "cache_bytes": 1_000,
                "scopes": {"1": {"hit_ms": 5.0}},
            },
            "workspace": {
                "build_ms": 240.0,
                "cache_bytes": 2_100,
                "scopes": {"1": {"hit_ms": 4.0}},
            },
        }
    )

    assert result["strategy"] == "global"
    assert "overhead" in result["reason"]
