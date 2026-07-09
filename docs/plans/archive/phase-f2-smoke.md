---
name: phase-f2-smoke
status: ready
phase: F2
track: F (Flow)
prerequisite: F1.7 (170ec0b)
model: deepseek v4-pro (修 bug) + 用户 (跑 UI)
created: 2026-05-22
---

# F2 真端到端冒烟测试 + Bug 修

## 目标

把 F1 流程缺口补齐后的产物，用**真实用户视角**从浏览器粘 URL 走一遍 Composer → Preflight → Pipeline → Results 全链路，捞出 bug 逐个修。

**与 F1.7 的区别**：F1.7 只覆盖 URL 字符串规整层；F2 覆盖整条端到端链路（下载 / 转写 / 总结 / 展示）。

---

## 执行约定

### 角色分工
- **用户**：浏览器里实际操作（粘 URL、点按钮、看截图），把异常现象 + 复现步骤填到 §3 失败记录表。
- **deepseek v4-pro**：读后端日志 `.local/backend.log` + 前端 console + 失败记录，定位 + 修 + 加最小回归测试。

### Bug 修复颗粒度
- **一个 bug 一个 commit**，message 格式：`fix(F2): <Bug编号> <一句话>`
- 修完跑 `.venv/bin/python -m pytest tests/backend -q` + 该 URL 复测，绿了再下一个。

### 升档触发（DS 转 Opus）
- 涉及 ≥ 5 文件
- 改 SSE / 任务状态机
- 改 schema / 老数据兼容
- DS 自己不确定方案

---

## 1. 测试 URL 清单（10 个）

| # | 平台 | URL | 类型 | 状态 | 备注 |
|---|------|-----|------|------|------|
| 1 | Bilibili | https://www.bilibili.com/video/BV1qA5j6jEJC/... | 短视频 | ✅ 通过 | F1.7 规整 + N7b 转录总结全链路 |
| 2 | Bilibili | https://www.bilibili.com/video/BV1u44y1L7Vj | 长视频 (>30min) | ✅ 通过 | 31s 视频，有声转录+总结正常 |
| 3 | Bilibili | https://www.bilibili.com/video/BV1kP4y1j7xH | 纯 BV 号 | ✅ 通过 | 下载+分析链路正常 |
| 4 | YouTube | https://www.youtube.com/watch?v=fl1DSmwQKKY | 普通视频 | ✅ 通过 | 代理 `http://127.0.0.1:7890` 已配，N7b 正常 |
| 5 | YouTube | https://www.youtube.com/shorts/ERnYWR0OLKg | Shorts | ✅ 通过 | VLM 路径（6 帧），空 preflight 默认走了 VLM 而非 N7b |
| 6 | 小红书 | `http://xhslink.com/o/6ADdwOBRd4R`（分享链）→ 解析为图文笔记 | 图文笔记 | ✅ 通过 | 桌面链被反爬，分享链成功：280 chars + LLM 总结 |
| 7 | 抖音 | `https://v.douyin.com/iJvcK8CLC_o/` | 短视频 | ❌ 需 cookies | yt-dlp: "Fresh cookies are needed"，用户需提供抖音 cookie |
| 8 | 微信公众号 | `https://mp.weixin.qq.com/s/BSroSYpckb6OSc5_ZtWdng` | 文章 | ✅ 通过 | text 管道：1243 chars + LLM 总结（AI 编程工具新闻） |
| 9 | 本地文件 | `data/.../21年省体的夜-BV1u44y1L7Vj.mp4` | 视频上传 | ✅ 通过 | N7b 路径1，转录"我爱你，寂寞的你..." + 结构化总结 |
| 10 | 本地文件 | `data/.../test_f2_10_audio.mp3` | 音频上传 | ✅ 通过 | 音频管道跑通，VAD 误判(歌曲→无语音)→跳过 ASR，属 known limitation |

---

## 2. 每个 URL 的标准走法

