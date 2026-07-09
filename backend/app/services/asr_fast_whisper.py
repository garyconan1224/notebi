from __future__ import annotations

"""Local ASR with faster-whisper."""

import os
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable, List, Optional, Tuple


# 最近一次探活失败的错误信息（类名 + 消息 + Traceback），供调用方获取完整上下文
_last_probe_error: Optional[Tuple[str, str, str]] = None

# 进程内 WhisperModel 缓存，按 (model_name, device, compute_type) 复用；避免多次触发 HF 下载 / 模型再初始化
_MODEL_CACHE: dict[tuple[str, str, str, str], Any] = {}
_MODEL_LOCK = threading.Lock()

# HuggingFace hub 缓存根目录；用于下载期间扫描 .incomplete 文件估算进度
# 遵循官方优先级：HF_HUB_CACHE > HF_HOME/hub > ~/.cache/huggingface/hub
def _hf_hub_cache_dir() -> Path:
    env_hub = os.getenv("HF_HUB_CACHE")
    if env_hub:
        return Path(env_hub).expanduser()
    hf_home = os.getenv("HF_HOME")
    if hf_home:
        return Path(hf_home).expanduser() / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _has_audio_stream(file_path: str | Path) -> bool:
    """用 ffprobe 检测文件是否包含音频流。

    无音轨视频（如纯画面录屏）喂给 faster-whisper 会抛
    ``tuple index out of range``，提前检测可优雅跳过转写。
    """
    import subprocess

    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "a",
                "-show_entries", "stream=index",
                "-of", "csv=p=0",
                str(file_path),
            ],
            capture_output=True, text=True, timeout=15,
        )
        return bool(result.stdout.strip())
    except Exception:  # noqa: BLE001 -- ffprobe 不可用时保守认为有音轨
        return True


def _hf_repo_dir(model_name: str) -> Path:
    """按 faster-whisper 约定拼 HF repo 缓存目录（Systran/faster-whisper-<size>）。"""
    # 允许用户直接传仓库全名（如 "Systran/faster-whisper-large-v3"），否则按 size 自动补前缀
    repo = model_name if "/" in model_name else f"Systran/faster-whisper-{model_name}"
    return _hf_hub_cache_dir() / f"models--{repo.replace('/', '--')}"


# faster-whisper (Systran/faster-whisper-*) 仓库的近似总下载大小（MB）。
# 来源：HuggingFace 仓库 "Files and versions" 页面；只需 ±10% 精度用于进度估算。
# 未列出的模型名走动态兜底（return 0 → 估算未知，进度回退到时间平滑曲线）。
_MODEL_APPROX_SIZE_MB: dict[str, int] = {
    "tiny":              75,
    "tiny.en":           75,
    "base":             145,
    "base.en":          145,
    "small":            485,
    "small.en":         485,
    "medium":          1530,
    "medium.en":       1530,
    "large-v1":        3100,
    "large-v2":        3100,
    "large-v3":        3100,
    "large-v3-turbo":  1620,
    "turbo":           1620,
    "distil-small.en":  335,
    "distil-medium.en": 790,
    "distil-large-v2": 1510,
    "distil-large-v3": 1510,
}


def _estimated_total_bytes(model_name: str) -> int:
    """查表返回目标模型的预估总下载字节数；未知时返回 0。

    对传入的仓库全名（"Systran/faster-whisper-medium"）取末尾 size 部分再查表，
    兼容用户在 Settings 中直接填写仓库路径的情况。
    """
    key = model_name.split("/")[-1]
    # 去掉可选的 faster-whisper- 前缀（极少数自定义仓库复用官方命名）
    if key.startswith("faster-whisper-"):
        key = key[len("faster-whisper-") :]
    return _MODEL_APPROX_SIZE_MB.get(key, 0) * 1024 * 1024


def _scan_model_cache_bytes(model_name: str) -> Tuple[int, int]:
    """扫描指定模型在 HF 缓存里的 (已完成字节数, 下载中字节数)。

    用于下载心跳：已完成 = blobs 下非 .incomplete 的 weight 文件；下载中 = .incomplete 文件当前大小。
    缓存目录或文件不存在时返回 (0, 0)，**任何 OSError / PermissionError / race 都吞掉**，
    保证监控回调不会把主转录链路拖崩。
    """
    try:
        repo_dir = _hf_repo_dir(model_name)
        blobs = repo_dir / "blobs"
        if not blobs.is_dir():
            return 0, 0
        done = 0
        pending = 0
        for p in blobs.iterdir():
            try:
                if not p.is_file():
                    continue
                size = p.stat().st_size
            except OSError:
                # 文件可能在扫描瞬间被 HF hub 重命名（atomic rename），跳过即可
                continue
            if p.name.endswith(".incomplete"):
                pending += size
            else:
                done += size
        return done, pending
    except Exception:  # noqa: BLE001 -- 扫描失败绝不抛回调用方
        return 0, 0


