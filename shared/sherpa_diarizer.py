"""Cross-platform offline speaker diarization backed by sherpa-onnx.

The runtime package is installed with NoteBi. Model files are downloaded lazily
from the official k2-fsa release assets and kept outside the repository.
"""

from __future__ import annotations

import json
import hashlib
import os
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import requests

from shared.audio_analyzer import (
    DiarizationError,
    DiarizationResult,
    SpeakerSegment,
)

ProgressCallback = Callable[[float, str], None]

SEGMENTATION_ARCHIVE_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
)
EMBEDDING_MODEL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/"
    "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
)
MODEL_BUNDLE_NAME = "sherpa-onnx-pyannote-segmentation-3-0-3dspeaker"
SEGMENTATION_MODEL_SHA256 = "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d"
EMBEDDING_MODEL_SHA256 = "1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b"


@dataclass(frozen=True)
class SherpaModelPaths:
    segmentation: Path
    embedding: Path


def _report(callback: Optional[ProgressCallback], ratio: float, message: str) -> None:
    if callback:
        callback(max(0.0, min(1.0, ratio)), message)


def _model_root() -> Path:
    configured = os.environ.get("NOTEBI_SHERPA_MODEL_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".cache" / "notebi" / "models" / MODEL_BUNDLE_NAME


def _download(
    url: str,
    destination: Path,
    *,
    callback: Optional[ProgressCallback],
    progress_start: float,
    progress_span: float,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    try:
        with requests.get(url, stream=True, timeout=(15, 300)) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length") or 0)
            downloaded = 0
            with partial.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    output.write(chunk)
                    downloaded += len(chunk)
                    fraction = downloaded / total if total else 0.0
                    _report(
                        callback,
                        progress_start + progress_span * fraction,
                        f"下载说话人模型 {fraction:.0%}" if total else "下载说话人模型...",
                    )
        partial.replace(destination)
    except Exception:
        partial.unlink(missing_ok=True)
        raise


def _extract_segmentation_model(archive: Path, model_dir: Path) -> None:
    expected_names = {"model.int8.onnx", "LICENSE", "README.md"}
    with tarfile.open(archive, mode="r:bz2") as bundle:
        members = {
            Path(member.name).name: member
            for member in bundle.getmembers()
            if member.isfile() and Path(member.name).name in expected_names
        }
        if "model.int8.onnx" not in members or "LICENSE" not in members:
            raise RuntimeError("说话人分段模型压缩包缺少模型或许可证文件")
        for filename, member in members.items():
            source = bundle.extractfile(member)
            if source is None:
                raise RuntimeError(f"无法读取模型文件：{filename}")
            destination = model_dir / filename
            with source, destination.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)


def _write_model_manifest(model_dir: Path) -> None:
    manifest = {
        "segmentation": {
            "name": "pyannote/segmentation-3.0 (sherpa-onnx INT8 conversion)",
            "source": SEGMENTATION_ARCHIVE_URL,
            "license": "MIT",
            "license_source": "https://huggingface.co/pyannote/segmentation-3.0/blob/main/LICENSE",
        },
        "embedding": {
            "name": "3D-Speaker ERes2Net base zh-cn 16k",
            "source": EMBEDDING_MODEL_URL,
            "license": "Apache-2.0",
            "license_source": "https://github.com/modelscope/3D-Speaker/blob/main/LICENSE",
        },
    }
    (model_dir / "MODEL_LICENSES.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _matches_sha256(path: Path, expected: str) -> bool:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest() == expected


def ensure_sherpa_models(
    progress_callback: Optional[ProgressCallback] = None,
) -> SherpaModelPaths:
    model_dir = _model_root()
    model_dir.mkdir(parents=True, exist_ok=True)
    segmentation = model_dir / "model.int8.onnx"
    embedding = model_dir / "3dspeaker_eres2net_base_zh-cn_16k.onnx"

    if segmentation.is_file() and not _matches_sha256(segmentation, SEGMENTATION_MODEL_SHA256):
        segmentation.unlink()
    if embedding.is_file() and not _matches_sha256(embedding, EMBEDDING_MODEL_SHA256):
        embedding.unlink()

    if not segmentation.is_file():
        archive = model_dir / "segmentation.tar.bz2"
        if not archive.is_file():
            _download(
                SEGMENTATION_ARCHIVE_URL,
                archive,
                callback=progress_callback,
                progress_start=0.0,
                progress_span=0.15,
            )
        _report(progress_callback, 0.16, "解压说话人分段模型...")
        _extract_segmentation_model(archive, model_dir)
        archive.unlink(missing_ok=True)
        if not _matches_sha256(segmentation, SEGMENTATION_MODEL_SHA256):
            segmentation.unlink(missing_ok=True)
            raise RuntimeError("说话人分段模型校验失败，请重试下载")

    if not embedding.is_file():
        _download(
            EMBEDDING_MODEL_URL,
            embedding,
            callback=progress_callback,
            progress_start=0.18,
            progress_span=0.42,
        )
        if not _matches_sha256(embedding, EMBEDDING_MODEL_SHA256):
            embedding.unlink(missing_ok=True)
            raise RuntimeError("说话人嵌入模型校验失败，请重试下载")

    _write_model_manifest(model_dir)
    _report(progress_callback, 0.62, "说话人模型已就绪")
    return SherpaModelPaths(segmentation=segmentation, embedding=embedding)


def _load_audio_mono(audio_path: Path, target_sample_rate: int) -> np.ndarray:
    """Load local audio as mono float32, including m4a through librosa fallback."""
    try:
        import soundfile as sf

        audio, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)
        mono = audio[:, 0]
    except Exception:
        import librosa

        mono, sample_rate = librosa.load(
            str(audio_path),
            sr=None,
            mono=True,
            dtype=np.float32,
        )
    if sample_rate != target_sample_rate:
        import librosa

        mono = librosa.resample(
            np.asarray(mono, dtype=np.float32),
            orig_sr=sample_rate,
            target_sr=target_sample_rate,
        )
    return np.ascontiguousarray(mono, dtype=np.float32)


def run_sherpa_diarization(
    audio_path: Path,
    *,
    progress_callback: Optional[ProgressCallback] = None,
    num_speakers: Optional[int] = None,
) -> DiarizationResult:
    engine = "sherpa-onnx"
    model_name = "pyannote-segmentation-3.0-int8+3D-Speaker-ERes2Net"
    try:
        import sherpa_onnx
    except ImportError as err:
        raise DiarizationError(
            "engine_unavailable",
            "sherpa-onnx 未安装，无法执行跨平台说话人分析。",
            engine=engine,
            model=model_name,
        ) from err

    try:
        paths = ensure_sherpa_models(progress_callback)
        threshold = float(os.environ.get("NOTEBI_SHERPA_CLUSTER_THRESHOLD", "0.9"))
        configured_num_speakers = (
            int(num_speakers)
            if num_speakers is not None
            else int(os.environ.get("NOTEBI_DIARIZATION_NUM_SPEAKERS", "-1"))
        )
        num_threads = max(1, int(os.environ.get("NOTEBI_SHERPA_NUM_THREADS", "2")))
        config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                    model=str(paths.segmentation),
                ),
                num_threads=num_threads,
                provider="cpu",
            ),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(paths.embedding),
                num_threads=num_threads,
                provider="cpu",
            ),
            clustering=sherpa_onnx.FastClusteringConfig(
                num_clusters=configured_num_speakers,
                threshold=threshold,
            ),
            min_duration_on=0.3,
            min_duration_off=0.5,
        )
        if not config.validate():
            raise RuntimeError("sherpa-onnx 模型配置校验失败")
        diarizer = sherpa_onnx.OfflineSpeakerDiarization(config)
        _report(progress_callback, 0.64, "读取并重采样音频...")
        audio = _load_audio_mono(audio_path, diarizer.sample_rate)
        _report(progress_callback, 0.70, "根据音色聚类说话人...")

        last_percent = -1

        def on_progress(processed: int, total: int) -> int:
            nonlocal last_percent
            ratio = processed / total if total else 0.0
            percent = min(100, int(ratio * 100))
            if percent > last_percent:
                last_percent = percent
                _report(
                    progress_callback,
                    0.70 + ratio * 0.30,
                    f"说话人分析 {percent}%",
                )
            return 0

        raw_result = diarizer.process(audio, callback=on_progress).sort_by_start_time()
    except DiarizationError:
        raise
    except Exception as err:
        raise DiarizationError(
            "inference_failed",
            f"sherpa-onnx 模型下载、音频解码或推理失败：{err}",
            engine=engine,
            model=model_name,
        ) from err

    segments = [
        SpeakerSegment(
            start=float(item.start),
            end=float(item.end),
            speaker=f"SPEAKER_{int(item.speaker):02d}",
        )
        for item in raw_result
    ]
    speakers = {segment.speaker for segment in segments}
    _report(progress_callback, 1.0, f"说话人分析完成，共 {len(speakers)} 人")
    return DiarizationResult(
        num_speakers=len(speakers),
        segments=segments,
        engine=engine,
        model=model_name,
    )
