# 外部执行器历史说明

> 文件名为兼容旧链接保留 `mimo-onboarding.md`；它不再定义 NoteBi 默认执行方式。
>
> NoteBi 默认由 Codex 直接实现、测试和验证。只有用户在当前任务明确要求 Claude Code / 千问时，才按本文件的会话和读取约束执行。
>
> Last updated: 2026-05-29

---

## 1. 启动 60 秒：只做这 4 件事

每次新任务先 `/clear` 或退出后启动全新 Claude Code 会话；同一问题返修才允许 resume。确认旧进程已停止后，新会话第一动作（**不要并行读 8 个文件**，按顺序做）：

```bash
# A. 对账 git 真实状态（这是事实来源，不是 plan 文档）
git status --short --branch && git log --oneline -10

# B. 读最关键的「当前指针」（小文件，全文 OK）
sed -n '1,30p' docs/AI_HANDOFF.md         # 当前阶段 + 立即下一步
sed -n '1,80p' docs/AI_HANDOFF.md         # 当前执行入口

# C. 看用户给我的本会话 plan（如果路径里提了某个 docs/plans/<X>.md）
# → 用 sed -n 读 1-50 行先看 frontmatter（status / depends_on / commits）

# D. 对账无冲突则按 Codex 已确认的任务继续；分支、HEAD、脏文件或任务事实不符才停止报告
```

**禁止动作**：

- ❌ 不 `/clear` 就把无关的新任务塞进旧会话
- ❌ 静默启动用户看不到的长后台执行（优先右侧/集成终端，不能直连时用前台 Terminal）
- ❌ 启动时通读历史计划 → 只读 `docs/AI_HANDOFF.md` 前 80 行和当前点名计划
- ❌ 根据旧规格猜产品方向 → 产品边界按需读 `docs/PRODUCT_DECISIONS.md`
- ❌ 启动时 `Read CLAUDE.md`（system context 已经注入了）→ 不重复读
- ❌ 启动时一次性 read 5+ 文档 → 信息过载，反而想不清楚

---

## 2. 低 token 读取协议

| 场景 | 错 | 对 |
|---|---|---|
| 找一个函数定义 | `Read backend/app/routes/workspaces.py`（5000+ 行） | `rg -n "def save_preflight" backend/` 拿到行号后 `sed -n '1315,1340p'` |
| 看某 phase 计划 | `Read docs/plans/phase-xxx.md`（全文） | 先 `sed -n '1,15p'` 看 frontmatter，再读 step 段 |
| 找 React 组件 | 整目录 ls + 多个 Read | `rg -ln "FloatingTaskQueue" frontend/src/` 直接命中 |
| 查代码风格 | Read 整个 code-style.md | `rg -n "^##" docs/rules/code-style.md` 看目录再 sed 读段 |
| 不知道入口 | 满项目找 | 先看 `docs/AI_CODE_INDEX.md` 的入口表 |

**核心原则**：**先定位、再窄读**。任何超过 200 行的文件，**绝不允许整文件 Read**。

---

## 3. codegraph MCP 优先

项目已配 codegraph MCP（会话开始时可能显示 `still connecting`，等几秒）。**有 codegraph 时**：

- 找函数被谁调用：`codegraph` 查反向引用，**不要** `rg "functionName"` 全仓扫
- 找类型定义：`codegraph` 查符号，**不要** Read 整个类型文件
- 改 API 影响面：`codegraph` 查 caller graph，比 grep 快

**codegraph 不可用时**：fallback 到 `rg`（仍然比 Read 快得多）。

---

## 4. 写代码：surgical + 一次 commit 一件事

按 CLAUDE.md §5「项目执行计划维护流程」：

- **每个 Step 一个 commit**，commit message 格式 `<type>(<phase>): <做了什么>`，结尾带 Co-Authored-By（按仓库现有风格）
- **不要把多个 Step 揉进一个 commit** → 破坏用户的回滚颗粒度
- **改前先一句话说明**：「我要改 X 文件的 Y 函数，原因是 Z」，等于让用户能在 1 句话内拦截错误方向
- **改完一句话总结**：什么变了、产生什么效果。1 句话足够，不要长段落

