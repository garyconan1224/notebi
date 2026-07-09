---
phase: RP1-B+ · 学习笔记页主体重排 + 导出扩展（MD / Obsidian）
status: in_progress
owner: opus（规划 + 阶段①执行）/ xiaomi-mimo-2.5pro（阶段②③执行）
parent: docs/plans/rp1b-learning-notes-fix-mimo-prompt.md
estimated_hours: 6-9
deps_redline: 阶段③写用户本地文件系统（Obsidian vault），路径配置首次需用户手填、需用户机器验证。
note: 基于 2026-05-31 用户决策——学习笔记页主体应是笔记（占大），与视频调换位置；导出要 MD + Obsidian（zip 包与直写库两种都要）。
decisions:
  - 布局：笔记移到左侧约 62% 当主体；视频+字幕缩到右侧约 38%（DOM 顺序对调 + css 宽度）。
  - 默认视图：html 美化阅读（非 md 源码）；标签带功能提示「阅读·看效果」「Markdown·可编辑」。
  - 字幕区：去掉固定 max-height:300px → flex:1 min-height:0 自适应填满视频下方。
  - 导出菜单：单按钮「导出 PDF」→ 下拉四项：PDF(现有 window.print) / Markdown(.md 下载) / Obsidian 包(zip) / 写入 Obsidian 库。
  - Obsidian「两种都要」：① 导出 zip 自包含包（md 改 ![[ ]] + frontmatter + attachments）；② 直接写入用户配置的 vault 路径。
---

## 0. 背景 + 现状对账（mimo 必读 · 为什么这么改）

2026-05-31 用户实测学习笔记页（上一轮 [rp1b-learning-notes-fix](rp1b-learning-notes-fix-mimo-prompt.md) 修复后），提出：
> 「学习笔记页的主体应该是笔记，他应该占的位置大，跟视频播放页面调换一下」+ 导出要 MD / 传 Obsidian。

**现状关键事实（已 curl / 读码确认，mimo 不要再猜）：**

| 项 | 事实 |
|---|---|
| 笔记 md 来源 | `GET /workspaces/{ws}/ln`（在 `backend/app/routes/export.py`）：`ln.md`(用户编辑层) 优先 → 降级 `item.results.summary`。前端 state `markdown` 即是。 |
| 截图存储 | `POST /{ws}/ln/screenshots` 存 `data/workspaces/{ws}/ln-screenshots/shot-*.png`；md 内引用为 `![截图@ts](/static/workspaces/{ws}/ln-screenshots/xxx.png)` |
| 已有 zip 导出 | `export.py` 的 `export_workspace_item`（`GET /items/{id}/export`）已用 `zipfile`+`StreamingResponse` 打包 md/json/README——**阶段② Obsidian zip 复用此模式** |
| 配置存储参照 | `backend/app/routes/download_config.py`——**阶段③ vault 路径配置照它做**（先 rg 读它怎么存/读） |
| 前端菜单组件 | 无现成下拉组件，需自建（css `.ln-export-menu` 目前仅是 `@media print` 隐藏钩子） |

## 1. 阶段① 布局/视图微调（前端 · ✅ DONE 2026-05-31）

文件：`index.tsx` / `LNNotesPanel.tsx` / `learning-notes.css`

- 笔记面板 `<LNNotesPanel>` DOM 移到 `.ln-body` 最前（→ 显示在左）；`.ln-notes-panel` width 62%、`.ln-left-col` width 38% + flex-shrink:0、`.ln-video-panel` width 100%（填满右栏）。
- 默认 `view` 初值改 `'html'`（localStorage 无值时）。
- 标签改两行：`阅读 / 看效果`、`Markdown / 可编辑`（`.ln-tab-sub` 小字；toolbar button 改 flex column）。
- `.ln-transcript-panel` 去 `max-height:300px` → `flex:1; min-height:0`（自适应填满视频下方）。

验证：`tsc --noEmit` EXIT=0 + `npm run build` OK。UI 视觉由用户确认。

## 2. 阶段② 导出 MD + Obsidian 包（前后端，自包含·安全）

