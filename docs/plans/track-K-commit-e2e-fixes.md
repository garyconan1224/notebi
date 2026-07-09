# Track K · 收口 E2E 4 个未提交修复（mimo 执行卡 · Step 1/3）

> 给 mimo 的开工卡。Claude 桌面已对账完、确认每个改动完整可收口，读完直接照做。
> 状态：ready ｜ 性质：**只 commit 既有改动，不写新代码、不重构** ｜ 预计 <40min
>
> **这是「下一步」三步序列的第 1 步**：①收口修复（本卡）→ ②跑 E2E 全流程回归 → ③开非视频结果页。
> 后两步入口见本卡末尾「后续顺序」，**本会话只做 Step 1**，做完停下让用户 commit 节奏过目。

---

## 背景：为什么是「收口」而不是「开发」

上一轮 E2E 测试（B站①已真跑验证）测出 4 个 bug，**改好了但没 commit**，工作区现在是脏的。
脏树会让后面的 E2E 回归分不清「新现象 vs 这批改动的影响」，所以必须先把这 4 个修复**按粒度分开 commit** 干净，再往下走。

Claude 桌面已逐个核对：4 个修复都**完整自洽**（引用的函数/import 都在、测试断言已同步），不需要你再改代码逻辑，只需 **验证 + 分粒度提交**。

## 工作区现状（你接手时应一致，不一致就停下回报）

```
M backend/app/routes/workspaces.py            ← 修复② 静态URL编码
M backend/app/services/note_assembler.py      ← 修复① 时间戳格式
M backend/tests/test_note_assembler.py        ← 修复① 的测试
M frontend/.../NoteShell/MilkdownEditor.tsx   ← 修复③ 截图插入
M frontend/src/store/lnEditorStore.ts         ← 修复③ 截图插入
M frontend/.../NoteShell/FloatingAskAi.tsx    ← 修复④ 问AI钮位置
M CLAUDE.md AGENTS.md docs/AI_HANDOFF.md docs/EXECUTION_PLAN.md docs/rules/{README,model-strategy}.md  ← 治理文档
?? docs/rules/agent-roles.md                  ← 三角色协作新规
?? docs/plans/track-K-{md-timestamp-jump,e2e-fullflow-test,e2e-douyin-run}.md  ← 计划卡
?? docs/plans/track-K-commit-e2e-fixes.md     ← 本卡
?? docs/test-reports/e2e-2026-06-12.md        ← E2E 复核报告（留档）
?? frontend/test-results/                     ← playwright 截图产物（不入库）
```

---

## 🔴 红线（违反任何一条立即停下）

- **禁止 `git add -A` / `git add .` / `git commit -a`**。每个 commit **只显式 `git add` 指定文件**，否则会把 6 个修复揉成一坨，破坏 git 粒度。
- **不改任何代码逻辑**。本卡只做「验证 + 提交」。若你觉得某处该改，记下来回报，**不要顺手动**。
- **不提交 `frontend/test-results/`**（playwright 截图产物）——它走 gitignore（commit E）。
- **一次只做一步、按顺序 A→F**，每步验证过了再 commit；某步验证失败就停下回报，不要硬提交。
- 当前分支应是 `main`，先 `git status --short --branch` 确认。

---

## 执行步骤（A→F 顺序，逐步 commit）

> 每步只列「加哪些文件 + 验证命令 + commit 信息」。验证不过就停。

### A. 后端修复①：转写正文时间戳格式 [Xs]→[mm:ss]

`note_assembler.py` 把转写正文里 `**[123.45s]**` 改成 `**[02:03]**`（复用已有 `_fmt_ts_short`），测试断言同步成 `[00:00]`。

```bash
cd /Users/conan/Desktop/nibi
# 验证（桌面已跑过 = 27 passed，你复核一遍）
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest backend/tests/test_note_assembler.py -q
# 绿了再提交
git add backend/app/services/note_assembler.py backend/tests/test_note_assembler.py
git commit -m "fix(k-note): 转写正文时间戳 [Xs]→[mm:ss]，与笔记时间码一致"
```

### A.5（计划外·必做）修 a4b8359 漏改的测试断言

跑全量 pytest 会撞到一个**与本次无关、但 main 自带**的失败：
`test_summary_templates.py::test_unknown_id_fallback_concise`，断言 `tpl.label == "简洁摘要"`，
但 `summary_templates.py:22` 的 concise label 在 `a4b8359`（已合入 main）里已改成「精简摘要」，
**测试断言漏改了**。它会绊住 Step B 及后续所有全量验证，先一行修掉，让验证流程干净。

- **只改 `backend/tests/services/test_summary_templates.py` 第 26 行**：`"简洁摘要"` → `"精简摘要"`。
- 🔴 **别动产品代码**：`summary_templates.py` 的 label 保持「精简摘要」（那是 a4b8359 故意改的，对齐测试而非改代码）。
- 🔴 **别动 `test_note_assembler.py` 里的「简洁摘要」字样**（那是 fixture 标题文本，与 label 无关，误改会引入新失败）。

```bash
cd /Users/conan/Desktop/nibi
# 改完后跑全量，应从 1 failed 变全绿
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest backend/tests -q
git add backend/tests/services/test_summary_templates.py
git commit -m "fix(k-summary): 对齐 concise label 测试断言「简洁摘要」→「精简摘要」(补 a4b8359 漏改)"
```

