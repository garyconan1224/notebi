# Nibi 项目工作流（Master Workflow）

> **本文档作用**：任何 AI 工具（Claude / Codex / Cursor / 小米 等）开新会话，**先读本文件**就能知道：
> - 项目当前阶段 / 下一步该做什么
> - 设计 vs 代码 的工作顺序
> - 哪份 spec 是真相源
> - 怎么对账避免重做
>
> Last updated: 2026-05-23

---

## 1. 唯一真相源（Single Source of Truth）

冲突仲裁顺序（自上而下）：

| 序 | 文件 | 角色 |
|---|---|---|
| **1** | [`docs/SPEC.md`](SPEC.md) + [`docs/spec/`](spec/) | **产品需求规范**（8 模块 + 附录 C 执行路线），所有产品决议以此为准 |
| **2** | [`docs/EXECUTION_PLAN.md`](EXECUTION_PLAN.md) | **工程执行计划**（Phase 打勾 + 当前在哪一步） |
| **3** | [`docs/DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) + [`frontend/src/styles/nibi-tokens.css`](../frontend/src/styles/nibi-tokens.css) | **Nibi 当前 UI 真相源**；`docs/design/` 仅作为旧设计快照参考 |
| **4** | 当前工作目录代码 | 实际实现，与 spec 偏差时**优先反映到 spec 或新建差异 phase**，不静默修改代码 |
| ~~5~~ | ~~`docs/archive/spec-v2.md`~~ | ⚠️ DEPRECATED，仅历史归档 |
| ~~6~~ | ~~`docs/archive/system_design_v3_final.md`~~ | ⚠️ DEPRECATED |
| ~~7~~ | ~~`docs/archive/plan-v1.md` / `docs/archive/design-spec-v1.md`~~ | ⚠️ DEPRECATED |

流程图需求的低 token 入口是 [`docs/flows/README.md`](flows/README.md)。Claude Code 终端先读 `docs/flows/*.md`，只有需要核对视觉布局或文本镜像过期时才读取 `docs/conversation-inputs/2026-05-18-spec-merge/*.png`。

---

## 2. 整体工作流（从现在到开源 / v1 发布）

> ⚠️ **2026-06-05 注记**：当前实际入口/主线以 [`docs/PROJECT_STATUS.md`](PROJECT_STATUS.md) + Track K 笔记页报告 [`docs/plans/track-K-M7-result-pages-redesign.md`](plans/track-K-M7-result-pages-redesign.md) 为准；下方「N11 后决策点 / flows」是产品完整能力（含复刻/工具），**不等于当前在做的「单素材笔记页」边界**。

合并 spec 已落地，现状同步与 N1~N11 差异补齐已完成。项目现在处于 **N11 后决策点**。产品完整流程图的文本镜像见 [`docs/flows/overview.md`](flows/overview.md)。工程阶段总图：

```
[A] 现状同步                          ✅ 已完成
    ↓
[B] N1~N11 落地差异（按 spec 附录 C 路线） ✅ 已完成
    ├─ N1-N3: 工程基建（任务系统差异 / 导航精简 / 设置页重组）
    ├─ N4-N6: 核心交互（添加素材模态 / Preflight 抽屉 / 任务级 LLM 对话）
    └─ N7-N11: 四大分支补齐（视频 / 音频 / 图片 / 文字 / UI 清理）
    ↓
当前决策点                          ← 你现在在这里
    ├─ .git 历史瘦身（需用户明确授权）
    ├─ N1b 磁盘布局迁移 / N7b+N8b 后端实现（UI 已就绪）
    ├─ [C] AI 导演模块
    └─ [D] 安全 + 开源准备
    ↓
[C] AI 导演模块（复刻功能）
    ├─ 收藏帧 + 提示词版本 UI
    ├─ A/B 对比
    ├─ 风格 DNA 报告
    └─ 生成模型 API 接入（可灵 / 即梦 / MJ / Suno）
    ↓
[D] 安全 + 开源准备（v1.0.0 发布）
```

---

## 3. 每个 Phase 的"设计 vs 代码"决策

**默认原则**：合并 spec 已经把产品需求写到"产品需求级粒度"（描述要做什么、各页面长什么样、交互怎么走），**大部分 phase 不需要再做设计**，直接写代码即可。

仅以下情况需要"先改设计"：
- spec 里有 ⏳ 标的"延后事项"重新启动时（需要补充交互细节）
- 用户在使用中发现 spec 描述跟实际需要不符时（先改 spec → 再改设计稿 → 再写代码）
- 进入 AI 导演阶段时（复刻功能 UI 细节当前不够）

### 各 phase 工作内容速查（含开工参数）

> **规则来源**：CLAUDE.md §「模型选择策略」+ §「Git 行为」第 4 条 + §「Push 策略」。
> Push 全部暂缓到 [D] 阶段，下表不再重复标注。

| Phase | 性质 | 设计先改？ | **模型** | **分支** |
|---|---|---|---|---|
| **[A] 现状同步** | 纯文档 | ❌ | 小米 2.5 Pro / Sonnet | main 直接做 |
| **N1 任务系统差异** | 代码 + schema 迁移 | ❌ | ⭐ **Opus 4.7** | **新 worktree** `feat/phase-n1-task-system` |
| **N2 导航精简** | 代码 + 微调设计 | ⚠️ 删 design/ 被砍组件 | Sonnet 4.6 / 小米 | `feat/phase-n2-nav-cleanup` |
| **N3 设置页重组** | 代码（多文件 CRUD） | ❌ | Sonnet 4.6 | `feat/phase-n3-settings` |
| **N4 添加素材模态** | 代码 | ❌（design 已有） | Sonnet 4.6 | `feat/phase-n4-add-material` |
| **N5 Preflight 抽屉** | 代码 + 子参数细化 | ❌ | ⭐ **Opus 4.7**（跨多素材类型） | **新 worktree** `feat/phase-n5-preflight` |
| **N6 任务级 LLM 对话** | 代码 + RAG + **要补设计** | ⚠️ task_chat.jsx 缺多选 chip | ⭐ **Opus 4.7**（RAG / 上下文） | **新 worktree** `feat/phase-n6-task-chat` |
| **N7 视频分支补齐** | 代码（PySceneDetect + 3 路径） | ❌ | ⭐ **Opus 4.7** | **新 worktree** `feat/phase-n7-video` |
| **N8 音频分支补齐** | 代码（VAD + pyannote） | ❌ | ⭐ **Opus 4.7** | **新 worktree** `feat/phase-n8-audio` |
| **N9 图片分支补齐** | 代码（PaddleOCR + 多图对比） | ❌ | Sonnet 4.6 | `feat/phase-n9-image` |
| **N10 文字分支补齐** | 代码（marker/docling + 多文对比） | ❌ | Sonnet 4.6 | `feat/phase-n10-text` |
| **N11 UI 清理** | 代码（隐藏砍掉的入口） | ❌ | 小米 2.5 Pro | main 直接做 |
| **[C] AI 导演** | **大量先改设计** + 代码 | ✅ 补完整 director 设计 | Opus 4.7 全程 | 多个 worktree（按子模块） |
| **[D] 开源** | 代码 + 文档 | ❌ | Sonnet / 小米 | main + 各 feature 分支 |

**决策规则速查**（复杂度判定）：
- 跨 5+ 文件 / schema 迁移 / 加密 / SSE / 状态机 / RAG → **Opus + worktree**
- 3-5 文件 CRUD / 前端组件 → **Sonnet + 单分支**
- 纯文档 / git / 测试 → **小米 + main 直接做**

---

## 4. 已完成的 [A] 现状同步

**已经做了**：
- [x] 1. 合并 spec md 写完（[`docs/SPEC.md`](SPEC.md)）
- [x] 2. 设计稿统一搬到 [`docs/design/`](design/)（旧 `design_reference/` 已删）
- [x] 3. v3 文档归档到 [`docs/archive/`](archive/)
- [x] 4. 旧 spec 顶部加 DEPRECATED 标记（nibi-spec-v2 / plan / v1 设计文档）
- [x] 5. .gitignore 加 `*.zip` / `.DS_Store`
- [x] 6. 写本工作流文档 `docs/WORKFLOW.md`
- [x] 7. 更新 `CLAUDE.md` 优先级段落
- [x] 8. 更新 `AGENTS.md` 同步
- [x] 9. 重写 [`docs/EXECUTION_PLAN.md`](EXECUTION_PLAN.md)：抛弃旧 Phase 3D-3E 路线，替换为 N1~N11 路线（路线初稿见 `docs/SPEC.md` 附录 C.2）
- [x] 10. 重写 [`docs/AI_HANDOFF.md`](AI_HANDOFF.md)：清除 Phase 2B 旧入口，改 N1 开工交接（参考本文档 §4 模板）
- [x] 11. 旧 `docs/plans/phase-3d~phase-10.md` 共 9 份，全部 frontmatter 加 `status: archived` + 顶部注明"被合并 spec 取代"

> ~~12. push 到 origin~~ **取消**：按新 push 策略，暂缓所有 push 到 [D] 开源准备阶段。当前 local main 允许领先 origin，本地状态以启动检查为准。

**N1~N11 主线也已完成**。当前下一步不再从本节继续，而是按 `docs/EXECUTION_PLAN.md` 的「当前下一步」在 `.git` 清理、拆出子阶段、`[C]`、`[D]` 之间做选择。

---

## 5. 新会话开始的标准检查（铁律）

任何 AI 工具开新会话**第一件事**：

```bash
# 1. 看分支和工作区状态
git status --short --branch
git log --oneline -5

# 2. 读真相源（按本文档第 1 节顺序）
# 不要先读 docs/archive/spec-v2.md / plan.md / system_design_*.md，这些都 DEPRECATED
```

然后：
1. 读本文档（WORKFLOW.md），知道总流程在哪
2. 读 `docs/EXECUTION_PLAN.md`，找第一个未打勾的子任务
3. 读 `docs/SPEC.md` 索引，再读 `docs/spec/` 对应模块，理解产品需求
4. 读 `docs/design/components/<对应组件>.jsx`，理解视觉与交互
5. 才能动手写代码

---

## 6. 模型选择速查（沿用 CLAUDE.md）

| 任务类型 | 推荐 |
|---|---|
| 跨 5+ 文件 / 加密 / SSE / 状态机 | Opus 4.7（桌面）/ 新 worktree |
| 3-5 文件 CRUD / 前端组件 | Sonnet 4.6（桌面） |
| git / 测试 / 文档 / 模板代码 | 小米 2.5 Pro（终端，免费优先） |
| 单行 / typo | Haiku 4.5 / 小米 |

---

## 7. Git 与分支规则（沿用 CLAUDE.md）

- 不在 main 直接改代码（feature 分支 → 本地 merge → 不走 PR）
- 一个子任务一个 commit
- 不主动 push --force / git reset --hard
- 完成阶段才打 tag（仅 v1.0.0-mvp 等里程碑）

### ⚠️ Push 暂缓（2026-05-18 起）

**所有 `git push origin` 操作暂缓**，直到 [D] 开源准备阶段才统一推送。详见 `CLAUDE.md` §「Push 策略」。

- 所有 commit 留在 local main / 本地 feature 分支
- feature 分支完成后**本地 merge 进 local main**（不走 PR、不 push 到 GitHub）
- local main 会越来越领先 origin/main，这是预期状态
- 已存在的远端 PR #1（docs/spec-merged 分支）放着，由用户决定关闭或留着

---

## 8. 修改本工作流文档的规则

- 改动需 commit 时附带原因（"因为 XXX，调整流程"）
- 任何 phase 路线大改（如砍掉 AI 导演 / 加新 phase）都要同步改本文档与 `docs/SPEC.md` 附录 C
- 本文档与 `CLAUDE.md` / `AGENTS.md` 三者**互相引用**，改一个必须考虑另外两个
