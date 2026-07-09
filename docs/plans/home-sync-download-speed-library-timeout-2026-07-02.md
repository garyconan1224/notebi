# 修复计划：下载卡死(代理) / 首页残留已删任务 / 资料库加载失败 / 反选清空精简

> 日期：2026-07-02　分支：`feat/exp-redesign-p1`
> 作者：Claude（桌面/终端）　执行：小米　审查：Codex
> 用户反馈的问题：1) 笔记页删任务后首页残留；2) 下载太慢（卡死）；3) 处理中打开资料库报「加载失败」；4) 添加素材弹框「反选/清空」重复。
>
> **重要更新**：问题2 的真凶经 Claude 实测已确认是**代理拖死 B 站下载**（不是下载方式问题），因此原定的 aria2c/DASH 方向作废，改为「强制 B 站直连」。详见任务 2。
>
> 首页「最近任务」= 只删被删的那一条，保留最近 8 条其余内容（用户明确）。

四个任务相互独立，建议按 **任务2（最影响体验，已定位）→ 任务1 → 任务3 → 任务4** 顺序做。

---

## 参考项目 / 技术资料（Claude 已查证）

- **BiliNote**（本 app 的同类参考）：https://github.com/JefferyHcool/BiliNote
  - 它的「全局代理」设计明确写着**只作用于 AI 接口、转写接口、YouTube 下载**，并用 `HTTP_PROXY` 环境变量兜底。→ 佐证我们任务2 的修复方向：**代理是给 YouTube 等境外站的，B 站不该走代理**。
- **BBDown**（专用 B 站命令行下载器，速度参考）：https://github.com/nilaoda/BBDown
  - 提供 `--upos-host` 切换 CDN 镜像（如 `upos-sz-mirroraliov.bilivideo.com`）来提速——**B 站真正的第二瓶颈是 CDN 选择**（默认 CDN 慢，镜像快）。作为任务2 的「可选备选」，仅在直连后仍慢时才考虑。
  - 可选 CDN 镜像：`upos-sz-mirroraliov / mirrorcos / mirrorcosb / mirrorbos / mirrorhw .bilivideo.com`。
- yt-dlp 相关佐证：
  - B 站限速 issue：https://github.com/yt-dlp/yt-dlp/issues/10849 （社区普遍反映默认 CDN 慢）
  - CDN 选择需求：https://github.com/yt-dlp/yt-dlp/issues/14498 （yt-dlp 无内置 CDN 切换，需改 URL host）
  - 结论：**aria2c 多线程对「CDN 本身慢/代理卡死」无效**，所以本次不上 aria2c，先解决代理。

---

## 任务 1：首页残留「已在笔记页删除」的任务

### 现象
笔记页 `/notes` 删除某任务后，首页 `/` 的「最近任务」仍显示它。

### 根因（已核实）
首页「最近任务」和笔记页是两套数据源：

1. 首页 `RecentTasks` 读的是前端 `taskStore`（zustand + localStorage persist），并由 `usePipelineTasks({ pollInterval: 5000 })` **每 5 秒轮询 `GET /pipeline/tasks`（全量任务）** 回填。
   - `frontend/src/pages/WorkbenchPage/RecentTasks.tsx:143-145`
   - `frontend/src/hooks/usePipelineTasks.ts`
2. 笔记页删除走后端：`deleteWorkspace`（合集，DELETE `/workspaces/{id}`）是**软删除**（`trashed=True`），`remove_item`（单条，DELETE `/workspaces/{id}/items/{item_id}`）删 item。
   - `frontend/src/pages/LibraryPage/index.tsx:362-415`
3. **关键**：软删/删 item **都不会删除 task_store 里的任务记录**，而 `GET /pipeline/tasks` 返回全量任务、不看 workspace 是否 trashed。
   - `backend/app/routes/pipeline.py:51-79`（`list_tasks` 无 trashed 过滤）
   - `backend/app/routes/workspaces.py:2382-2396`（`delete_workspace` 只 `trashed=True`）
   - `backend/app/routes/workspaces.py:2530`（`remove_item`）

结论：**纯前端 `removeTask` 会在 5 秒后被轮询重新加回**，所以必须同时改后端，让被删任务不再从 `/pipeline/tasks` 返回。

### 修复方案（三处，缺一不可）

**1-A 后端：`list_tasks` 过滤掉「已 trashed / 已不存在」工作空间的任务**
文件 `backend/app/routes/pipeline.py`，函数 `list_tasks`（约 51 行）。
- 在文件顶部引入 workspace 存储单例（与 `workspaces.py` 用同一个 `_store`；查看 `backend/app/routes/workspaces.py` 顶部 `_store = ...` 的来源，直接 import 那个单例，**不要新建 WorkspaceStore 实例**，否则内存缓存不一致）。
- 在 `all_recs = _store.list_all()` 之后、排序之前，构造一个「有效 project_id 集合」：
  - 取 workspace 存储里 `list_all(include_trashed=False)` 的所有 `workspace_id`（注意本项目 task 的 `project_id` == `workspace_id`）。
  - 过滤：`all_recs = [r for r in all_recs if r.project_id in valid_ids]`。
