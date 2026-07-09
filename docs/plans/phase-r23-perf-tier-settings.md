---
phase: R23
title: 设置面板 · 性能档位（CPU / GPU / 内存 → 并发槽位）
status: pending
owner: TBD（建议 deepseek v4-pro，UI 改动为主）
estimated_hours: 4-6
depends_on:
  - R22 并行调度已实现（不然没有"槽位"概念可调）
user_source: 2026-05-27 用户反馈 issue 9
---

## 背景

用户有大内存 / 可能有 GPU 的设备，希望在设置面板手动选「机器档位」（低配 / 标配 / 高配 / 自定义），让 pipeline 调度器据此放更多并发任务跑，充分调用电脑性能。

## TODO（进入此 phase 时再展开）

- 设置页位置：CLAUDE.md §3 N3 设置页 7 项里挂哪一项下？需用户拍板
- 档位语义：
  - 「低配」= 1 并发
  - 「标配」= 2 并发
  - 「高配」= 4 并发
  - 「自定义」= 用户拖滑块
  - 是否检测 GPU 自动推荐？还是只让用户手动选？
- 档位字段存哪儿：sqlite settings 表 / 本地 localStorage / `data/config.json`？
- 后端怎么读：task_runner 启动时读、还是每个任务进入时读？
- ProcessingPage 右上角「并行槽位 X/Y」UI 已存在（用户图 4 显示 2/6 推荐 6）——和这套设置怎么对齐？
- 单测 + 文档

**不在此 phase 展开操作步骤，开工时停下来问用户。**