把单个「导出 PDF」按钮升级为下拉菜单，新增「导出 Markdown」（纯前端 .md 下载）和「Obsidian 包」（后端打 zip：md 图片改写为 `![[attachments/..]]` + frontmatter + attachments 截图夹，复用现有 zip 基础设施）。

### mimo 启动提示词（直接复制）

```
RP1-B+ 学习笔记导出扩展 · 阶段②：导出菜单 + 导出 Markdown + Obsidian 包(zip)。
背景必读: docs/plans/rp1b-ln-layout-export-mimo-prompt.md §0 现状对账
前置: 阶段① 已完成（布局/默认视图/标签/字幕）。本阶段只加导出，不动布局。

【任务 2.1 前端·导出按钮改下拉菜单】
  文件: frontend/src/pages/results/LearningNotesPage/index.tsx（现有"导出 PDF"按钮约 138-146 行）
  - 改成「导出 ▾」按钮，点击展开菜单(绝对定位 div，类名 .ln-export-menu)，四项：
      导出 PDF        → 现有 window.print()
      导出 Markdown   → 任务 2.2
      Obsidian 包     → 任务 2.3（下载 zip）
      写入 Obsidian 库 → 本阶段先占位/禁用并标「阶段③启用」
  - 无现成菜单组件，自建：按钮 + 菜单 div + 点击外部关闭(useEffect 监听 document click)。
  - .ln-export-menu 样式在 learning-notes.css 新增（参考 .ln-shot-btn 与现有 token；@media print 已隐藏它）。

【任务 2.2 前端·导出 Markdown】
  - 把当前 markdown(state) 生成 Blob({type:'text/markdown'}) 触发下载。
  - 文件名: `${pageState.videoItem.name || '学习笔记'}.md`（先去掉 / \ : * ? " < > | 等非法字符）。
  - 纯前端，不调后端。

【任务 2.3 后端·Obsidian zip 导出】
  文件: backend/app/routes/export.py
  - 新增 GET /workspaces/{workspace_id}/ln/export?format=obsidian
  - 取 md: 复用本文件 GET /ln 的取值逻辑（ln.md 优先 → 降级 item.results.summary）。
  - 改写图片: 正则把 ![alt](/static/workspaces/{ws}/ln-screenshots/FILE.png)
      → ![[attachments/FILE.png]]   (Obsidian 嵌入语法)
  - 加 frontmatter（放 md 开头）:
      ---
      title: {视频/笔记标题}
      source: {原视频 url 或 workspace id}
      created: {YYYY-MM-DD}
      tags: [学习笔记, nibi]
      ---
  - zip 打包(复用 export_workspace_item 的 zipfile + StreamingResponse 模式):
      {标题}.md  +  attachments/{md 里被引用到的每个 png}
      (从 data/workspaces/{ws}/ln-screenshots/ 读实际文件写进 zip 的 attachments/)
  - media_type application/zip，下载名 {标题}-obsidian.zip
  前端: 菜单项「Obsidian 包」→ 触发该 endpoint 下载。

【验证】
  后端 pytest（参考 backend/tests/test_ln_get_fallback.py / test_export_*）:
    造含 ![](/static/.../ln-screenshots/x.png) 的 ln.md + 一张 png，请求 ?format=obsidian，
    断言 zip 含 {标题}.md(图片已转 ![[attachments/x.png]] + 有 frontmatter) 和 attachments/x.png。
  前端: npx tsc --noEmit (0) + npm run build (OK)。
  手动: ./dev.sh 重启，开 /ln 页，逐项点导出菜单：PDF 打印预览正常 / .md 内容对 / zip 解压结构对。

【红线】不碰阶段①布局；不写用户文件系统(阶段③)；不 pip install(zipfile/re 标准库即可)。
```

## 2.5 阶段② 修复（2026-05-31 真实前端实测 bug）

mimo 已实现阶段②主体（导出菜单 / PDF / MD / Obsidian zip），但真实点击暴露 4 个用户可见问题 + 后端安全/契约偏差，根因已定位：

