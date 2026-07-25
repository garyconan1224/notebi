# P7 检索与发布收口证据

- 数据规模：44 个合集、61 个独立内容、34,211 个检索块。
- 精确索引：SQLite FTS5 可用；中文短词与无 FTS5 环境走 `LIKE` 降级。
- 热查询样例：`offline` 38.093 ms，`2026` 38.330 ms，`Qwen3` 38.420 ms。
- 冷查询样例：`产品` 275.867 ms，返回 10 条；包含首次签名检查和磁盘页预热。
- 混合模式：语义结果与精确结果使用 RRF 融合，智能回答保持语义链路生成结果。
- 精确模式：不调用 embedding、reranker 或回答模型。
- 身份迁移：61 个唯一 `content_id`、60 个 `lineage_id`，重复 dry-run 为 0 变更。
- 兼容性：`/knowledge` 继续跳转 `/search`；Windows 无 FTS5 时有单元测试覆盖的纯 SQLite 降级路径。

命令：

```bash
./.venv/bin/python scripts/benchmark_search_modes.py --modes exact
./.venv/bin/pytest -q tests/backend/test_hybrid_search.py tests/backend/test_exact_search.py
```

限制：本机不是 Windows，Windows 离线包只能验证降级代码与构建产物，不能替代 Windows 实机启动验收。
