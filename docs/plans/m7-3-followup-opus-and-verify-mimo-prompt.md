---
title: M7-3 跟进 — 默认值修正 + B站 opus 适配器（移动端方案）+ 9 条真实验收
status: done
owner: xiaomi mimo v2.5-pro
created: 2026-06-04
updated: 2026-06-04（opus 方案重定：API+WBI 实测死路 → 移动端 HTML + __INITIAL_STATE__）
parent: docs/plans/track-K-M7-kickoff.md
prereq: M7-3 已合 main；本卡是 Opus review + 多轮实测后的"先改再验收"
branch: feat/k-m7-3-opus-adapter
---

# 0. 背景（Opus 实测结论，必读）

- **任务 A（默认值）**：mimo 已做（`note_kind` 默认 video→text），保留。
- **任务 B（opus）**：mimo 现版本走 `opus/detail` API + WBI 签名 + 复用 `bilibili_nocookie`，**实测三重失败**：
  1. `bilibili_nocookie` 是**坏模块**（依赖的 `base` 基类全项目不存在，import 即崩；单测 mock 掩盖了）
  2. `_get_wbi_keys` 的 header/`code==0` 检查有 bug
  3. **就算修干净，`opus/detail` 带正确 WBI 签名仍 `-352` 风控**（需 buvid/w_webid，免登录走不通）
- ✅ **实测可行的新路线**：手机分享链 `b23.tv` 展开是 **`m.bilibili.com/opus/<id>`（移动端）**，**无反爬**，正文+图片内嵌在 `window.__INITIAL_STATE__`——和 `xiaohongshu_share` 一个套路。

---

# 1. 任务 A（已完成，确认）
`pipeline_tasks.py:1380/:1482` 默认值 video→text。已做则跳过。

---

# 2. 任务 B（重做）：B站 opus 适配器 — 移动端 __INITIAL_STATE__ 方案

## 2.1 废弃旧实现
- 删掉 `bilibili_opus.py` 里 `opus/detail` API + WBI 签名 + `from .bilibili_nocookie import ...` 的全部逻辑（死路）。
- **不要 import `bilibili_nocookie`**（坏模块）。

## 2.2 新实现（已实测可行）
新建/重写 `fetch_bilibili_opus(url) -> {ok,title,content,images,...}`：

1. opus_id = URL 末段数字（`/opus/(\d+)`，兼容 `m.`/`www.`/`b23.tv`，b23 先展开）
2. 请求 **`https://m.bilibili.com/opus/<opus_id>`**，**iPhone UA**（实测可用）：
   `Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1`
3. 从 HTML 提取 `window.__INITIAL_STATE__=` 后的 JSON，**用 `json.JSONDecoder().raw_decode(html, start)`** 解析（处理字符串内括号，别用正则贪婪）
4. 解析字段（已实测确认路径）：
   - 标题：`obj["opus"]["detail"]["basic"]["title"]`
   - 正文+图：遍历 `obj["opus"]["detail"]["modules"]`，取 `module_type` 为内容模块的项（含 `module_content` / `paragraphs`），逐段提取文字 + 图片 url；mimo 先 `json.dumps` 打印 modules 各项确认 `module_content` 的段落结构（text / pic.url）
5. 返回 `kind_hint="image_text"`（有图）或 `"text"`（纯文）

## 2.3 复用参考
- **`shared/xiaohongshu_share.py`**：它就是"抓页面 + 提取内嵌 JSON(`__INITIAL_STATE__`)"的现成样板，**照它的结构写**。
- 接入：`_classify_note_url` 的 `/opus/` 分支 → `"bili_opus"`；`_download_note_source` 的 bili_opus 分支调新 `fetch_bilibili_opus`。

## 2.4 实测证据（mimo 可复现）
```
curl -sSL 'https://m.bilibili.com/opus/1203642237996498944' \
  -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ...' -o /tmp/opus.html
# → 37KB HTML，无"验证码"，含 window.__INITIAL_STATE__，title/正文齐全
```
opus.detail.basic.title 实测 = `【2026-5-18】AI圈大事件：大厂新品+行业热点全梳理 - 哔哩哔哩`