- 这样合集/笔记被软删（trashed）后，其任务立刻从首页轮询结果里消失。

**1-B 后端：`remove_item` 删单条 item 时，一并删除该 item 的 related_task_ids**
文件 `backend/app/routes/workspaces.py`，函数 `remove_item`（约 2530 行）。
- 删除 item 前先取到该 item 的 `related_task_ids`。
- item 删除成功后，遍历这些 id 调用 `_pipeline_runner.store.delete(tid)`（`task_store.delete` 已存在，见 `backend/app/services/task_store.py:147`）。
- 用 try/except 包住，单个删除失败不阻塞主流程。
- 注意：只有「合集里删单条」才需要这步（1-A 处理的是整个合集 trashed 的情况；单 item 删除时合集通常仍存在）。

**1-C 前端：删除成功后即时与后端对账（体验，避免等 5 秒轮询）**
> 用户明确：首页「最近任务」是**只删被删的那一条，保留最近 8 条其余内容**（`RecentTasks` 取 `tasks.slice(0, 8)`）。所以**不要**按 workspace 批量清前端缓存（合集里删单条会误伤同合集其它视频的卡片，造成"闪一下又回来"）。
- 正确做法：在 `frontend/src/pages/LibraryPage/index.tsx` 的 `handleDeleteOne` / `handleDeleteWorkspace` / `handleBatchDelete` 成功回调里，**主动触发一次 task 列表刷新**，让前端 `taskStore` 立即与后端对账（后端已由 1-A/1-B 清掉被删任务）。
  - 实现：把 `usePipelineTasks` 里那次 `GET /pipeline/tasks` 的拉取逻辑抽成可手动调用的 `refetch()`，或复用现有轮询函数，在删除成功后立即调用一次。
  - 效果：被删的那条立刻消失，其余 7 条不受影响，若不足 8 条会自然补上下一条。
- 若抽 `refetch` 成本高，退而求其次：新增 `taskStore.removeTask(taskId)` 的精确删除——但前端需要拿到被删 item 的 task_id。当前 `LibraryItem` 不带 task_id，需后端在 library/删除响应里回带，改动更大，**优先用 refetch 方案**。
- 最终一致性由 1-A/1-B 保证，1-C 只为「即时」。

### 验收
1. 起后端（**确认是新进程**：`ps aux | grep uvicorn` 看启动时间晚于本次改动，命令含 `.venv` 和 `--reload`）。
2. 造数据：新建一个笔记任务跑完 → 首页「最近任务」能看到。
3. 到 `/notes` 删除它 → 首页**立即**消失（1-C 生效），且**等 10 秒**轮询后仍不出现（1-A/1-B 生效）。
4. 合集删除、批量删除各测一遍。
5. `curl -s 'http://localhost:8000/pipeline/tasks' | python -m json.tool | grep -c task_id` 前后对比，确认被删任务不再返回。

---

## 任务 3：批量处理中打开笔记页/复刻页/资料库 → 「加载资料库失败，请确认后端已启动」

### 现象
批量任务处理中（如截图下载 2%），打开 `/notes`、`/replicas`、`/library` 先显示「加载资料库…」，几秒后报「加载资料库失败，请确认后端已启动」。后端其实没挂。

### 根因（已核实）
1. 前端 http 客户端超时 **15 秒**：`frontend/src/services/client.ts`（`timeout: 15000`）；`fetchLibrary` 也显式传 15000：`frontend/src/services/library.ts:52`。
2. `GET /workspaces/library` 是重接口：对**每个视频 item** 都会 `open()+json.load()` 读磁盘上的视觉分析 JSON、并 glob 目录定位报告：
   - `backend/app/routes/workspaces.py:2050-2055`（列表里对 video 调 `_materialize_video_results_from_analyze`）
   - `backend/app/routes/workspaces.py:3129`（该函数内 `open()`/`json.load()`/`_locate_analyze_report_dir`）
   - 另外每个 item 还走 `_sync_item_with_tasks`（逐个 `task_store.get`）、`_item_thumbnail` 等。
3. 工作空间数量多（约 78 个），列表页本就慢；批量下载时磁盘 I/O 争抢，`/workspaces/library` 耗时超过 15 秒 → 前端超时 → 误报「后端没启动」。

> 注意：这不是「后端被阻塞」，任务跑在独立 ThreadPool、SSE 是 async，都不占用列表接口。纯粹是**接口太慢 + 前端超时太短**。

### 修复方案

