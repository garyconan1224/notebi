# A6 回归验证报告

**验证时间**：2026-05-28 16:57-17:03
**测试 URL**：`https://www.bilibili.com/video/BV1LSRhBQErk`
**生成 task**：`download-a5b423d51d46` + `analyze-0d19948a7121`

---

## 修复验证结果

### A1 ✓ 步骤不再无脑全 done
- download 任务 SUCCESS 后：步骤区全部显示 `—`（保守 queued）✅
- analyze 任务 SUCCESS 后：全部 7 步骤 ✓ DONE ✅
- analyze 任务 FRAMES 96% 时：下载/探测/转写 ✓ DONE，截帧 96%，后续 `—` ✅
- **对比修复前**：download SUCCESS 时所有 7 步全部 ✓ DONE（bug）

### A2 ✓ FloatingTaskQueue dedup
- 同一 URL 只生成 download + analyze 两个 task，按 source_url 正确归并
- 证据：API 返回 2 个 task（download + analyze），前端面板合并显示

### A3 ✓ SSE/轮询数据源一致
- setTasks 加 last-writer-wins，滞后的轮询不覆盖 SSE 的 SUCCESS
- 证据：任务从 FRAMES → SUCCESS 转换过程中，前端状态实时更新

### A4 ✓ 截帧进度平滑
- 后端加帧级日志（每 5% 一条），前端日志区可见帧级进展
- 截帧进度从 96% → 97% → 98% 平滑递增，未出现跳变

### A5 ✓ 查看结果按钮可点
- analyze SUCCESS 后：按钮 `[cursor=pointer]`，显示「完成 · 点击查看结果」
- download SUCCESS 时：按钮不可点（正确，因为 analyze 还在跑）
- itemId 缺失时兜底跳 /library

### B1 ✓ 未完成素材不进结果页
- 资料库 ItemCard 未完成素材点击跳 ProcessingPage 或 toast 提示
- ListView 未完成素材 toast 提示

### B2 ✓ 步骤日志有业务细节
- ASR：模型信息 + 解码参数 + 段数/时间码进度 + 完成汇总（字符/段数/时长）
- FRAMES：截帧参数 + 帧级进度
- VLM：模型配置信息
- SUM：LLM 总结配置

### B3 ✓ 右上角全局 ETA
- 头部显示「剩余 10s」，基于所有活跃任务的 progress 速率估算
- 每秒递减，任务完成后自动消失

---

## 测试套件
- 前端：15 files, 110 tests ✓
- 后端：354 passed, 2 skipped ✓