def is_model_cached(model_name: str) -> bool:
    """检测指定 Whisper 模型是否已**完整**存在于本地 HF 缓存。

    判定条件（全部成立才返回 True）：
      1. 仓库缓存目录存在且包含 snapshots/（HF hub 下载成功后才会写 snapshots 符号链接树）
      2. blobs 目录下**没有**任何 .incomplete 临时文件
      3. 已完成字节数达到预估总量的 85%（未知模型放宽到只要 > 0）—— 允许 ±15% 版本差异

    任意一步异常都视为"未缓存"，调用方应按首次加载处理。
    """
    try:
        repo_dir = _hf_repo_dir(model_name)
        if not repo_dir.is_dir():
            return False
        if not (repo_dir / "snapshots").is_dir():
            return False
        done, pending = _scan_model_cache_bytes(model_name)
        if pending > 0:
            return False
        expected = _estimated_total_bytes(model_name)
        if expected <= 0:
            return done > 0
        return done >= int(expected * 0.85)
    except Exception:  # noqa: BLE001
        return False


def _install_hint_for_current_interpreter() -> str:
    """根据当前 Python 解释器拼装精确的安装命令（避免用户装错环境）。"""
    py = sys.executable or "python"
    return (
        "本地语音识别引擎未安装或加载失败。请在当前后端解释器环境执行：\n"
        f"  {py} -m pip install 'faster-whisper>=1.0.0' 'ctranslate2>=4.0.0'\n"
        "若提示缺少系统库（如 libomp/libz），macOS 上请 `brew install libomp`；"
        "Linux 上请安装对应 apt/yum 包。首次运行需自动下载模型权重（base ≈ 140MB），"
        "请确保磁盘与网络可用。"
    )


def is_fast_whisper_available() -> bool:
    """轻量级探活：检测 faster-whisper 是否可导入（不加载模型，毫秒级）。

    捕获到异常时会将错误类型、消息与 Traceback 缓存到模块变量 `_last_probe_error`，
    调用方可通过 `get_last_probe_error()` 读取，便于区分：
      - ModuleNotFoundError：依赖未安装或装错解释器
      - ImportError：缺少 libomp / CUDA / libz 等底层动态库
      - 其他加载时异常（如 ctranslate2 binary 与 CPU 架构不匹配）
    """
    global _last_probe_error
    try:
        import faster_whisper  # noqa: F401
        _last_probe_error = None
        return True
    except Exception as err:  # noqa: BLE001
        _last_probe_error = (
            type(err).__name__,
            str(err),
            traceback.format_exc(),
        )
        return False


def get_last_probe_error() -> Optional[Tuple[str, str, str]]:
    """返回最近一次 `is_fast_whisper_available()` 失败的 (错误类型, 消息, Traceback)。"""
    return _last_probe_error


def get_install_hint() -> str:
    """对外暴露安装指引文案（基于当前解释器动态生成）。"""
    return _install_hint_for_current_interpreter()