| # | 问题 | 根因 | 文件:行 |
|---|---|---|---|
| 1 | **Obsidian 包导出失败**（阻塞） | 前端请求 `/api/workspaces/.../ln/export`，但 vite proxy 的 `/api` 转发**不 rewrite**，后端路由是 `/workspaces/.../ln/export`（无 `/api`）→ 404 | index.tsx:76 |
| 2 | **zip 路径穿越**（安全） | 图片正则 group `([^)]+)` 可含 `../`，`img_name` 未校验 basename → 可读截图目录外文件 / 写危险 zip entry | export.py:720,751 |
| 3 | **zip 内 md 文件名注入**（安全） | `zf.writestr(f"{title}.md")` 用未清洗 `title`（可含 `/`、`..`）；`safe_title` 算了却没用上 | export.py:747,757 |
| 4 | **frontmatter source 偏差**（契约） | `source` 写成视频标题，plan 要的是 url 或 workspace id | export.py:732,735 |
| 5 | **MD 视图不自动换行**（体验） | MdView 的 CodeMirror 缺 `EditorView.lineWrapping`，长行横向溢出 | MdView.tsx:21 |
| 6 | **PDF 含侧边栏 + 只有一页**（体验） | print 样式只作用 `.vm-ln-scope` 内，管不到 AppShell 侧边栏/顶栏；且未放开 overflow/height 链 → 只打印一屏 | AppShell.tsx / learning-notes.css:803 |
| 7 | **导出文件名全不友好**（体验） | MD/PDF/zip 都用数字（`videoItem.name`）命名、MD 缺 `.md` 后缀无法直接打开、PDF 存成 "frontend"；应统一用笔记 H1 标题 + 正确后缀 | index.tsx / export.py |

> **2026-05-31 晚 · 修复进展**：mimo 已完成 #1~#4 / #6 文件名 / #7 / MD 换行（后端 pytest 10/10、前端 tsc+build OK，验证抽查全部到位）。
> #6 PDF「只有一页 + 最后一行被切断」的**真实根因不在 learning-notes.css，而在全局 `src/index.css` 的 `html, body, #root { height:100%; overflow:hidden }`**——祖先卡死一屏高，打印被裁到一页。已由 opus 直接补 `@media print { html,body,#root { height:auto; overflow:visible } }` 修复（mimo 之前只放开了 AppShell + `.vm-ln-scope` 内部，漏了最外层）。下方提示词保留备查。

### mimo 修复提示词（直接复制）

