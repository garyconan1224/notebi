---
phase: RP1-C0
title: 视频复刻页数据契约修复
status: done
created: 2026-05-31
completed_date: 2026-05-31
commits: []
---

# RP1-C0: 视频复刻页数据契约修复

## 背景

视频复刻页 (`VideoResultPage`) 的前端契约期望 frames 包含 `image_path`, `sec`, `ts`, `prompt_mj` 等字段。但当前 `_materialize_video_results_from_analyze` 函数存在两个问题：

1. **提前返回逻辑有 bug**：只检查 `results["frames"]` 是否存在，没有检查是否是目标格式。导致只有 `frame_image/frame_image_path` 的 raw frames 直接返回，没有继续读取 json_outputs 物化结构化 frames。

2. **字段映射缺失**：视觉 JSON 字段是 `image_prompt_en`，但代码直接读 `prompt_mj`（空值）。`prompt_sd` 和 `prompt_video` 也没有正确兜底。

## 修复方案

### 1. 修复提前返回逻辑

新增 `_is_target_frame_format(frames)` 函数，检查 frames 是否已具备目标字段（`image_path`, `sec`, `ts`, `prompt_mj`）：

```python
def _is_target_frame_format(frames: list) -> bool:
    if not frames:
        return False
    first = frames[0]
    required_fields = ("image_path", "sec", "ts", "prompt_mj")
    return all(field in first for field in required_fields)
```

只有 `_is_target_frame_format` 返回 True 时才提前返回。

### 2. 支持合并 raw frames 和视觉 JSON frames

- raw frames 可能只有 `frame_image/frame_image_path`（真实图片路径）
- 视觉 JSON frames 有 `timestamp`, `description_zh`, `image_prompt_en`
- 按顺序合并：优先保留 raw frame 的真实图片路径，补充视觉 JSON 的元数据

### 3. 修复字段映射

| 视觉 JSON 字段 | 目标字段 | 映射规则 |
|---|---|---|
| `image_prompt_en` | `prompt_mj` | 直接映射 |
| （无源字段） | `prompt_sd` | `{ positive: image_prompt_en, negative: "" }` |
| （无源字段） | `prompt_video` | 用 `image_prompt_en` 兜底 |
| `timestamp` | `ts`, `sec`, `timestamp` | 已有逻辑 |
| `description_zh` | `description` | 已有逻辑 |

### 4. 绝对路径转 /static/ URL

新增 `_convert_absolute_to_static_url(abs_path, data_root)` 函数，把 raw frame 的绝对路径转成前端可用的 `/static/...` URL。

## 验收标准

- [x] raw frames + json_outputs：输出来自视觉 JSON 的多帧结构化 frames
- [x] `frame[0]` 至少包含 `idx`, `sec`, `ts`, `timestamp`, `description`, `image_path`, `prompt_mj`, `prompt_sd`, `prompt_video`, `tags`
- [x] `prompt_mj` 非空，内容来自 `image_prompt_en`
- [x] `image_path` 是浏览器可访问的 `/static/...` 路径
- [x] `tracks_meta.frame_count` 等于物化后的 frames 数
- [x] `summary_path=subtitle` 不被错误物化
- [x] 多 json_outputs 时 `preferred_basenames` 仍能选中正确视觉 JSON
- [x] C-0.1: frames_dir 兜底用 timestamp/sec 拼文件名，不用 idx
- [x] C-0.1: 重复 timestamp 的多条 frame 复用同一个 jpg

## 测试

新增 `backend/tests/test_video_result_materialize.py`，21 个测试用例覆盖：
- `_is_target_frame_format` 6 个
- `_convert_absolute_to_static_url` 3 个
- `_materialize_video_results_from_analyze` 12 个（含 C-0.1 的 2 个）

## C-0.1 补修（2026-05-31）

### 问题
frames_dir 兜底找图用 idx 秒数拼文件名，但应该用 timestamp/sec。导致 timestamp=00:00:03, idx=2 时找不到 *_00_00_03.jpg。

### 修复
- 把 timestamp 解析提前到 frames_dir 兜底逻辑之前
- 用 `int(sec_val)` 转时分秒拼文件名，不用 idx
- 重复 timestamp 的多条 frame 自然复用同一个 jpg（相同 sec_val → 相同文件名）

### rp1-c1 更新
- `frame.url` 全部改为 `frame.image_path`
- 点击缩略图用 `seekTo(frame.sec)`，不新增 `setActiveFrame`（activeFrame 由 currentSec 派生）

## 注意事项

C-0 完成后，后续 C-1/C3/C4 计划必须把 `frame.url` 改为 `frame.image_path`。

RP1-C1~C5 的 UI 改造尚未开始，不在本次范围内。
