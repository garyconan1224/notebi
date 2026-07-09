# Track K · M7 纯文「端到端测试素材集」

> **用途**：M7（及后续 M8/M9）端到端测试反复使用的固定输入，覆盖纯文的全部来源。
> **分工**（2026-06-04 用户决议）：平台链接 = 用户提供真实关心的；通用网页 = 已搜真实可达；本地文件 = 已生成样本。
> **每条测试断言通用项**：① 自动识别为 `text` ② 抓到标题 + 正文 ③ 进 ProcessingPage 合理 ④ TextResultPage 原文/摘要正确。

---

## A. 平台链接（`url_sniffer` → text）

| 来源 | 链接 | 预期 | 状态 |
|---|---|---|---|
| 微信公众号 | `https://mp.weixin.qq.com/s/YV1LNiNzSEbndFPBbpkhwQ` | 识别 text + 抓标题正文（T2.3） | ✅ 收录（WebFetch 被反爬，**app 实测确认**） |
| 小红书图文 | `http://xhslink.com/o/3w7r5xADEqD`（M6 复用） | 识别 text + xhs 适配器取图集+正文 | ✅ 有 |
| B站图文动态 | `https://www.bilibili.com/opus/1203642237996498944`（原 `b23.tv/m0ju8Se`） | **应识别 text**；⚠️ sniffer 缺 `/opus/` 规则，现误判 video | ⚠️ 缺口 · M7 待定 |

## B. 通用网页文章（readability 抓正文 → text）

| 来源 | 链接 | 预期 | 状态 |
|---|---|---|---|
| 少数派 | `https://sspai.com/post/89856` | 标题「Goodnotes 教程｜…费曼学习法…」+ 完整正文 | ✅ 已验证可达 |
| MBA智库百科 | `https://wiki.mbalib.com/wiki/费曼学习法` | 词条标题「费曼学习法」+ 正文 | ✅ 已验证可达 |

## C. 本地上传文件（→ text）

| 类型 | 路径 | 预期标题 | 状态 |
|---|---|---|---|
| 纯文本 .txt | `tests/fixtures/m7-text/sample-article.txt` | 如何高效做读书笔记 | ✅ 已生成 |
| Markdown .md | `tests/fixtures/m7-text/sample-note.md` | Git 常用命令速查笔记 | ✅ 已生成 |
| Word .docx | `tests/fixtures/m7-text/sample-report.docx` | 深度工作：在分心的世界里保持专注 | ✅ 已生成 |
| PDF .pdf | `tests/fixtures/m7-text/sample-paper.pdf` | 间隔重复：对抗遗忘曲线的科学方法 | ✅ 已生成 |

---

## 不属于纯文（勿混入；留给后续纯视频/纯音频测试）
- 抖音 `douyin.com` / YouTube / 快手 / B站视频 `/video/` = **video**

## 待验证 / 缺口（M7-1 真上传时确认）
- **B站 `/opus/` 图文动态识别缺口**：`url_sniffer` 仅 `/read/→text`，无 `/opus/`，当前 fallback=`video`（误判）。用户提供的 B站链接正是 opus。→ M7 是否补 `/opus/→text` 规则（见开工卡讨论）。
- 微信公众号可达性：WebFetch 通用抓取被反爬，需 app 用 T2.3 适配实测确认。
- docx 能否作为上传源（sniff MIME 映射只显式列了 `application/pdf` + `text/*`）。
- AddMaterialModal 里的文本框（`AddMaterialModal.tsx:1209` textarea）是不是"直接粘贴正文成笔记"入口；若是，追加一条"直接粘贴文字"来源。