**3-A（立即、低风险）：给资料库接口更长超时**
- `frontend/src/services/library.ts:49-53` 的 `fetchLibrary`：把传给 `http.get` 的 `timeout` 从 `15000` 提到 `60000`。
- 只改这一个调用，不动全局 `client.ts` 的默认 15s（其它接口保持不变）。
- 这一步能立刻消除误报的「加载失败」。

**3-B（推荐、性能治本，中等风险）：给列表接口减负**
`GET /workspaces/library` 是列表卡片视图，**不需要**把每个视频的帧数据从磁盘物化出来。
- 在 `backend/app/routes/workspaces.py` 的 `get_library`（约 2017 行）里，**列表场景不调用** `_materialize_video_results_from_analyze`。
  - 做法：给该函数（或抽一个内部开关）传 `materialize=False`；列表分支直接用 `results = overlay_results or item.results or {}`，跳过 `_materialize_...`。
- 受影响的卡片字段确认（读代码逐个核对，别猜）：
  - `thumbnail`/`cover_thumbnail`：视频封面通常已在 `item.results.cover_thumbnail`（下载阶段写入），不依赖物化 → 应无影响，**需实测确认封面还在**。
  - `frames_count`（`workspaces.py:2093`）：不物化时视频 `frames` 可能为空 → 计数变 0。这是卡片上的次要信息，可接受；若要保留，另起小任务在 analyze 完成时把 `frames_count` 持久化进 `item.results`，本次先不做。
  - `has_summary`/`has_transcript`/`primary_view`/`duration`：核对是否依赖物化后的 `results`；若依赖，保留对应的轻量读取，不要整块物化。
- **红线**：3-B 若发现会让「资料库卡片封面消失/类型判断错乱」，立即停下回报，不要硬改。可只交付 3-A。

### 验收
1. 后端新进程（同任务1 的确认方式）。
2. 起一个批量下载任务（保持处理中）。
3. 处理中反复打开 `/notes`、`/replicas`、`/library`，都应正常加载、**不再报「加载资料库失败」**。
4. 量化：`time curl -s 'http://localhost:8000/workspaces/library' -o /dev/null -w '%{time_total}\n'`
   - 3-A 后：处理中耗时可能仍较长但 < 60s，前端不再超时。
   - 3-B 后：应显著下降（记录前后数值写进测试报告）。
5. 打开一个视频合集详情页，确认封面、总结/字幕标记、时长仍正常（回归 3-B）。

---

## 任务 2：B 站批量下载卡死（几十 B/s，ETA 好几小时）—— 真凶是代理

### 现象
- 正在跑的任务（BV1q44y1k718 / BV1Av411N7mX，都是 5–11 秒的**超短视频**，总共不到 1MB）卡在 1%，速度 26–46 B/s、ETA 3–4 小时、单调衰减。
- 5 秒的视频理应零点几秒下完。

### 根因（Claude 已实测确认，非猜测）
下载配置里开着代理：`GET /download_config` → `http_proxy: http://127.0.0.1:7890`（Clash）。**B 站是国内站，被代理绕到境外节点后媒体流下载会崩/被拖到字节级**。实测证据：

| 方式 | 结果 |
|---|---|
| 直连 + cookie + header（`.venv/bin/yt-dlp`，同一 BV） | 3.96–11 MiB/s，**瞬间下完** |
| 走代理 7890（显式 `--proxy`） | `SSL: UNEXPECTED_EOF_WHILE_READING`，连接反复断、卡死 |
| 应用实际任务 | 30 B/s、ETA 4h（= 代理卡死的表现） |

