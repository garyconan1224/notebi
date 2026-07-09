---
phase: RP1-A 真实数据三迭 · mimo 启动提示词
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-A
prerequisite:
  - Opus 4.7 已修问题 2（后端 audio.url 用本地 /static URL，commit 待 user 提交）
  - 问题 3 字幕跟随自动跟着 2 修好
user_source: 2026-05-30 用户用真实 audio 任务复现的 5 个问题，问题 1 待澄清，问题 2/3 已修，问题 4/5 交 mimo
---

## mimo 启动提示词（直接复制到 ccswitch CC 终端，选 Sonnet 角色）

```
RP1-A 真实数据三迭：修两个前端问题（空 tab 隐藏 + 总结 500 友好报错）。

【前置事实】
- Opus 4.7 已修后端 audio.url（commit 待 user 提交）→ 问题 2/3 已解决
- 用户用真实 audio 任务（c3c63485-3ab5-479d-842b-524aa39824ba）跑出剩余两个问题

【问题 4：空 tab 应该隐藏】
frontend/src/pages/result/AudioResultPage.tsx 当前 line 443 附近有 6 个硬编码 tab：
  transcript / music / summary / vocal / music_transcribe / prompts
真实数据下大部分 tab 没数据但仍然显示，用户切过去全是空态文案，体验差。

要求：
1. 把 tab 数组改为 useMemo 按数据条件 filter，规则：
   - transcript: result.transcript_segments?.length > 0 → 显示（无数据时整页 fallback，不会到这里）
   - summary: 总是显示（用户可以新建总结）
   - music: result.music_segments?.length > 0 || result.music_mode === true → 显示
   - vocal: result.vocal_url || result.vocal_separation 等字段存在 → 显示
   - music_transcribe: result.music_transcription 字段存在且非空 → 显示
   - prompts: result.prompts 字段存在且非空 → 显示
2. activeTab 默认值 useState 改成"过滤后第一个 tab"（防止用户上次停在 music tab，但本次任务没音乐数据，应该 fallback 到 transcript）
3. 切到一个不存在的 tab（localStorage 残留）时也要 fallback 到 transcript

【问题 5：总结 500 友好报错】
当前 SummariesTab.tsx 调 createSummary → 后端返回 500 {"detail":"未配置 chat model"}，
前端只显示 "Request failed with status code 500"，用户不知道要去哪修。

要求：
1. 在 SummariesTab 的 createSummary catch 里：
   - 解析 axios error.response.data.detail
   - 如果 detail 包含"未配置 chat model" / "no chat model"：
     - 显示友好 toast：「请先在设置里配置对话用 LLM 模型，才能生成总结」
     - toast 加 action 按钮「去设置」→ navigate('/settings/models')
   - 其他 5xx → 「生成失败：${detail}」
   - 4xx → 「请求参数错误：${detail}」

【范围限制（不要做的）】
- 不要改后端
- 不要改 token / CSS
- 不要碰 LearningNotesPage / 视频复刻
- 不要新装依赖
- 不要留 debug 脚本（上次留了 4 个 debug_*.py，这次一定清理）

【验收】
- pnpm build EXIT=0
- 自己用 playwright 访问 http://localhost:5177/workspaces/c3c63485-3ab5-479d-842b-524aa39824ba/items/989c3520-5a52-467d-83af-4ccba1c56ceb/audio_detail
- 截 1 张图：tab 栏应该只剩 2-3 个有数据的 tab（不是 6 个）
- 点总结的「+ 新建」→ 选模板 → 生成 → 验证 toast 报"请去设置配 model"友好提示
- 截图保存到 docs/e2e-test/screenshots/rp1a-iter3-{tabs,summary-error}.png
- git commit 一个：fix(rp1-a): 真实数据三迭 — 空 tab 隐藏 + 总结 500 友好报错
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK.md 末尾追加一段
- 不要 push

预估工作量：1-2h
```

## 备注：问题 1（顶部字白色）

Opus 4.7 用 playwright 复现时 computed style 显示 nav 是白底深字 oklch(0.145 0 0)，**未能复现**用户截图所示的"黑色 header"。

待用户确认是否是浏览器主题/插件造成。若用户回截图说"我也看到一样的浅色"则关闭问题 1；若说"我还是看到黑色"，则要查 prefers-color-scheme 等 CSS media query 或浏览器 dark mode 影响。