```
RP1-B+ 学习笔记导出 · 阶段② 修复：4 个实测 bug + 后端安全/契约偏差。
背景必读: docs/plans/rp1b-ln-layout-export-mimo-prompt.md §2.5
前置: 阶段② 主体已实现(导出菜单/PDF/MD/Obsidian zip)，本轮只修不重写。

【修复 1 (阻塞)·前端 Obsidian 导出 404】
  根因: index.tsx 用 fetch('/api/workspaces/${ws}/ln/export?...')，vite proxy 的 /api 转发不 rewrite，
        后端路由是 /workspaces/{ws}/ln/export(无 /api) → 404。
  改: 走项目统一 http client(axios，baseURL 已指向后端)。
    - frontend/src/services/workspaces.ts 新增:
        export async function exportLnObsidian(workspaceId: string): Promise<Blob> {
          const res = await http.get(`/workspaces/${workspaceId}/ln/export`,
            { params: { format: 'obsidian' }, responseType: 'blob' })
          return res.data
        }
      (http 拦截器只对含 code!=0 的 json reject；blob 无 code 字段会放行，安全)
    - index.tsx handleExportObsidian 改调 exportLnObsidian(workspaceId)；用 useParams 的 workspaceId，
      别再拼 /api、别用 pageState.workspace.workspace_id 走裸 fetch。

【修复 2 (安全)·后端 zip 路径穿越 + 文件名注入】
  文件: backend/app/routes/export.py export_ln_obsidian
  - _replace_img 内 filename 必须是安全 basename:
      from pathlib import Path
      if Path(filename).name != filename: 跳过(不改写、不收集)
      且后缀 ∈ {.png,.jpg,.jpeg,.webp,.gif}(小写)，否则跳过。
  - 写图片前二次确认在截图目录内:
      img_path = (screenshots_dir / img_name).resolve()
      if not str(img_path).startswith(str(screenshots_dir.resolve()) + os.sep): continue
  - zip 内 md 文件名用 safe_title(把现第757行的 safe_title 计算移到 writestr 之前):
      zf.writestr(f"{safe_title}.md", md_content)   # 不要用裸 title

【修复 3 (契约)·frontmatter source】
  export.py: source 用 workspace_id(明确无歧义)；若 video_item 有原始来源 url 字段
  (mimo rg 确认字段名，如 source_url/url)则优先用它，否则 workspace_id。不要再用 video_item.name。

【修复 4 (体验)·MD 视图换行】
  文件: MdView.tsx — extensions 数组加 EditorView.lineWrapping(EditorView 已 import)。

【修复 5 (体验)·PDF 只一页 + 含侧边栏】
  目标: 打印时只出笔记正文(HtmlView)，无 app 侧边栏/顶栏，长笔记自然分多页。
  a) src/layouts/AppShell.tsx 用 Tailwind print variant 隐藏 app chrome:
       侧边栏 <nav className="flex w-[72px] ...">          → 加 print:hidden
       顶栏   <... "flex items-center gap-3 border-b ..."> → 加 print:hidden
       外层   <div "flex h-screen w-screen overflow-hidden"> → 加 print:block print:h-auto print:overflow-visible
       主内容 <div "flex min-w-0 flex-1 flex-col overflow-hidden"> → 加 print:overflow-visible print:h-auto
  b) learning-notes.css @media print(约803行)补，放开高度/overflow 让内容流式展开:
       .vm-ln-scope, .vm-ln-scope .ln-body, .vm-ln-scope .ln-notes-panel, .vm-ln-scope .ln-html-scroll {
         height: auto !important; max-height: none !important; overflow: visible !important;
       }
  验证(必看打印预览): ./dev.sh → /ln → Cmd/Ctrl+P:
     ① 无左侧 app 图标栏、无顶栏 ② 笔记完整多页(不再只 1 页) ③ 只有笔记正文。

【修复 6 (体验)·统一导出文件名 = 笔记标题 + 正确后缀】
  用户反馈: 现在文件名是一串数字(videoItem.name)，MD 还缺 .md 后缀无法直接打开；PDF 存成 "frontend"。
  要求: MD / PDF / Obsidian 三处导出都用「笔记标题」命名 + 保证后缀(.md/.pdf/.zip)。
  前端 index.tsx 加共用取标题函数:
    function deriveNoteTitle(md: string, fallback?: string): string {
      const h1 = md.match(/^#\s+(.+)$/m)?.[1]?.trim()
      return (h1 || fallback || '学习笔记').replace(/[/\\:*?"<>|]/g, '_').slice(0, 80)
    }
  - MD 导出 handleExportMarkdown:
      const title = deriveNoteTitle(markdown, pageState.videoItem.name)
      a.download = `${title}.md`            // 务必带 .md；下载后确认文件名正确
  - PDF 导出(window.print 前临时改 document.title，浏览器存 PDF 默认名取自它):
      const title = deriveNoteTitle(markdown, pageState.videoItem.name)
      const prev = document.title
      window.addEventListener('afterprint', () => { document.title = prev }, { once: true })
      document.title = title
      window.print()
  - Obsidian zip(后端 export.py): safe_title 改为基于 md 的 H1 标题 —
      从 md_content 提取首个 ^#\s+ 标题 → 无则 video_item.name → 无则 workspace_id，再过 _SAFE_NAME 清洗。
      zip 内 md 名 + 下载 zip 名都用它。

【阶段③ 范围】本轮不做「写入 Obsidian 库」: 保持该菜单项禁用(灰掉)占位、留接口，
  后续单独一轮(涉及新增设置项，内容较多)。本轮不要启用它、不写任何文件系统逻辑。

【验证汇总】
  后端: 补 pytest — 恶意 ![](.../ln-screenshots/../../x.png) 被跳过 / title 含 '/' 时 zip 内是 safe 名 /
        frontmatter source=workspace_id / zip 名取自 H1 标题。  cd backend && pytest tests/ -k "ln or export" -q
  前端: cd frontend && npx tsc --noEmit && npm run build
  手动: 4 项导出逐一点，重点确认「文件名=笔记标题+正确后缀、能直接打开」—
        PDF(存为 标题.pdf，多页、无侧栏) / MD(下载 标题.md 可直接打开) /
        Obsidian 包(标题-obsidian.zip，解压 md+图片对) / MD 视图 CodeMirror 长行换行。

【红线】只修不重写阶段②；不 pip install；安全校验(basename+扩展名+目录内)不能省；阶段③ 保持禁用、不启用。
```