### B. 后端修复②：静态资源 URL quote 编码

`workspaces.py` 两处 `to_static_url` / `_convert_absolute_to_static_url` 给路径加 `quote()`，修文件名含 `#`/空格（抖音、小红书标题常带 hashtag）时浏览器把 `#` 当 fragment 截断 → static 404。`quote` 已在第 35 行 import。

```bash
# 跑后端全量，确认没破其它（静态URL被很多路径用到）
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest backend/tests -q
git add backend/app/routes/workspaces.py
git commit -m "fix(k-static): 静态URL quote 编码，修文件名含#/空格(抖音小红书hashtag标题)致 static 404"
```

### C. 前端修复③：截图插入在所见即所得(Milkdown)模式可用

`MilkdownEditor.tsx` 向 `lnEditorStore` 注册 `insertFn`：识别 `![alt](url)` 插成真正的 ProseMirror image 节点，否则插文本；`lnEditorStore.ts` 的 `insertAtCursor` 改为优先走 `insertFn`，降级回 CodeMirror。之前截图按钮只在源码模式生效，Milkdown 设为默认后就失灵了，这步修好。

```bash
cd /Users/conan/Desktop/nibi/frontend
npm run build      # tsc + vite，必须无类型错误
cd /Users/conan/Desktop/nibi
git add frontend/src/pages/result/NoteShell/MilkdownEditor.tsx frontend/src/store/lnEditorStore.ts
git commit -m "fix(k-milkdown): 截图插入在所见即所得模式可用（注册insertFn，![](url)插为image节点）"
```

### D. 前端修复④：问 AI 浮钮位置避让

`FloatingAskAi.tsx` 触发钮和面板 `bottom: 24 → 80`，避让底部其它控件。纯样式，C 步 build 已覆盖编译，无需重跑（想保险可再 `npm run build`）。

```bash
git add frontend/src/pages/result/NoteShell/FloatingAskAi.tsx
git commit -m "fix(k-ui): 问AI浮钮 bottom 24→80 避让底部控件"
```

### E. chore：gitignore playwright 截图产物

`frontend/test-results/` 是 playwright 跑出来的截图 + `.last-run.json`，不该入库。

- 先看 `frontend/.gitignore` 有没有 `test-results`，**没有就追加一行 `test-results/`**（有就跳过改文件）。

```bash
git add frontend/.gitignore
git commit -m "chore(k-e2e): gitignore frontend/test-results（playwright 截图产物不入库）"
```

### F. docs：归档计划卡 + E2E 报告 + 三角色治理

把已完成/待跑的计划卡、E2E 复核报告、治理文档一起落定。**注意 `track-K-md-timestamp-jump.md` 对应的代码已经是 main 上的 `cfadee7`，这里只是补归档卡片。**

```bash
git add docs/plans/track-K-md-timestamp-jump.md docs/plans/track-K-e2e-fullflow-test.md \
        docs/plans/track-K-e2e-douyin-run.md docs/plans/track-K-commit-e2e-fixes.md \
        docs/test-reports/e2e-2026-06-12.md \
        docs/rules/agent-roles.md docs/rules/README.md docs/rules/model-strategy.md \
        CLAUDE.md AGENTS.md docs/AI_HANDOFF.md docs/EXECUTION_PLAN.md
git commit -m "docs(k): 归档 track-K 计划卡+E2E复核报告，落定三角色协作治理"
```

> 若用户还想继续改治理文档（CLAUDE.md / AGENTS.md / AI_HANDOFF.md / EXECUTION_PLAN.md / rules），**F 步先别提交那几个文档**，只 commit 计划卡 + E2E 报告 + agent-roles.md，剩下的留给用户自己 commit。开工前跟用户确认一句。

---

## 验证（提交前每步已验，最后总检一遍）

```bash
cd /Users/conan/Desktop/nibi
git status --short          # 应该干净（除非 F 步按上面注释留了治理文档）
git log --oneline -8        # 确认 6 个 commit 顺序、信息正确
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest backend/tests -q   # 后端全绿
cd frontend && npm run build                                  # 前端编译通过
```

## 完成后回报

1. `git log --oneline -8` 的输出（确认 6 个 commit 粒度对）；
2. 后端 pytest 总数 + 前端 build 结果；
3. `git status --short` 是否干净（若留了治理文档，说明留了哪几个、为什么）；
4. 过程中有没有发现任何「改动看起来不对/不完整」的地方（只回报、别动手）。

---

## 后续顺序（本会话不做，给用户和下一会话看）

- **Step 2 — E2E 全流程回归**：卡已写好 → [`track-K-e2e-fullflow-test.md`](track-K-e2e-fullflow-test.md)（多平台）/ [`track-K-e2e-douyin-run.md`](track-K-e2e-douyin-run.md)（先验抖音一个平台）。**只测不改**，必须用 `.claude/skills/e2e-fullflow-test` skill 强约束，禁止猜 API / 编数据。Step 1 commit 干净后才能开，否则测不清是不是这批改动的影响。
- **Step 3 — 补非视频结果页（音频/图片/文本）**：AI_HANDOFF #1 方向，范围大、需先调查三页现状再拆最小子任务。**等 Claude 桌面出调查 + 拆卡**，不要 mimo 自己放养开。