def _load_model(
    model_name: str,
    device: str,
    compute_type: str,
    *,
    cpu_threads: int = 0,
    log_callback: Optional[Callable[[str], None]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Any:
    """按 (model_name, device, compute_type, cpu_threads) 加载并缓存 WhisperModel。

    首次加载会触发 HuggingFace 权重下载（base≈140MB / medium≈1.5GB / large≈3GB）。
    为了避免"无反馈静默"假死体验（HF 下载本身不透出 tqdm 到我们的回调链），
    这里起一个看门狗线程：每 3 秒扫一次缓存目录，把已下载 / .incomplete 字节数
    以日志 + progress 的形式回推给上层。同参数模型仅加载一次，后续调用直接命中缓存。
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError as err:
        raise RuntimeError(_install_hint_for_current_interpreter()) from err
    except Exception as err:  # noqa: BLE001
        raise RuntimeError(
            f"本地语音识别引擎加载失败：{err}\n\n{_install_hint_for_current_interpreter()}"
        ) from err

    key = (model_name, device, compute_type, str(cpu_threads))

    # 命中缓存直接返回；避免在持锁路径中启动无意义的看门狗
    cached = _MODEL_CACHE.get(key)
    if cached is not None:
        return cached

    with _MODEL_LOCK:
        # double-checked locking：进入临界区后复查，避免并发重复构造
        cached = _MODEL_CACHE.get(key)
        if cached is not None:
            return cached

        stop_evt = threading.Event()
        # 预估总下载字节数（查表）；未知时为 0 → 日志不附 "预估" / 进度走时间平滑兜底
        expected_bytes = _estimated_total_bytes(model_name)

        # 在看门狗启动前一次性告知缓存路径与命中情况，方便用户：
        #   1) 下载慢时自行检查该目录磁盘空间 / 网络
        #   2) 已缓存场景下确认不会触发额外下载
        already_cached = is_model_cached(model_name)
        if log_callback is not None:
            try:
                cache_hint = _hf_repo_dir(model_name)
                if already_cached:
                    log_callback(f"📦 使用本地缓存 | {cache_hint}")
                else:
                    expected_mb = expected_bytes / 1024 / 1024 if expected_bytes else 0
                    size_str = f"预估 {expected_mb:.0f} MB" if expected_mb else "大小未知"
                    log_callback(
                        f"📦 模型未缓存，将下载至 {_hf_hub_cache_dir()} | {size_str}"
                    )
            except Exception:  # noqa: BLE001
                pass

        def _safe_log(msg: str) -> None:
            if log_callback is None:
                return
            try:
                log_callback(msg)
            except Exception:  # noqa: BLE001
                pass

        def _safe_progress(ratio: float, msg: str) -> None:
            if progress_callback is None:
                return
            try:
                progress_callback(max(0.0, min(1.0, ratio)), msg)
            except Exception:  # noqa: BLE001
                pass

        def _watcher() -> None:
            """周期性上报下载 / 加载进度，直到主线程完成 WhisperModel 构造。

            三种状态对应三种日志格式：
              * 下载中    → "⏳ 正在下载模型 | 已就绪 X MB / 预估 Y MB (Z%) | 已用 Ts"
              * 初始化    → "⏳ 初始化模型中 | 权重 X MB | 已用 Ts"
              * 元数据    → "⏳ 加载模型中 | 已用 Ts"
            进度条策略：
              * 下载中且预估已知 → 直接映射 (done / expected)，上限 0.18
              * 否则            → 时间平滑曲线 elapsed/(elapsed+60) * 0.15
            """
            start_ts = time.perf_counter()
            last_total = -1
            # 启动延迟：模型已缓存时 WhisperModel 构造 <1s，不需要刷心跳
            if stop_evt.wait(3.0):
                return
            while not stop_evt.is_set():
                done, pending = _scan_model_cache_bytes(model_name)
                total_now = done + pending
                elapsed = time.perf_counter() - start_ts

                if pending > 0 and total_now != last_total:
                    ready_mb = total_now / 1024 / 1024
                    if expected_bytes > 0:
                        expected_mb = expected_bytes / 1024 / 1024
                        pct = min(99, int(total_now / expected_bytes * 100))
                        _safe_log(
                            f"⏳ 正在下载模型 | 已就绪 {ready_mb:.0f} MB / 预估 {expected_mb:.0f} MB "
                            f"({pct}%) | 已用 {elapsed:.0f}s"
                        )
                    else:
                        _safe_log(
                            f"⏳ 正在下载模型 | 已就绪 {ready_mb:.0f} MB | 已用 {elapsed:.0f}s"
                        )
                    last_total = total_now
                elif pending == 0 and done > 0:
                    _safe_log(
                        f"⏳ 初始化模型中 | 权重 {done / 1024 / 1024:.0f} MB | 已用 {elapsed:.0f}s"
                    )
                else:
                    _safe_log(f"⏳ 加载模型中 | 已用 {elapsed:.0f}s")

                # 进度映射：优先用真实下载百分比，退化到时间平滑曲线
                # 上层 pipeline 把 ratio∈[0,1] 映射到 0.32→0.50 条段；这里把天花板压在 0.18，
                # 对应 UI 进度 ~0.352，给真正解码留出空间。
                if expected_bytes > 0 and total_now > 0:
                    ratio = min(0.18, total_now / expected_bytes * 0.18)
                    _safe_progress(ratio, f"下载模型 | {elapsed:.0f}s")
                else:
                    smooth = elapsed / (elapsed + 60.0)  # 60s→0.5, 300s→0.83
                    _safe_progress(smooth * 0.15, f"加载模型中 | {elapsed:.0f}s")

                stop_evt.wait(3.0)

        watcher = threading.Thread(target=_watcher, name="whisper-load-watcher", daemon=True)
        watcher.start()
        try:
            effective_threads = cpu_threads if cpu_threads > 0 else min(os.cpu_count() or 4, 8)
            model = WhisperModel(model_name, device=device, compute_type=compute_type, cpu_threads=effective_threads)
        finally:
            stop_evt.set()
            watcher.join(timeout=1.0)
        _MODEL_CACHE[key] = model
        return model


def _default_compute_type(device: str) -> str:
    """CPU 下默认 int8（典型 2~4x 提速、质量几乎无损）；GPU 下默认 float16。"""
    d = (device or "cpu").lower()
    if d.startswith("cuda") or d == "gpu":
        return "float16"
    return "int8"


def transcribe_file_with_fast_whisper(
    file_path: str | Path,
    *,
    model_name: str = "base",
    device: str = "cpu",
    compute_type: str = "",
    language: str = "",
    initial_prompt: str = "",
    log_callback: Optional[Callable[[str], None]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    return_segments: bool = False,
    # R4.8: ASR 加速参数
    cpu_threads: int = 0,
    beam_size: int = 5,
    vad_filter: bool = True,
) -> "str | tuple[str, list[dict[str, Any]], float]":
    """转录本地音/视频文件（直接交给 ffmpeg 解码，免去读整段二进制进内存）。

    参数：
        file_path：音频或视频文件绝对/相对路径
        model_name：Whisper 模型尺寸（tiny/base/small/medium/large-v3/large-v3-turbo 等）
        device：计算设备（cpu/cuda）
        compute_type：ctranslate2 量化类型；空串表示按 device 自动挑选（cpu=int8, gpu=float16）
        language：ISO-639-1 语言码；空串表示交给 whisper 自动检测
        initial_prompt：转录前置提示词，提升专有名词识别率
        log_callback：可选日志回调，会在模型加载/首段落/每 5 秒进度点回推 message
        progress_callback：可选进度回调 (ratio, message)，ratio ∈ [0, 1]
        cpu_threads：CPU 线程数（0=自动，按 os.cpu_count() 上限 8）
        beam_size：beam search 宽度（1=贪心最快，5=默认最准）
        vad_filter：是否启用 Silero VAD 预过滤静默段（默认开）

    返回：拼接后的转录文本（段落以 \\n 连接）；return_segments=True 时返回 (text, segments, duration_sec)
    """
    def _emit_log(msg: str) -> None:
        if log_callback is not None:
            try:
                log_callback(msg)
            except Exception:  # noqa: BLE001 -- 上层回调不应影响转录主链
                pass

    def _emit_progress(ratio: float, msg: str) -> None:
        if progress_callback is not None:
            try:
                progress_callback(max(0.0, min(1.0, float(ratio))), msg)
            except Exception:  # noqa: BLE001
                pass

    ct = compute_type or _default_compute_type(device)
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"转录文件不存在: {path}")

    # 无音轨视频（纯画面录屏等）会触发 faster-whisper "tuple index out of range"，
    # 提前检测后优雅返回空，由上层决定是否用截帧产出兜底。
    if not _has_audio_stream(path):
        _emit_log("🔇 视频无音轨，跳过语音转写")
        if return_segments:
            return ("", [], 0.0)
        return ""

    effective_threads = cpu_threads if cpu_threads > 0 else min(os.cpu_count() or 4, 8)
    _emit_log(
        f"🧠 加载 Whisper 模型 | size={model_name} device={device} compute_type={ct} "
        f"cpu_threads={effective_threads} beam_size={beam_size} vad={'ON' if vad_filter else 'OFF'}"
    )
    t0 = time.perf_counter()
    # 把 log/progress 回调下推到 _load_model：HF 首次下载期间会由看门狗线程回推 .incomplete 大小 + 心跳
    model = _load_model(
        model_name,
        device,
        ct,
        cpu_threads=cpu_threads,
        log_callback=log_callback,
        progress_callback=progress_callback,
    )
    _emit_log(f"✅ 模型就绪 | 耗时 {time.perf_counter() - t0:.1f}s")

    # 允许 initial_prompt 为空字符串时不传；language 为空字符串或 "auto" 时让 whisper 自动检测
    transcribe_kwargs: dict[str, Any] = {}
    effective_lang = "" if language in ("", "auto") else language
    if effective_lang:
        transcribe_kwargs["language"] = effective_lang
    if initial_prompt:
        transcribe_kwargs["initial_prompt"] = initial_prompt

    # R4.8: beam search 宽度
    transcribe_kwargs["beam_size"] = beam_size

    # R4.8: Silero VAD 预过滤静默段
    if vad_filter:
        transcribe_kwargs["vad_filter"] = True
        transcribe_kwargs["vad_parameters"] = {
            "min_silence_duration_ms": 2000,
            "speech_pad_ms": 400,
        }

    # R4.8: GPU 自动走 BatchedInferencePipeline（并行处理多窗口，2-4x 提速）
    if device.startswith("cuda") or device == "gpu":
        try:
            from faster_whisper import BatchedInferencePipeline
            _batched = BatchedInferencePipeline(model=model)
            segments, info = _batched.transcribe(str(path), batch_size=16, **transcribe_kwargs)
            _emit_log("⚡ GPU batch 模式 | batch_size=16")
        except Exception:
            # batch 模式不可用时回退到普通模式
            segments, info = model.transcribe(str(path), **transcribe_kwargs)
    else:
        segments, info = model.transcribe(str(path), **transcribe_kwargs)

    total = float(getattr(info, "duration", 0.0) or 0.0)
    detected_lang = getattr(info, "language", "") or ""
    _emit_log(f"🎙️ 开始解码 | duration={total:.1f}s language={detected_lang or 'auto'}")

    parts: List[str] = []
    seg_dicts: List[Dict[str, Any]] = [] if return_segments else []
    last_log_ts = 0.0
    for idx, seg in enumerate(segments):
        text = str(getattr(seg, "text", "")).strip()
        if text:
            parts.append(text)
            if return_segments:
                seg_dicts.append({
                    "start": float(getattr(seg, "start", 0.0) or 0.0),
                    "end": float(getattr(seg, "end", 0.0) or 0.0),
                    "text": text,
                })
        end = float(getattr(seg, "end", 0.0) or 0.0)
        # 节流：每 5 秒 wall-clock 最多推一次进度/日志，避免刷爆 task.log
        now = time.perf_counter()
        if total > 0 and now - last_log_ts >= 5.0:
            ratio = min(0.99, end / total) if total > 0 else 0.0
            _emit_progress(ratio, f"转录中 {end:.1f}/{total:.1f}s")
            _emit_log(f"… {idx + 1} 段 | {end:.1f}/{total:.1f}s")
            last_log_ts = now

    _emit_progress(1.0, "转录完成")
    text_out = "\n".join(parts).strip()

    # 繁→简后处理：Whisper 中文输出有时是繁体，统一转简体
    if text_out and detected_lang.startswith("zh"):
        try:
            from opencc import OpenCC
            _cc = OpenCC("t2s")
            text_out = _cc.convert(text_out)
            if return_segments:
                for seg_d in seg_dicts:
                    seg_d["text"] = _cc.convert(seg_d.get("text", ""))
        except Exception:
            pass  # opencc 不可用时静默跳过，保留原始文本

    if return_segments:
        return text_out, seg_dicts, total
    return text_out


def transcribe_with_fast_whisper(
    audio_bytes: bytes,
    *,
    model_name: str = "base",
    device: str = "cpu",
    language: str = "zh",
    initial_prompt: str = "",
) -> str:
    """兼容旧调用方：字节流版本（`transcript_service` 的 URL 转录链路使用）。

    内部落 tempfile 后转调 `transcribe_file_with_fast_whisper`，避免两套实现漂移。
    新代码请优先使用 `transcribe_file_with_fast_whisper` 以跳过 bytes 中转。
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
        tmp.write(audio_bytes)
        tmp_path = Path(tmp.name)
    try:
        return transcribe_file_with_fast_whisper(
            tmp_path,
            model_name=model_name,
            device=device,
            language=language,
            initial_prompt=initial_prompt,
        )
    finally:
        tmp_path.unlink(missing_ok=True)