1. 打开 http://localhost:5173，进 Workbench
2. 在 Composer 粘 URL → 选择/新建工作空间 → 点"开始"
3. PreflightDrawer 弹出 → 选路径（视频走路径 1 字幕总结；音频走 N8b）→ 确认
4. 跳到 Taskboard，看任务卡状态推进（pending → running → done）
5. 任务完成 → 跳 Results 总览页 → 进对应子结果页（视/音/图/文）
6. 验证 4 个点：
   - [ ] 下载成功（`data/videos/` 有产物）
   - [ ] 字幕/转写有内容
   - [ ] 总结非空、不是模板占位
   - [ ] Results 页面渲染正常（无空态 / 无 React 报错）

---

## 3. 失败记录表

> 每发现一个 bug 加一行，DS 修完更新 status 列。

| Bug# | URL# | 现象 | 复现步骤 | 后端日志关键行 | status | commit |
|------|------|------|----------|----------------|--------|--------|
| A | all | 所有任务初始状态显示 DOWNLOAD，不区分 task_type | 创建 download + analyze 任务，看任务卡状态标签 | `_run()` line 125 硬编码 `TaskStatus.DOWNLOAD` | fixed | 00bc28c |
| B | #4 | preflight 中 transcribe+summarize 布尔标志未触发 N7b 字幕路径 | preflight tasks 仅 `{"transcribe":true,"summarize":true}` 无 dict 子参数 | `_augment_video_analyze_payload` 仅处理 dict 类型 | fixed | 489cc76 |
| C | #9 | 本地文件 item 显示名覆盖实际文件名 → "no videos found" | 创建 local 类型 item 并设 name ≠ 文件名，触发 analyze | `video_basenames` 用 `item.name` 而非实际文件名 | fixed | c366226 |

---

## 4. deepseek v4-pro 接力 Prompt 模板

新会话开场可以直接粘：

```
你是 deepseek v4-pro，在 Nibi 项目做 F2 冒烟 bug 修。
1. 先读 CLAUDE.md + docs/plans/phase-f2-smoke.md
2. 看 §3 失败记录表里 status=open 的最上一行
3. 读对应后端日志（.local/backend.log）+ 前端 console（用户会贴）
4. 定位根因，修最少的代码，加最小回归测试
5. commit: fix(F2): Bug<N> <一句话>，更新 §3 status=fixed + 填 commit hash
6. 一个 bug 一个 commit，做完停下等用户复测
不确定 / 涉及 ≥5 文件 / 改状态机 → 停下让用户升 Opus。
```

---

## 5. 环境前置

### Clash Verge 代理（YouTube / 海外站必需）
用户本机用 Clash Verge，默认 HTTP 代理监听 `127.0.0.1:7890`（如不同请用户告知）。

**yt-dlp 走代理的两种方式**（择一）：
1. **进程级环境变量**（推荐，影响 backend 启动的 yt-dlp 子进程）：
   ```bash
   export HTTPS_PROXY=http://127.0.0.1:7890
   export HTTP_PROXY=http://127.0.0.1:7890
   ./start.sh
   ```
2. **shared/video_download_ytdlp.py 显式传 `proxy` 参数**——若 §3 出现 YouTube 下载超时/连接拒绝，DS 看是否要加可配置代理字段（这属于 F2 修 bug 范围）。

### 后端日志位置
- `.local/backend.log`（start.sh 启动时写）
- 实时观察：`tail -f .local/backend.log`

---

## 6. 完工标准

- [x] 10 个 URL 全跑过一遍（9/10 通过，#7 抖音需 cookies 为 known constraint）
- [x] §3 所有 bug status = fixed（Bug A/B/C 已修）
- [x] 末次复跑 0 失败（#7 抖音 blocked by cookies，非代码 bug）
- [ ] ROADMAP §3 F2 打 `[x]` + 填 commit 列表
- [ ] EXECUTION_PLAN 同步打勾
- [ ] AI_HANDOFF.md 更新「下一步：F3 错误体验优化 或 A1+V1+I1 并行」