**为什么代码里"B站先直连"没生效**：`shared/video_download_ytdlp.py` 的 `_build_attempts` 里，B 站"直连"尝试只是**省略了 `proxy` 参数**（`direct_opts = {k:v ... if k != "proxy"}`）。但 yt-dlp 在没有 `proxy` 选项时**会读进程环境变量 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`**。后端进程是从带代理 env 的终端启动的，所以"直连"尝试实际仍走了环境代理 → 卡死。（`_resolve_download_kwargs` 又把 `download_config.http_proxy=7890` 兜底传进来，双重来源。）

> 结论：这跟 DASH/分片并发/aria2c **无关**——连接被代理拖死，加多线程也没用。**核心修复是让 B 站强制直连**。原计划的 aria2c/DASH 降为可选的后续提速项，本次不做。

### 修复方案

**2-核心：B 站（及其它国内平台）强制直连，显式关代理**
文件 `shared/video_download_ytdlp.py`，`_build_attempts` 的 B 站分支。
- 给 B 站的"直连"变体**显式设置 `"proxy": ""`**（空字符串），而不是省略该键。yt-dlp 里 `proxy=""` 会**同时禁用 opts 代理和环境变量代理**，才是真直连。
  - 即把现在的 `direct_opts = {k: v for k, v in base_opts.items() if k != "proxy"}` 改成在 B 站直连变体里带上 `"proxy": ""`。
- 顺序保持：先直连变体（proxy=""），把带 `normalized_proxy` 的代理变体放到最后做兜底（极少数网络确实要靠代理访问 B 站）。
- 校验：改完后应用日志里 B 站首个策略应立刻跑到 KiB/MiB 级并秒下短视频。

**2-核心（可选加固）：代理只对境外站生效**
- 在 `_resolve_download_kwargs`（`backend/app/services/pipeline_tasks.py:484`）或 `_build_attempts` 里，判断 `_is_bilibili_url` / 其它国内域名时，把 `proxy` 归一化为 `""`；只有 YouTube 等境外站才用 `download_config.http_proxy`。
- 这样即便用户在设置里填了代理，也不会拖垮 B 站。

**用户可立即自救（不用等改代码）**：设置页「下载」把 `http_proxy` 清空（只下 B 站时）；或在 Clash 规则里让 `bilibili.com`/`*.bilivideo.com`/`*.akamaized.net` 走 DIRECT。

**2-可选备选（仅当直连后仍慢才做，本次先不实现）**：CDN 镜像切换
- 若强制直连后 B 站速度仍只有 ~1MB/s（默认 CDN 慢），参考 BBDown 的思路：把 yt-dlp 拿到的媒体 URL host 替换成更快的镜像（如 `upos-sz-mirroraliov.bilivideo.com`）。
- yt-dlp 无内置切换，需在 format 选好后改 URL（成本较高），**留作后续单独任务**，除非直连仍不达标。

**2-后续（可选，本次不做）**：装 `aria2c` 多连接（`brew install aria2` + `external_downloader`，用 `shutil.which` 守卫）进一步提速——但要先把代理问题解决，否则无效。留作后续单独任务。

### 验收
1. 记录基线：`.venv/bin/yt-dlp --cookies /Users/conan/.local/bilibili_cookies/www.bilibili.com_cookies.txt -f "bv*/b" 'https://www.bilibili.com/video/BV1q44y1k718' -o /tmp/x.%(ext)s`（应 MiB/s 秒下）。
2. 改完后端（**确认新进程**），在真实 UI 跑一个 B 站批量任务：
   - 下载策略 1 立刻上 KiB/MiB 级，短视频秒下、长视频 ETA 收敛；
   - `curl -s 'http://localhost:8000/pipeline/tasks?include_result=true&limit=3'` 看 `download_speed` 应是 KiB/MiB 级而非 B/s。
3. 回归：设置里**保留** `http_proxy=7890` 的情况下，B 站仍能直连快下（证明 `proxy=""` 生效）；同时确认 YouTube 链接仍能走代理下载（若你有 YT 场景）。

---

## 任务 4：添加素材弹框「反选 / 清空」二选一（小改）

### 现象
`添加素材 → 批量合集` 里有 `全选 / 反选 / 清空` 三个按钮，用户觉得「反选」和「清空」重复，只保留一个。

### 说明
严格说两者不同（反选 = 取未选的；清空 = 全不选），但用户要精简。按「保留直觉的一对（全选 / 清空）」处理。

### 修复
文件 `frontend/src/components/workspace/AddMaterialModal.tsx`（约 1138–1151 行）。
- **删掉「反选」按钮**那个 `<button>`（`onClick` 里构造 invert 的那段，label 是 `反选`），保留「全选」（1131–1137）和「清空」（1152–1158）。
- 若 `.batch-source-control-actions` 的样式依赖按钮数量（如等宽三列），顺带核对 `library.css`/相关 css 不要留空位。

### 验收
- 弹框里只剩「全选 / 清空」；点全选全勾、点清空全清；`npm run build` 通过。

---

## 给小米的红线
- 后端改动验证前，先确认跑的是**新进程**（`ps aux | grep uvicorn` 看启动时间 + 含 `.venv`/`--reload`），别对着旧进程测。
- 前端改完跑 `cd frontend && npm run build` 核对（不要只信 `tsc`）。
- 任务2 本次**不装 aria2c、不改 DASH/并发**，只做「强制 B 站直连」；aria2c 留作后续单独任务。
- 任务2 改代理逻辑时，**不要动 YouTube 分支的代理**（境外站要靠代理），只改国内站直连。
- 任务3-B 若发现会破坏卡片封面/类型，立即停下回报，可只交付 3-A。
- 任务1 前端只删「被删的那一条」，不要按 workspace 批量清缓存（会误伤首页其它卡片）。
- 不改 `.env`、不动 DB schema、不 `git push`、不在脏树上跑「单 commit 过审」。
- 每个任务各自 commit，信息写清对应任务号，方便 Codex 分别审查。
- 四个任务都要求「自己跑数据验证 + 附证据」，不许只看代码猜。
