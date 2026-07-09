---
phase: RP1-B+ · 学习笔记页修复（数据源/视频/md-html-pdf/toggle 规则）
status: done
owner: xiaomi-mimo-2.5pro
parent: docs/plans/rp1b-data-reconnect-mimo-prompt.md（本计划修正其阶段1+2 接错的数据源）
estimated_hours: 5-7
deps_redline: false
note: 基于 2026-05-31 用户实测反馈。修正三处偏差：阶段1+2 数据源 / 方案B toggle / B-3 双向同步。
decisions:
  - 学习总结数据源 = result.summary（item.results.summary），**不是图文分镜.md**（后者是复刻向逐帧提示词）。
  - md 是唯一编辑源；HTML 是 md 的「模板美化只读预览」（单向 md→html），不再双向 contentEditable（简化 B-3）。
  - 导出 PDF = HTML 美化预览打印（window.print / react-to-print），不走结构化 parser。
  - toggle 默认去掉；仅当"添加素材时同时选了学习+复刻"才显示（判断方式 mimo 任务0 确认）。
---

## 0. 诊断（mimo 必读 · 为什么改）

2026-05-31 用户实测 learning 视频的 /ln，发现 3 个问题，根因是数据源又接错：

| 现象 | 根因 | 修复 |
|---|---|---|
| /ln 笔记是「逐帧画面提示词」(### [00:01:17] 描述/Core Visual Content/Camera Lens) | 阶段1+2 让 /ln 读了**图文分镜.md（复刻向）** | 改读 **result.summary**（真学习总结，已是 md） |
| /ln「暂无可用视频源」 | videoSrc 取自 getWorkspace 的 item.results.video.url（**没经阶段2 /static 适配**） | 改用 **getItemResult 的 video.url**（已适配 /static，curl 确认可播） |
| HTML 视图空 / 双向同步多余 | B-3 做了 contentEditable+turndown 双向，但用户要「md 源 → html 美化预览 → pdf」单向 | HTML 改**只读模板美化渲染**，md 为唯一编辑源 |

**已确认的事实**（curl 实测）：
- `result.summary` 内容 = "### 视频综合总结：GameCheats Manager… #### 核心功能与亮点…"，**本身就是 markdown**。
- 图文分镜.md = "# 视频拆解… ## 全局视觉总结… 中景平视镜头…" = 复刻向，不该进学习笔记。
- getItemResult 的 video.url = `/static/workspaces/default_project/videos/…mp4`（阶段2 适配过，能播）。

## 1. 修复方案（6 项）

1. **后端 GET /ln 数据源**：`ln.md`(编辑层) → **video item.results.summary**(学习总结 md) → 404。**删掉读图文分镜.md 那一路**（那是复刻向）。
2. **前端视频源**：LearningNotesPage 已调 getItemResult（取 transcript），顺手从它的返回取 `video.url` 作 videoSrc，**别再用 getWorkspace 的 item.results.video.url**。
3. **默认 MD 视图**：`view` 初值改 `'md'`（localStorage 无值时）。
4. **HTML = 单向美化预览**：HtmlView 去掉 contentEditable / turndown / onBlur 回写，改成纯 react-markdown **只读渲染 + 模板美化样式**（标题/章节/封面/排版好看）。md 编辑（MdView/CodeMirror）→ html 实时重渲染。
5. **导出 PDF**：基于 HTML 美化预览 `window.print()`（配 @media print 只留笔记正文 + 美化样式）。这就是用户要的「编辑 md → html 自动生成 → 导出 pdf」。
6. **toggle 规则**：去掉 /ln 和 video_detail 顶栏的 [学习笔记|复刻] toggle；**仅当该 item「同时选了学习+复刻」时才显示**（判断方式见任务 0）。

## 2. mimo 启动提示词（直接复制）

```
RP1-B+ 学习笔记页修复：数据源(summary)/视频源/默认md/html美化预览/导出pdf/toggle规则。
背景必读: docs/plans/rp1b-learning-notes-fix-mimo-prompt.md §0 诊断
实测 ws: 484d8bb6-7424-4ba9-9e2a-7889e04df667 / item 1fcfdb4b-9cee-46b1-823c-5631953dcdee
  （intent=learning，result.summary 是现成 md 学习总结，video.url 经 getItemResult 已是 /static）

【任务 0: 确认"是否同时选了学习+复刻"怎么判断】
  curl 看 item.preflight：rg/看 intent 是单值('learning'/'replica') 还是能表达"both"；
  或看 preflight.tasks 组合（av_synthesis=学习总结 + visual_prompt/frame_prompt=复刻）。
  结论决定 toggle 显示条件：两者都选 → 显示 toggle；否则不显示。

【任务 1: 后端 GET /ln 数据源改（export.py get_ln_markdown）】
  三级降级改为：
    1) {ws}/ln.md 存在 → 用它（用户编辑层）
    2) 否则 → 取 video item.results 的 summary 字段（_store.get→video item→results['summary']），它已是 md
    3) 都没有 → 404
  **删掉阶段1+2 加的"读图文分镜.md"那一路**（复刻向，不是学习总结）。
  pytest 更新：之前 test_ln_get_fallback 的图文分镜兜底用例改成 summary 兜底。

【任务 2: 前端视频源修（LearningNotesPage index.tsx）】
  load() 里已 await getItemResult 取 transcript；同时取它的 video.url 存进 pageState，
  videoSrc 用这个（已 /static 适配）。删掉/弃用从 getWorkspace item.results.video.url 取的旧逻辑。

【任务 3: 默认 MD 视图】
  view 初值：localStorage('ln-view') 无值时默认 'md'（不是 'html'）。

【任务 4: HTML 改单向美化预览（HtmlView.tsx）】
  - 去掉 contentEditable + turndown + onBlur→onMarkdownChange（不再 html→md 回写）。
  - 改成纯 react-markdown 只读渲染 + 模板美化 CSS：封面/H1/H2 章节分隔/引用/列表/代码块/图片，
    参考设计稿或 av_synthesis 的 html 模板风格，做成「好看的图文笔记」。
  - md 编辑只在 MdView(CodeMirror)；切到 HTML 实时按最新 md 渲染。
  - turndown/DOMPurify 若不再被引用，可从 import 清理（不强制）。

【任务 5: 导出 PDF（顶栏导出）】
  - 「导出」改为：PDF = 对 HTML 美化预览 window.print()（加 @media print：隐藏 nav/视频/字幕轨/toolbar，只留 .ln-html-view 美化正文）。
  - 之前 B-7 的后端多格式导出菜单（调 /notes/export 读 av_synthesis.md）先去掉/隐藏，
    避免点了导错；后端多格式留到以后真正需要再做。

【任务 6: toggle 按任务0 结论收口】
  - 默认去掉 /ln + video_detail 顶栏的 [学习笔记|复刻] toggle。
  - 仅当 item「学习+复刻都选」时显示 toggle（条件用任务0 的判断）。

【范围】
- 不动复刻页 video_detail 的复刻布局内部（帧/提示词/版本栈）。
- 不做 pipeline 路径治本迁移（那是单独的阶段4）。
- 不装新依赖（pdf 用浏览器 print；react-to-print 可选，能不加就不加）。
- 不留 debug 脚本。

【验证】
- pytest（GET /ln 返回 summary；无 summary 才 404）→ 自己跑过
- pnpm build + tsc EXIT=0
- 手测（实测 ws 484d8bb6…）：
  * /ln 笔记显示「视频综合总结：GameCheats Manager…」（学习总结），不再是逐帧提示词
  * /ln 左侧视频能播（不再"暂无可用视频源"）
  * 默认进 MD 视图；切 HTML 是美化的图文预览；改 md → html 跟着变
  * 导出 → 打印预览只含美化笔记正文
  * 纯 learning 视频无 toggle；纯 replica 无 toggle；都选才有
- playwright 归档 3 张: docs/e2e-test/screenshots/rp1b-lnfix-{summary,md,html-print}.png
- git commit: fix(rp1-b+): 学习笔记接 summary + 视频源修 + md源/html美化预览/pdf + toggle规则
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN；不 push
```

## 3. 技术参考

```bash
# 学习总结在 item.results.summary（已是 md）
curl -s "http://localhost:8000/workspaces/{ws}/items/{item}/result" | python3 -c "import sys,json;print(json.load(sys.stdin).get('summary','')[:200])"
# GET /ln 现状（阶段1+2 加的图文分镜兜底，要改成 summary）
sed -n '573,600p' backend/app/routes/export.py
# LearningNotesPage 视频源 + getItemResult 调用
rg -n "videoSrc|getItemResult|video.url|results.video" frontend/src/pages/results/LearningNotesPage/index.tsx
# HtmlView 现在的双向逻辑（要改单向）
rg -n "contentEditable|turndown|onBlur|DOMPurify" frontend/src/pages/results/LearningNotesPage/HtmlView.tsx
```

## 4. 验收清单

- [ ] 任务0 确认"学习+复刻都选"的判断方式
- [ ] GET /ln 读 summary（删图文分镜兜底）+ pytest 更新
- [ ] /ln 视频源用 getItemResult video.url（能播）
- [ ] 默认 MD 视图
- [ ] HtmlView 单向美化只读渲染（去双向 turndown）
- [ ] 导出 PDF = html 美化 print
- [ ] toggle 仅"都选"时显示
- [ ] 实测：summary 学习总结 / 视频能播 / md源html预览 / pdf / toggle 规则
- [ ] pnpm build + tsc + pytest EXIT=0；不 push
```
