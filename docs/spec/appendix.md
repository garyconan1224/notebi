
## 附录 A：延后事项汇总（不要忘记）

合并 spec 落地过程中标注的"暂不做、未来补"：

| 延后项 | 所属模块 | 触发时机 |
|---|---|---|
| 视频运镜提示词（第 4 种提示词格式） | 4.2.4 | AI 导演模块开发时 |
| 联想方向支持自由文本 | 6.3 任务 4 | 用户使用一段时间后看是否需要 |
| PDF 内图片走图片分支分析 | 7.3 | Preflight 抽屉里加开关 |
| AI 导演整体（复刻清单 / 风格 DNA / A/B 对比 / 提示词版本 UI / 生成对比） | 8.1 | 当前阶段隐藏 / 灰显 |
| 接入生成模型 API（可灵 / 即梦 / MJ / Suno） | 8.1 | 远期目标 |

## 附录 B：被砍掉的内容（避免重复讨论）

| 砍掉项 | 原因 |
|---|---|
| 任务级 .zip 工作包导出（UI 入口） | 无强应用场景（模块 8.2）。**代码保留备用**，仅隐藏入口 |
| 侧边栏「工作台 / 处理中 / 结果 / 分镜 / 12 屏概览」5 个一级入口 | 与任务中心重复（模块 1.7） |
| 侧边栏独立「搜索」入口 | 改走 topbar（模块 1.7） |
| Taskboard 的「收藏夹 / 风格报告 / 对比 / 版本」4 个子标签 | 移到未来 AI 导演模块（模块 1.8） |
| Tesseract OCR | 中文一般，默认改 PaddleOCR（模块 6.3） |
| 拖拽排序优先级（队列管理） | 对新手价值不大（模块 2.7） |
| 重复的 PromptFormat / ScreenshotPage / TranscriberPage / ModelManagement 独立设置页 | 合并到「分析默认偏好」和「模型与渠道」（模块 3.5） |

---

## 完结

本文档 8 个模块全部完成。后续应进入"决策下一步"会话：
- 哪些模块**先补设计**（继续做页面规格）
- 哪些模块**直接进代码**（按本 spec 实现）
- 是否需要把现有 Phase 3C 之前的代码**保留 / 重构 / 推翻**

**生效后**：`docs/archive/spec-v2.md` 与 `system_design_v3_final.md` 在文件顶部加 deprecated 声明，指向本文档。

---

## 附录 C：下一会话执行清单（"现状同步"）

合并 spec 完成后，**真实工程状态与 spec 严重失配**。下一会话的唯一任务是把运维文档体系拉齐到合并 spec：

### C.1 必做项（按顺序）

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | **修改 CLAUDE.md** 优先级表 / 「项目执行计划维护流程」段落 | `CLAUDE.md` |
| 2 | **重写 `docs/EXECUTION_PLAN.md`**：保留 Phase 1-3C 已完成记录，废弃 3D-3E 的"风格报告 / 暗色模式"路线，新增 **N1~Nx「合并 spec 落地差异」phase 路线** | `docs/EXECUTION_PLAN.md` |
| 3 | **重写 `docs/AI_HANDOFF.md`**：清除 Phase 2B 旧入口，改成 N1 的开工交接 | `docs/AI_HANDOFF.md` |
| 4 | **更新 `docs/OUTSTANDING_TASKS.md`** | 同上 |
| 5 | **归档旧 phase plan**：`docs/plans/phase-3d~phase-10.md` 全部 frontmatter 加 `status: archived`，注明"被合并 spec 取代" | `docs/plans/*.md` |
| 6 | **加 deprecated 标记**：`docs/archive/spec-v2.md` / `system_design_v3_final.md` / `docs/archive/plan-v1.md` / `docs/archive/design-spec-v1.md` 顶部 | 4 个文件 |
| 7 | **处理设计稿快照**：`vidmirror/` 目录 commit 到 `docs/design-source/`（作为历史），`design_reference/` 删除（重复），`vidmirror.zip` / `vidmirror-handoff.zip` 加 `.gitignore` | 多处 |
| 8 | **删除 untracked 重复文件**：`system_design_for_claude_design_v1 (1).md`（与已 tracked 的 v1 重复） | 根目录 |
| 9 | **同步 origin/main**：把 local main 上的 52 个未推送 commit 推到 origin（修复 CI + 让 GitHub 状态反映现实） | git push |

### C.2 N1~Nx「合并 spec 落地差异」初步划分（供 C.1 第 2 步参考）

参考 phase 模板（最终在 EXECUTION_PLAN 里展开）：

| Phase | 范围 | 估时 | 优先级 |
|---|---|---|---|
| **N1** | 任务系统差异：trashed/analyzed 状态 / 软删除垃圾桶 / 删 project_id | 4-6h | P0 |
| **N2** | 侧边栏从 8 砍到 4 + Taskboard 子标签 5→4（隐藏「导出」入口） | 2-3h | P0 |
| **N3** | 设置页重组 9→7（合并 ScreenshotPage/TranscriberPage/PromptFormat → 分析默认偏好；ProvidersManagement+ModelManagement → 模型与渠道；新增任务垃圾桶） | 6-8h | P0 |
| **N4** | 添加素材模态升级（4 步合一 + 自动识别类型 + 智能默认勾选 + 背景信息折叠） | 4-5h | P1 |
| **N5** | Preflight 抽屉细化（按素材类型展开所有子参数） | 4-6h | P1 |
| **N6** | 任务级 LLM 对话上下文素材多选 chip + RAG 兜底 | 6-8h | P1 |
| **N7** | 视频分支补全：PySceneDetect AI 镜头分析 / 总结路径 1 & 3 / 视频运镜延后 | 8-10h | P2 |
| **N8** | 音频分支补全：VAD 双路 / pyannote 说话人 / 音乐分析 | 8-10h | P2 |
| **N9** | 图片分支补全：PaddleOCR / 4 联想方向 / 多图对比 | 6-8h | P2 |
| **N10** | 文字分支补全：marker/docling PDF / 改写翻译并排对照 / 多文对比 | 6-8h | P2 |
| **N11** | 砍掉的 UI 清理（仅入口隐藏，代码留备份） | 1-2h | P3 |
| → **AI 导演** | N1~N11 完成之后再启动 | — | 延后 |

具体子任务在进入对应 phase 时再展开（沿用 CLAUDE.md「项目执行计划维护流程」的 pending → ready → done 节奏）。
