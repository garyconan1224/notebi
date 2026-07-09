# ④16 平台字幕直取（CC-first）+ Whisper 兜底（2026-06-23）

> 来源：手测 19 条 ④16。需求（用户原话）：B站/YouTube 等很多视频自带外挂字幕（CC），能直接拿就跳过 Whisper 转写、加快流程。
> 范围：后端为主 + 前端一个开关。产品取舍已由用户拍板（见 §三）。

---

## 一、背景

目前所有视频走「提取音频 → Whisper 转写 → 总结」（慢）。而 B站/YouTube 大量视频自带字幕（人工或平台自动生成），可直接取下来用，跳过 Whisper，明显加速。

## 二、现状（代码调研结论）

> ⚠️ 本机 `rg` 的匹配高亮在终端会把命中词显示成 `ln` / `n`（如 `import ln` 实为 `import yt_dlp`、`info.get("n")` 实为 `automatic_captions`）。**核对具体代码一律用 `Read`，别信 rg 高亮处的字面。**

- `backend/app/services/subtitle_fetcher.py`（44 行，**半成品**）：`fetch_best_subtitle_text(url)` 用 yt-dlp `extract_info(skip_download=True)` 拿到 `subtitles`（人工）/ `automatic_captions`（自动）的轨道 URL，但**没真正下载解析**——只返回伪文本 `[subtitle:lang] <url>`（注释写"解析留给以后"）。
- `backend/app/services/transcript_service.py`：有 `get_transcript(url, prefer_subtitle=True, ...)` 字幕优先框架，被独立路由 `backend/app/routes/transcript.py` 使用；**主 pipeline 没用它**。
- `backend/app/services/pipeline_tasks.py`（主流程）：
  - payload 带原始 `url`（行 ~518）+ `proxy`/`po_token`/`visitor_data`/cookie（行 ~484-501）；已用 yt-dlp 下载视频。
  - `summary_path` 分路径：`video_model`（行 ~1003）/ `subtitle`（默认，行 ~1010）/ `visual_only`（行 ~1189）。
  - **字幕路径 `_run_subtitle_summary`（行 608）= 提取音频 → `fast_whisper` 转写 → 清洗 → 总结**，没接字幕直取。whisper 输出格式：`(transcript_text, transcript_segments[{start,end,text}], duration)`。
- `shared/transcript_cleaner.py`：`clean_transcript(...)` / `clean_transcript_rules(text)` 现成 —— 自动字幕过清洗用它。
- 前端 / payload：**无"优先字幕"开关**，需新增。

## 三、用户拍板（产品取舍已定）

- **都用**：人工字幕直接用；**自动字幕也用，但过一遍 `clean_transcript`**（补标点/纠错）。
- **加开关**「优先用平台字幕（更快）」，**默认开**；关掉则强制走 Whisper。

## 四、方案（改动集中在 subtitle_fetcher + _run_subtitle_summary + 前端开关）

**策略**：pipeline 字幕优先 —— `_run_subtitle_summary` 用 payload 的 `url` + 访问上下文调"完善后的 subtitle_fetcher"实时取字幕；命中就跳过音频提取 + Whisper，未命中回退现有 Whisper 流程。不碰下载流程，改动最集中。

1. **完善 `subtitle_fetcher.py`** —— 从"只返回 URL"改成"真正下载 + 解析"：
   - 签名扩展：`fetch_best_subtitle(url, *, proxy=None, po_token=None, visitor_data=None, cookies=None, prefer_langs=('zh-Hans','zh','zh-CN','en','en-US'))`。
   - `extract_info(skip_download=True)` 时**传入 proxy/po_token/visitor_data/cookie**（复用 payload 的，否则需登录/区域限制的视频取不到字幕）。
   - 区分 `subtitles`（人工）与 `automatic_captions`（自动）；按 `prefer_langs` 选语言（**中文优先**，回退英文/第一个可用）。
   - **真正下载字幕轨道**（srt/vtt/json3）并解析为 `segments=[{start,end,text}]` + 拼 `transcript_text`，**对齐 whisper 输出格式**（供结果页"原片 @mm:ss"跳转）。
   - 返回 `(transcript_text, segments, meta={lang, source:'manual'|'auto'})`；无字幕 / 下载失败 / 解析为空 → 返回 `None`。