## 3. 阶段③ 写入 Obsidian 库（配置 + 文件系统写入 · ⚠️ 风险项）

让用户在设置里配一次 Obsidian vault 路径，导出时 nibi 直接把笔记(.md, Obsidian 语法) + 截图写进库对应文件夹。**写用户本地文件系统，属红线区**，须路径校验、不静默覆盖、失败明确报错，并由用户在自己机器验证。

### mimo 启动提示词（直接复制）

```
RP1-B+ 学习笔记导出扩展 · 阶段③：直接写入用户 Obsidian 库（⚠️ 写本地文件系统）。
背景必读: docs/plans/rp1b-ln-layout-export-mimo-prompt.md §0 + §3
前置: 阶段② 已完成。Obsidian zip 里的 md 改写(![[ ]])+frontmatter+图片收集逻辑应抽成共用函数，本阶段复用，别复制两份。

⚠️ 本阶段写用户本地文件系统，红线约束：
  - 路径必须校验：vault 目录存在且可写，拒绝越界路径。
  - 不静默覆盖同名笔记：已存在则改名加时间戳，或返回冲突让前端提示。
  - 任何失败明确报错，不留半截文件。
  - 实现后必须请用户在自己机器验证（配路径 + 实际写一次 + 到 Obsidian 看效果）。

【任务 3.1 后端·vault 路径配置】
  参照 backend/app/routes/download_config.py 的配置存取模式（先 rg 读它怎么存/读/存哪）。
  新增 obsidian 配置: vault 根路径 + (可选)attachments 子目录名(默认 'attachments') + (可选)笔记子目录。
  GET/PUT 配置端点，沿用 download_config 的存储位置与风格。

【任务 3.2 后端·写入 vault 端点】
  文件: backend/app/routes/export.py
  - 新增 POST /workspaces/{workspace_id}/ln/export/obsidian-vault
  - 复用阶段② 的 md 改写 + frontmatter 共用函数。
  - 读 vault 配置 → 校验路径 → 写 {vault}/{笔记子目录?}/{标题}.md + copy 截图到 {vault}/{attachments}/。
  - 同名冲突按上面策略。返回写入的绝对路径列表。

【任务 3.3 前端·设置入口 + 启用菜单项】
  - vault 路径配置 UI：rg 看 download_config 前端在哪设置，跟着放同一处。
  - 启用阶段② 占位的「写入 Obsidian 库」菜单项：未配置 vault → 提示先去设置填路径；已配置 → 调 3.2，toast 成功/失败。

【验证】
  后端 pytest: 用 tmp_path 当 vault，断言写入的 md(已转语法)+图片存在、同名冲突按策略处理。
  前端 tsc(0) + build(OK)。
  ⚠️ 手动(用户机器): 配真实 vault 路径写一次，到 Obsidian 确认笔记 + 图片正常。

【红线】不 pip install；路径校验不能省；不覆盖用户已有文件。
```

## 4. 进度

- [x] 阶段① 布局/视图微调（opus，2026-05-31）
- [x] 阶段② 导出 MD + Obsidian 包（mimo 修复 6 项 + opus 补 PDF 分页根因@index.css；pytest 10/10 + build OK，待用户验证打印预览）
- [ ] 阶段③ 写入 Obsidian 库（**用户决定本轮不做**；保持禁用占位 / 留接口，后续单独一轮——涉及新增设置项）
