# 上下文预算 / 读文件策略 / Agent / Skill / 接力

> 本文件由 `CLAUDE.md` §7 索引指向。AI 用 `rg -n "^##" docs/rules/context-budget.md` 查目录后再 `sed -n` 读片段，**不要整文件读**。
>
> 适用范围：本节约束 **Claude Code 终端版**（含 ccswitch 接 DS）。**不要求 Codex、Claude Desktop 或其他工具照此限制**，其他工具可按各自能力选择更合适的验证方式。
>
> 目标：保留能力但减少无效上下文。不要用"禁用工具"替代验证；要按下面顺序选最低成本且足够强的证据。

---

## 1. 文件读取

1. **先用 `rg -n` / heading 搜索定位**，再读必要片段。
2. `docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、大 TSX 文件不要默认整文件读取；`docs/SPEC.md` 只读入口索引，细节按需读 `docs/spec/*.md` 对应模块。
3. compact/resume 后**不要重复读 unchanged 文件**；先看 `git diff -- <file>` 或用 `rg` 找刚改过的函数/组件。
4. 流程图先读 `docs/flows/README.md` 和对应 `docs/flows/<track>.md`。源 PNG 只在 Markdown 缺失、hash 过期、需求冲突，或必须判断视觉布局/颜色/层级时读取；读取前先裁剪相关区域。
5. 代码入口先看 `docs/AI_CODE_INDEX.md`。它是低 token 路线图，只给入口和关键词；真正修改前仍以实际代码为准。
6. **单次读取硬规则：大于 300 行的文件禁止无 offset/limit 的 `Read`**。先跑 `rg -n "函数名|组件名|关键词" <file>`，再用 `sed -n '起始,结束p' <file>` 或 `nl -ba <file> | sed -n '起始,结束p'` 读取目标段落上下约 80-160 行。只有要全局重写该文件、确认全文结构未知且无法用 `rg` 定位时，才允许整文件读取，并先说明原因。
7. **`/clear` 或 compact 后不要重新整读同一个大文件**；先用 `git diff -- <file>`、`rg -n` 或 checkpoint 确认变化点。

---

## 2. 浏览器验证

**默认证据链**（按成本从低到高）：

1. **API/curl 数据检查**。
2. **`scripts/browser_smoke.py` 输出 JSON**：当前 URL、页面标题、按钮/tab/headings、console error、页面专属结构检查、可选截图文件路径。
3. **Playwright DOM 断言**：点击、URL 跳转、元素数量、文本变化。
4. **截图只作为产物保存路径**，不要 `Read /tmp/*.png`。
5. **只有用户要求视觉判断，或 DOM 断言无法说明布局/重叠/颜色问题时，才读取图片**；读取前先截 viewport 或具体元素，避免 full-page 大图。

---

## 3. Skill 使用

- Skill 是**能力入口，不是默认流程**。需要浏览器、测试、设计、PDF 等专门流程时可以用 skill，但**每个任务只调用一个最相关的 skill**。
- Nibi 本地页面 QA 优先使用 `scripts/browser_smoke.py`；脚本覆盖不了的真实交互，再调用 `webapp-testing` 或 `playwright`。
- **不要同时加载两个重叠 skill**。

---

## 4. Agent / subagent 使用

- **默认不要为小改动开 Agent**。优先主上下文用 `rg`、小片段读取、直接编辑、项目测试解决。
- 只有任务可并行拆分且返回结果会明显小于主上下文自己探索时，才开 Agent。

**开 Agent 时必须限制范围**：

- 只给一个明确问题、相关路径、输出上限
- 返回只要结论、`file:line` 证据、跑过的命令和下一步建议
- 不要让 Agent 返回完整文件、大段 diff、截图内容、全库扫描日志
- 一次默认最多 1 个 Agent；确实独立的调研最多 2 个

---

## 5. 计划与输出预算

- **简单任务不写长计划**；中等任务计划最多 5 条。
- **已写进 phase md / checklist 的计划，不要在回复里重复展开**。
- 工具输出只汇报**关键结论、文件路径、行号和测试结果**；不要粘完整 diff、完整 traceback、全量测试日志或 Agent 长报告。

---

## 6. `/clear` 接力

用户会经常 `/clear`。Claude Code 终端在长任务、跨文件实现、或用户准备 `/clear` 前，**维护本地 checkpoint**：`.claude/current-task.md`。这个文件**只放接力信息，不进 git**。

checkpoint 保持短小，只写：

- 当前目标和分支状态
- 已改文件
- 已跑命令/测试及结果
- 当前失败点或阻塞点
- 下一步 1-3 个动作

**`/clear` 后恢复上下文时**：

1. 先跑 git 状态检查
2. 再读 `CLAUDE.md` 和 `.claude/current-task.md`
3. **不要重新全量读取** `docs/AI_HANDOFF.md`、`docs/ROADMAP.md`、大 TSX 文件或源 PNG

---

## 7. 会话边界

**一个会话只做一个明确子任务**。完成子任务后先测试、总结、commit 或等用户确认，再开新会话继续下一项。

**不要把 L1/L2/L3、临时 debug、视觉 QA、文档同步连续塞进同一个上下文**。
