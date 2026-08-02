# AI Handoff

## 当前执行指针（2026-08-02，第 5 批最终收尾完成）

- **当前分支**：`codex/continue-product-redesign`
- **当前 HEAD**：本文件所在提交（第 5 批收尾，主题 `test: close reviewed usability gaps`），以 `git log` 为准。旧指针 `62b57e0` 已失效，同主题提交实际哈希为 `f554df1`。

### 提交历史（本轮，最新在前）

| 哈希 | 主题 |
|---|---|
| 本文件所在提交（以 `git log` 为准） | test: close reviewed usability gaps |
| `d0a4f17` | fix: finish frame interval and apple asr settings |
| `75983ba` | fix: harden task cards and local model catalog |
| `fc729c9` | fix: make model roles capability aware |
| `7e9ef99` | fix: make diagnostic logs actionable |
| `f554df1` | test: close product usability regression matrix |

### 第 5 批改动

1. `shared/settings_store.py`：`migrate_transcriber_type` 显式消费 `_RETIRED_TRANSCRIBER_TYPES` 处理 bcut/kuaishou（此前该常量只出现在 docstring，运行代码未引用）；未知值仍回退 auto，白名单值原样保留；未恢复退役引擎 UI。`tests/backend/test_settings_store.py` 同步补源码级断言，先红后绿（TDD）。
2. 清理 `pnpm build` 测试类型债务（仅测试夹具/类型收窄，未改业务语义）：
   - `KnowledgeConversationPage.test.tsx` / `SearchPage.test.tsx`：夹具补必填 `default_item_refs`，message 补必填 `scope_item_refs`。
   - `LocalModelsPanel.test.tsx`：新增 `cardOf()` helper，用 instanceof 断言把 `closest('article')` 收窄为非空 HTMLElement。
   - `SettingsShellSaveBar.test.tsx`：saveBar 用 instanceof 守卫收窄为 HTMLElement。

### 最终测试 / 构建结果（真实退出码）

- 前端测试：`CI=true pnpm test` → 83 文件 / 427 passed，退出码 0。
  注：首轮全量 `VideoResultKnowledgeDeepLink.test.tsx` 曾超时失败 1 例（负载敏感 flaky），单独运行通过、全量重跑全绿；与本批改动无关（本批未改其依赖）。
- 后端测试：`.venv/bin/python -m pytest tests/backend -q` → 871 passed / 2 skipped，退出码 0。
  skipped 明细：`test_audio_analyzer.py:315`（silero-vad torch 模型，需 `RUN_AUDIO_MODEL_TESTS=1` 单跑）、`test_ocr_service.py:44`（PaddleOCR 模型不可用）。
- 构建：`pnpm build`（`tsc -b && vite build`）退出码 0。

### 未验证项

- 未启动应用做浏览器回归（B站真实封面、防盗链、任务删除流程、保存条交互）
- 未在 Apple Silicon / NVIDIA 真机验证 MLX/CUDA 路径
- 未验证新云转录服务（本轮未接入任何新第三方）
- 后端 2 个 skipped 为本地模型依赖缺失，本环境未验证
- 未 push 到远端

### 脏文件

无（工作区干净，本文件更新随本批提交）

## 当前执行顺序

第 1–5 批已全部完成。后续操作需用户明确授权。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
