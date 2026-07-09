---
phase: Track I · 图片深化（I2 批量任务起步）
status: ready
owner: xiaomi-mimo-2.5pro（执行）/ opus（规划+对账）
parent: docs/roadmap/track-I-image.md
estimated_hours: I2 6-9h
note: 2026-06-01 对账后产出。Track T 已收口，按 ROADMAP §11 下一步 = I 图片深化。
decisions:
  - I1(EXIF+信息卡) 已完成 → 起点 = I2 批量任务。
  - I3 风格 DNA 与 Track R·R3 重叠 + 是重算法活（风格向量/聚类/相似图），本轮**不做**，留到 R 阶段或单独评估。
---

## 0. 对账结论（2026-06-01，mimo 必读）

ROADMAP §11 T 之后 = I 图片深化（文档写"I2~I3"，因 I1 已完成）。

**I 现状（已对账）：**
- ✅ **I1 EXIF + 基本信息卡**：`ImageResultPage.tsx`(621行) 已有 基本信息段(~373) + EXIF 拍摄信息段(~390)。后端 image handler 已输出 EXIF（前端能展示）。
- ⚠️ **I2 批量任务**：ImageResultPage 已有「多图对比」(N9 `handleCompare`→`ImageCompareDialog`)，但那是**对比分析**，**不是** I2.1 的"多图勾选→批量打标/联想/重写"。批量执行入口/后端支持需对账。
- ❌ **I3 风格 DNA**：未做。track-I 注明"与 R3 重叠"，是重算法活（风格向量/聚类/相似图）→ **本轮不做**。

**结论**：起点 = I2（批量任务补齐）。I3 后置。

## 1. I 计划

| 子任务 | 内容 | 状态 |
|---|---|---|
| I1 | EXIF + 基本信息卡 | ✅ 已完成 |
| **I2.1** | 多图勾选 + 批量打标/联想/重写提示词 | 🔴 起点（缺，入口待对账） |
| **I2.2** | 批量结果对比 / 导出 | 部分（多图对比有，批量导出待补） |
| I3 | 风格 DNA 报告（单图向量/多图聚类/相似图） | ⏸ 本轮不做（与 R3 重叠，重算法，后置） |

## 2. I2 mimo 启动提示词（直接复制）

```
Track I · I2 图片批量任务（多图勾选批量执行 + 批量结果对比/导出）。
背景必读: docs/plans/i-image-mimo-prompt.md §0

【任务0: 对账批量入口现状（关键，决定在哪做、后端支不支持）】
  rg -n "多选|批量|select|checkbox|勾选|batch|多图|handleCompare" frontend/src/pages/WorkspacePage/TaskboardPage/index.tsx frontend/src/pages/result/ImageResultPage.tsx
  rg -n "批量|batch|多图|循环.*task|for.*item" backend/app/routes/workspaces.py backend/app/services/pipeline_tasks.py
  确认: ① 多图勾选批量执行的入口在 taskboard 素材列表 还是 详情页 ② 现有 ImageCompareDialog 做了什么(对比维度) ③ 后端单图分析任务能否批量调(打标/联想/重写)，还是要新增批量端点。

【任务1 (I2.1): 多图勾选 + 批量执行】
  - 在素材列表/taskboard 多图勾选 → 批量执行 打标/联想/重写(复用单图分析任务逻辑，循环或批量调)。
  - 进度反馈复用 FloatingTaskQueue(已有任务队列)。

【任务2 (I2.2): 批量结果对比/导出】
  - 批量结果对比复用 ImageCompareDialog 模式；批量导出复用 export.py 的 zip 打包。

【验证】
  - 前端 tsc --noEmit + pnpm build；后端若动则 pytest。
  - 手动: 选 ≥2 张图批量打标 → 各自结果对; 批量导出 zip 结构对。
  - git commit: feat(i2): 图片批量任务(多图批量执行+对比导出); 不要 push。
【红线】先对账批量入口/后端支持再动手; 复用 单图任务/ImageCompareDialog/export 不重造; 不装新依赖; 不留 debug 脚本。
```

## 3. I3 说明（本轮不做）

I3 风格 DNA 报告（单图风格向量 / 多图聚类簇 / 风格目标找相似）是较重的算法活，且 track-I 明确"与 Track R·R3 重叠"（Track R 在 ROADMAP §11 排很后的 [C] 阶段）。建议 I2 完成后单独评估，或并入 R 阶段一起做，避免重复造风格分析。

## 4. 进度

- [x] I1 EXIF + 基本信息卡（先前已完成）
- [ ] I2 批量任务（I2.1 批量执行 / I2.2 对比导出）← 起点
- [ ] I3 风格 DNA（本轮不做，后置/并入 R）