2. **改 `_run_subtitle_summary`（行 608）** —— 开头插字幕优先分支：
   - 读 `prefer_subtitle = bool(payload.get('prefer_subtitle', True))`、`url = str(payload.get('url') or '').strip()`。
   - 若 `prefer_subtitle and url`：调 `fetch_best_subtitle(url, proxy=..., po_token=..., visitor_data=..., cookies=...)`：
     - `source == 'manual'` → 直接用；
     - `source == 'auto'` → 先 `clean_transcript` 清洗再用；
     - 设好 `transcript_text` / `transcript_segments`，**跳过音频提取 + Whisper**，结果里标 `source='subtitle_cc'`（与现有 `source` 字段一致即可）。
     - 取不到 / 解析失败 / 文本为空 → **落到现有 Whisper 流程**。
   - 现有 Whisper 分支保留为兜底；其后的字幕清洗（F1.6）/ segment_refiner / 总结**全部不变**（字幕与 whisper 同格式，下游复用）。
3. **前端开关**：添加视频/素材表单加 checkbox「优先用平台字幕（更快）」，**默认勾选** → payload `prefer_subtitle: true`。位置参考 Preflight 勾选分析任务处（小米用 `rg` 定位添加表单组件）。
4. **本地上传视频**（payload 无 `url`）：自动跳过字幕直取 → 走 Whisper（开关对其无效，无需特殊处理）。

## 五、涉及文件

- `backend/app/services/subtitle_fetcher.py`（完善下载 + 解析，主改）
- `backend/app/services/pipeline_tasks.py`（`_run_subtitle_summary` 加字幕优先分支）
- `shared/transcript_cleaner.py`（复用，不改）
- 前端添加视频/素材表单组件（加开关）+ 其 payload 类型（小米定位）
- （可选）后端 payload 模型字段、`settings.transcriber` 默认值
- 测试：`subtitle_fetcher` 解析单测 + pipeline 字幕优先路径单测

## 六、验收

- 有**人工字幕**的 B站/YT 视频（开关开）：**跳过 Whisper**，直接用人工字幕生成笔记；结果页时间戳跳转正常、明显更快。
- 只有**自动字幕**的视频：用自动字幕 + 清洗后生成，质量可接受。
- **无任何 CC / 本地上传**视频：回退 Whisper，行为不变。
- **开关关**：强制走 Whisper。
- 解析出的 `segments` 时间戳正确（原片 @mm:ss 可跳）。
- `video_model` / `visual_only` 路径不受影响；`pytest` + 新增单测绿。

## 七、给小米的执行须知与红线

- **先 `Read` 定位再改**：下载视频的 yt-dlp opts、`_run_subtitle_summary` 内 whisper 调用点、前端添加表单组件——用 `rg` 找位置，但**具体代码用 `Read` 看**（本机 rg 高亮把命中词显示成 `ln`/`n`，别照抄）。
- **必须保留 Whisper 兜底**：取不到字幕 / 解析失败 / 字幕为空 → 回退 whisper，**绝不能让视频处理失败或产出空笔记**。
- **字幕与 whisper 同格式**（`transcript_text` + `segments[{start,end,text}]`）；下游清洗 / 总结 / 时间戳跳转**不改**。
- **自动字幕必须过 `clean_transcript`**（用户要求）；人工字幕直接用。
- **中文优先**（zh-Hans/zh/zh-CN），回退英文/第一个可用语言。
- **复用 cookie/proxy/po_token/visitor_data**（payload 里有）传给 yt-dlp，否则需登录/区域限制视频取不到字幕。
- 不动 `video_model` / `visual_only` 路径；不动后端总结 / 模板逻辑。
- 开关默认开；本地上传（无 url）静默跳过直取。
- **自验**：`pytest` 跑绿 + 真实拿一个带 CC 的 B站/YT 链接 `./dev.sh` 实跑（验证：开关开→走字幕直取且更快；关→走 whisper）。不 `git push`；干净工作树；commit 写清「④16 平台字幕直取」。
- 这是后端较大改动，**遇到与现状不符 / 需判断处（下载点结构、字幕文件命名、payload 字段名）回报 Claude，别自行拍方案**。
