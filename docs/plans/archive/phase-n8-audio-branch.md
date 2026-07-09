---
phase: N8
title: 音频分支补全（VAD 双路 / pyannote 说话人 / 音乐分析）
status: done
priority: P2
estimate_hours: 8-10
actual_hours: ~3
model: Opus 4.7
branch: feat/phase-n8-audio-branch
worktree: 是（/Users/conan/Desktop/nibi-n8）
depends_on: [N5, N6]
commits: [dc14841]
completed_date: 2026-05-19
spec_ref: docs/SPEC.md §5
---

## 用户决策（开工前已确认）

1. **VAD**：silero-vad（onnxruntime 后端，比 webrtcvad 准、比 torch-only 轻）
2. **pyannote.audio 说话人分离**：做。需要 HuggingFace token + 同意 `pyannote/speaker-diarization-3.1` 协议——代码必须 **graceful fallback**：缺 token 或装失败时日志告警 + 跳过这一步，其它流程不受影响
3. **音乐分析**：BPM + 调性 + Suno/Udio 提示词——全套都做

---

## 现状

`backend/app/services/pipeline_tasks.py::handle_audio_task` 已有 ASR + summary 基础流水：
- FETCH（拉本地/URL 音频）
- TRANSCRIBE（调云端 OpenAI 兼容 `/audio/transcriptions`，默认 `FunAudioLLM/SenseVoiceSmall`）
- SUMMARIZE（LLM 100-200 字摘要）
- STORE（写 `data/projects/<pid>/audio/<task_id>.json`）

**没有**：VAD、说话人分离、音乐分析、字幕导出（.srt/.txt 文件）。preflight.tasks 子参数也没有透传。

## 范围决策（N8 v1）

| 范围项 | 做 | 备注 |
|---|---|---|
| silero-vad 检测 | ✅ | 转写前跑，无人声时返回 `voice_detected: false` + 警告日志 |
| Whisper 语言子参数 | ✅ | 从 preflight.tasks.asr.whisper_lang 透传 |
| pyannote 说话人分离 | ✅ | gated by `HF_TOKEN` 环境变量；缺 token / 缺包时 graceful skip |
| 音乐分析 BPM / key | ✅ | librosa 基础特征 |
| Suno/Udio 提示词 | ✅ | 单段（整曲）级别，LLM 生成 |
| 字幕导出 .srt/.txt 文件 | ✅（简单实现）| 用 transcript_segments 生成 |
| "无人声切音乐模式"弹窗 | ❌ N8b | 需要前端交互，本期只在日志告警 |
| 多段音乐切分 + 6 维度 | ❌ N8b | 整曲单段够用，多段是 P3 |
| 说话人标签人工修正 UI | ❌ N8b | 前端工作量大 |
| 按内容类型套模板 | ⏸ 简化 | 通用模板兜底；模板分支留接口 |

---

## 子任务拆分

- [ ] **N8.1** 装依赖
  - `silero-vad>=5.0`（onnxruntime 后端）
  - `librosa>=0.10`
  - `pyannote.audio>=3.1`（**最重的一项**，会拉 torch + torchaudio；装失败/不装也能继续做其它）
  - 写进 requirements.txt（pyannote 标注为可选 + HF 协议要求）

- [ ] **N8.2** 新增 `shared/audio_analyzer.py`：
  - `run_vad(audio_bytes) -> VadResult{has_speech, segments}`：silero-vad 检测
  - `run_diarization(audio_path) -> DiarizationResult | None`：pyannote 跑；缺 token/包 → 返回 None + 日志
  - `analyze_music(audio_path) -> MusicAnalysis{bpm, key, energy_curve, duration}`：librosa
  - `generate_music_prompt(features, api_key, model) -> {music_prompt, similar_refs, scenarios}`：LLM 拼 Suno/Udio
  - `export_srt(segments, with_speakers=False) -> str` / `export_txt(...) -> str`：字幕文件生成

- [ ] **N8.3** `handle_audio_task` 接入
  - 从 payload 读 audio 子参数：`whisper_lang` / `speaker_diarization_enabled` / `music_analysis_enabled` / `suno_format` / `udio_format` / `subtitle_export_enabled`
  - 在 TRANSCRIBE 前跑 VAD
  - has_speech=False + music_analysis_enabled=False → 日志告警 + 跳过 ASR
  - has_speech=True + diarization_enabled → 跑 pyannote（缺则警告）
  - music_analysis_enabled → 跑 librosa + LLM 生成提示词
  - subtitle_export_enabled → 落 .srt / .txt 文件
  - result JSON 加 `vad` / `diarization` / `music` / `subtitle_paths` 字段

- [ ] **N8.4** `_bridge_to_pipeline_payload` 透传
  - `item.preflight.tasks.{asr, speaker_diarization, music_analysis, subtitle_file}` 解包到 payload

- [ ] **N8.5** 测试
  - `test_audio_analyzer.py`：
    - VAD：构造极短静音 + 含语音的合成 wav，分别检测
    - export_srt：纯字符串生成测试，不依赖任何模型
    - pyannote / librosa：mock + skip 如果包不可用
  - `test_audio_pipeline_bridge.py`：
    - bridge 函数把 preflight.tasks 翻译成 payload 字段

- [ ] **N8.6** 收尾
  - `pytest tests/backend -q`：所有通过
  - 更新 EXECUTION_PLAN（N8 打勾 + 新增 N8b）/ AI_HANDOFF / COMPLETED_WORK / plan frontmatter

---

## 不要做的事

- ❌ 不要做"无人声切音乐模式"前端弹窗（N8b）
- ❌ 不要做说话人标签人工修正 UI（N8b）
- ❌ 不要做多段音乐 6 维度切分（N8b）
- ❌ 不要在 pyannote.audio 装不上时让整个 pipeline 挂掉——必须 graceful skip
- ❌ 不要碰前端 N6 ChatPanel / N5 PreflightConfigPanel（它们已经有相关 UI）

## 风险点

1. **pyannote.audio 装包重**：会拉 torch + torchaudio + 多个模型，首次运行下载 ~500MB-1GB。代码必须 lazy import + try/except 容错
2. **HF token 在哪配**：检测 `HF_TOKEN` / `HUGGINGFACE_TOKEN` 环境变量；缺 → 日志告警 + 跳过 diarization
3. **silero-vad 的 onnxruntime 在 Mac arm64**：可能装的是 onnxruntime（CPU）或 onnxruntime-silicon——按 PyPI 默认走
4. **librosa 加载 mp3 需要 ffmpeg/audioread**：ffmpeg 已是项目系统依赖（README 已要求），稳
5. **测试不能跑真模型**：每个真模型推理要数秒到数十秒——测试必须 mock 或 skip