---

## 5. 验证：自己跑，结果报数字

按记忆 [[feedback-self-verify-code]]：

- 后端：`.venv/bin/python -m pytest tests/backend -q -k "<filter>"` 跑相关测试，报 pass/fail 数字
- 前端：`pnpm test --run -- <pattern>` 或 `pnpm build` 或 `npx tsc --noEmit`
- 不要全套测试都跑（费时）→ 只跑和本次改动直接相关的
- **跑完报告**：「pytest 12 passed / tsc EXIT=0」，**不要贴日志**

**只有 UI 动态交互**（点击、动画、弹窗）才请用户帮看。代码级（API 返回、build 结果）必须自己跑。

---

## 6. 不确定时的 fallback（按顺序）

千问遇到任何不确定（字段名、行号漂移、API 路径），按顺序尝试，**不要凭直觉决定**：

1. `rg` 一次（关键词或符号定位）
2. codegraph 查符号
3. 读 `docs/AI_CODE_INDEX.md` 找入口
4. 涉及产品取舍时读 `docs/PRODUCT_DECISIONS.md`
5. **停下来问用户**（按 CLAUDE.md §4 风险求证模板）

按记忆 [[feedback-no-guessing]]：**任何不明确细节必须停下问，不凭直觉决定**。

---

## 7. 输出预算：精简、可扫读

- **进度更新**：1 句话，不要分段
- **改动总结**：1-2 句话，包含「改了哪几个文件 + 产生什么效果」，不要复述代码
- **不要贴 git diff**：用户能自己跑 `git diff`
- **不要贴 test 日志**：报 pass/fail 数字即可
- **commit 完成后**：报 commit hash 一行，不要复述 commit message

---

## 8. 红线（重复 CLAUDE.md §4，千问务必记住）

❌ 绝不执行的命令：

- `rm -rf` / `git reset --hard` / `git push --force` / `git clean -fd`
- `git push origin`（开源前暂缓所有 push）
- `git rebase` / `git commit --amend` 主线 commit
- 装新依赖（pip install / npm install 新包）
- 改 `.env` / `.env.example`
- 在 `docs/archive/` 或 `docs/conversation-inputs/` 里搜索（DEPRECATED）

⚠️ 必须停下问的场景：

- 实际代码与 plan.md 描述不符（字段名、行号漂移除外，这类按关键字定位）
- 跨 5+ 文件改动
- 涉及 schema / 加密 / API key / 鉴权
- UI 任务缺少 Open Design 设计产物，或设计与代码事实矛盾（不猜 UI，先回报）

---

## 9. 常用命令速查（千问直接复制用）

```bash
# 启动对账
git status --short --branch && git log --oneline -15

# ── 启动 / 停止 ──────────────────────────────────────────────────
# 日常快速启动（自动读 .env 端口、杀旧进程、起前后端、轮询健康检查）
./dev-notebi.sh

# 停止所有服务
./stop-notebi.command

# 验证已就绪（从 .env 读端口，NoteBi 默认 8001 / 5181）
BACKEND_PORT=$(grep -E '^BACKEND_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'"); BACKEND_PORT=${BACKEND_PORT:-8001}
VITE_PORT=$(grep -E '^VITE_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'"); VITE_PORT=${VITE_PORT:-5181}
curl -s "http://localhost:$BACKEND_PORT/health" && echo "" && curl -so /dev/null -w "%{http_code}" "http://localhost:$VITE_PORT/"

# ── 测试 ─────────────────────────────────────────────────────────
# 跑后端单测（按 phase / 关键字过滤）
.venv/bin/python -m pytest tests/backend -q -k "workspace"

# 前端类型检查
cd frontend && npx tsc --noEmit

# 前端单测
cd frontend && pnpm test --run

# 前端构建
cd frontend && pnpm build
```
