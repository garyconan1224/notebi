# 说话人区分准确率调研与真实音频验证

日期：2026-07-13

## 结论

当前最稳妥的产品路径是：

1. 用户知道人数时，明确传入预计说话人数；
2. 用户不知道人数时，自动模式先按较短、声学条件相近的区间估计人数，再做全局人物合并；
3. 自动结果必须提供低置信提示和重新分析入口，不能把自动估计包装成确定结果。

仅对完整长音频做一次全局聚类不可靠。节目片头、远近麦克风、后期插入、音乐、电话音质和长时间声线变化都会让同一个人形成多个声学簇。

## NoteBi 真实音频验证

样本：3:48:01 的中文双人访谈，实际主要为主持人与嘉宾两人。

| 方案 | 输入范围 | 结果 | 耗时 | 判断 |
|---|---:|---:|---:|---|
| sherpa-onnx，自动阈值 0.8 | 前 10 分钟 | 14 人 | 约 90 秒 | 严重碎片化 |
| sherpa-onnx，自动阈值 0.9 | 前 10 分钟 | 11 人 | 约 90 秒 | 严重碎片化 |
| sherpa-onnx，自动阈值 1.0 | 前 10 分钟 | 9 人 | 约 90 秒 | 仍不可用 |
| sherpa-onnx，明确 2 人 | 前 10 分钟 | 2 人、58 段 | 约 90 秒 | 与转录中的主持/嘉宾切换基本一致 |
| FoxNose diarize，自动 | 前 10 分钟 | 2 人、41 段 | 21.3 秒，含首次下载 | 短片段表现良好 |
| FoxNose diarize，自动 | 完整 3:48:01 | 8 人、5435 段 | 约 460 秒 | 全局声学漂移导致过度分裂 |

完整音频试验中，VAD 得到 5981 个语音区间、约 11064.7 秒人声；提取 15379 个嵌入后，GMM/BIC 估计为 7 人，silhouette 又细分为 8 人。这说明问题不只是某个阈值设置，而是“整段一次性估计人数”的策略不适合这类长节目。

## 项目与论文判断

### 已采用：sherpa-onnx

- 支持 macOS、Windows、Linux 的离线推理，部署面符合 NoteBi 后续开源计划。
- 当前模型组合为 pyannote segmentation 3.0 INT8 与 3D-Speaker ERes2Net，模型许可证分别为 MIT、Apache-2.0。
- 已知人数时表现明显优于自动阈值，适合作为当前生产后端。

资料：

- https://github.com/k2-fsa/sherpa-onnx
- https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html

### 已集成：WeSpeaker 音色嵌入

- FoxNose 的 VAD、WeSpeaker 嵌入与 GMM/BIC 人数估计在 10 分钟样本上正确识别 2 人，速度也较快。
- 它在完整 4 小时样本上仍误判 8 人；其公开基准也说明人数估计与重叠语音仍是限制。
- 没有加入完整 FoxNose `diarize` 包，避免其 `torch<2.9` 约束与 NoteBi 当前环境冲突。
- 直接使用 Apache-2.0 的 `wespeakerruntime`，在本地 VAD 窗口上做 WeSpeaker 嵌入与 KMeans 聚类；失败或人数不足时自动回退 sherpa-onnx。
- 对当前 25:51 双人音频的真实回归得到 2 人、83 个合并区间，耗时约 59 秒；这只证明该样本通过，不等同于完整 DER 评测。

资料：

- https://github.com/FoxNoseTech/diarize
- https://foxnosetech.github.io/diarize/how-it-works/
- https://foxnosetech.github.io/diarize/benchmarks/
- https://github.com/wenet-e2e/wespeaker

### 后续算法方向

- **VBx / PLDA 全局人物合并**：适合把局部分块得到的人物原型链接为全局人物，避免同一人因声学漂移被拆成多个簇。
- **NME spectral clustering**：可用于自动人数估计，但仍应建立在分块采样上。
- **Sortformer / EEND-EDA / MSDD**：对重叠语音和未知人数更有研究价值；NeMo 方案通常更重，现成 Sortformer 配置还有最多 4 人等约束，不适合直接作为轻量跨平台默认依赖。
- **LLM 后处理**：可以利用姓名、问答关系和语言上下文修正标签跳变、提升可读性，但不能单独修复错误的声学人数与人物身份。

资料：

- VBx：https://www.sciencedirect.com/science/article/pii/S0885230821000619
- Sortformer：https://arxiv.org/abs/2409.06656
- Streaming Sortformer：https://arxiv.org/abs/2507.18446
- EEND-EDA：https://arxiv.org/abs/2005.09921
- MSDD：https://arxiv.org/abs/2203.15974
- DiarizationLM：https://research.google/pubs/diarizationlm-speaker-diarization-post-processing-with-large-language-models/

## 推荐实施顺序

### A. 当前版本（已实现）

- “区分说话人”开启后显示预计说话人数：自动、2、3、4、5 人。
- 数字从创建素材、批量导入、URL 任务一直透传到 sherpa-onnx 聚类配置。
- 不知道人数或超过 5 人时保留自动模式。

### B. 下一步低风险增强

1. 自动模式按 5 至 10 分钟区间采样，避开片头音乐与纯静音；
2. 对各区间分别估计人数，只接受多数区间一致且稳定的估计；
3. 用局部人物原型做全局链接，并合并发言时间极短的碎片簇；
4. 无法形成稳定共识时，结果标记为低置信，建议用户选择人数重新分析；
5. UI 显示“检测到约 N 人”，与用户指定的确定人数区分。

### C. 准确率评测门槛

正式替换自动策略前，至少建立 8 至 12 条带人工人物标注的真实样本，覆盖：双人访谈、多人圆桌、远程连线、背景音乐、说话重叠和超过 2 小时的长音频。

验收指标：

- 人数完全正确率；
- DER（Diarization Error Rate）；
- 人物归属后的转录错误率；
- 低置信结果的召回率；
- macOS 与 Windows 的耗时、峰值内存和首次模型下载体积。

在没有人工金标准时，完整长音频跑出“2 人”只能证明数量碰巧一致，不能证明每条字幕的人物归属正确。