## 2.5 兜底
若移动端结构变动/取不到正文 → 优雅失败（返回 ok=False + 清晰 error），**不崩整个任务**；不要回落到坏的 API/WBI 路线。

---

# 3. 真实验收（9 条，`./dev.sh` 后在 app 真操作）

素材见 `m7-test-fixtures.md`。**看抓到的正文真假，不只看 SUCCESS。**
Opus 已代验抓取层：少数派/MBA/**公众号(真文6229字)**/txt/md/docx **6 条真通过**；pdf/小红书信勘验；**opus 走新方案应能真通过**。

| # | 素材 | 断言 |
|---|---|---|
| 1-4 | txt/md/pdf/docx | note_kind=text，正文+总结 |
| 5-7 | 少数派/MBA/公众号 | note_kind=text，真正文 |
| 8 | 小红书图文 | note_kind=image_text，6图+正文，**走 analyze 不崩** |
| 9 | **B站 opus** | note_kind=text/image_text，**抽到真正文**（标题=AI圈大事件…）|

---

# 4. 红线 / 纪律
- **不 import 坏模块 `bilibili_nocookie`**；opus 走移动端 HTML 方案。
- 任务 A / 任务 B 分开小 commit；**不主动 push**；改完 `pytest`（.venv+KMP）+ `./dev.sh` 真验。
- 单测**别只 mock**——opus 适配器要有"真抓一次 m 端页面解析成功"的测试（可对 `/tmp` 缓存 HTML 做离线解析单测，避免 CI 依赖网络）。
- 不确定/结构对不上 → 停下问，别塞假正文、别走回 API 死路。

---

# 5. 给 mimo 的直接开工话术（复制即用）

```
执行 Track K M7-3 跟进任务。先读 docs/plans/m7-3-followup-opus-and-verify-mimo-prompt.md（完整方案、字段路径、实测证据都在里面），再动手。

启动：cd /Users/conan/Desktop/nibi && git status && git log --oneline -15 先对账；从 main 新建分支 feat/k-m7-3-opus-adapter；./dev.sh 起前后端。

任务：
1. 任务A（note_kind 默认 video→text，pipeline_tasks.py:1380 / :1482）——已完成则确认后跳过。
2. 任务B 重写 opus 适配器：废弃现有 bilibili_opus.py 的 opus/detail API + WBI 签名 + bilibili_nocookie 依赖（实测死路：坏模块 import 即崩 + 带签名仍 -352 风控）。改成移动端方案——请求 https://m.bilibili.com/opus/<opus_id>（iPhone UA）→ 用 json.JSONDecoder().raw_decode 提取 window.__INITIAL_STATE__ → 取 obj["opus"]["detail"]["basic"]["title"] + 遍历 obj["opus"]["detail"]["modules"] 拿正文段落和图片。照 shared/xiaohongshu_share.py 的套路写（它就是抓页面+提取内嵌 JSON）。
3. 任务C 验收：./dev.sh 后在 app 真跑 docs/plans/m7-test-fixtures.md 的 9 条素材，看抓到的正文真假（不只看 SUCCESS）。重点：opus 抽到真正文（标题含「AI圈大事件」）、小红书 image_text 走 analyze 不崩。

红线：
① 绝不 import bilibili_nocookie（坏模块，依赖的 base 基类全项目不存在，import 即崩）。
② opus 单测别只 mock——要有"真解析一次 m 端 HTML"的离线断言（把样例 HTML 缓存到 tests/fixtures 做解析测试，不依赖 CI 网络）。
③ 一个任务一个小 commit；改完跑 pytest（.venv + KMP_DUPLICATE_LIB_OK=TRUE）+ ./dev.sh 真验；不主动 push。
④ 实际代码/页面结构与卡不符、或 opus 取不到正文 → 停下问（按 CLAUDE.md §4 求证模板），别塞假正文、别走回 API 死路。
```
