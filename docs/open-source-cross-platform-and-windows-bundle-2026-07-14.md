# NoteBi 开源跨平台与 Windows 懒人包方案

> 调查日期：2026-07-14
> 范围：Apple macOS、Windows x64、可配置 OpenAI-compatible 模型服务、华为昇腾

## 结论先行

NoteBi 的前端和 FastAPI 本地服务本身适合跨平台，但当前“开发启动方式”还不是跨平台产品：启动器是 Bash/macOS 优先，依赖安装和 FFmpeg 仍依赖用户环境，模型与 Python 原生依赖没有按平台锁定。

用户已确认采用两条发布线：

1. **开源源码线**：macOS / Windows / Linux 都能按文档启动，保留浏览器访问本地服务的模式。
2. **Windows 离线源码包**：只做 Windows，包含完整源码、内置 Python、FFmpeg、前端构建产物和已准备的模型，解压后双击 `.bat` 启动。

Windows 懒人包不做封闭 EXE。可以按体积提供 runtime 包和完整模型包两个 Release Asset；华为内网使用时，也可以把二者合并成一个 ZIP。运行时不下载依赖和模型。

## 当前代码检查结果

已经存在的可复用基础：

- 前端是 Vite 构建的静态 React 页面，后端是 FastAPI，本地通过 `127.0.0.1` 通讯。
- 代码大量使用 `pathlib.Path`，数据根目录可以继续改成用户目录，不必写死 macOS 路径。
- `faster-whisper`、`sherpa-onnx`、WeSpeaker、FAISS 已有跨平台基础；当前依赖生态已有 Windows x64 wheel 或平台支持。
- 模型供应商已经有 OpenAI-compatible 的 `base_url` 入口，适合接入 vLLM、MindIE、llama.cpp、Ollama 等提供兼容接口的服务。

需要在开源前补齐：

- `start-notebi.command`、`start.sh`、`dev-notebi.sh` 是 Bash 启动链，Windows 不能直接使用。
- README 仍把 macOS/Homebrew 作为默认安装路径，Windows 只有手工安装 FFmpeg 的说明。
- `requirements.txt` 把 `marker-pdf`、`pyannote.audio`、`faiss-cpu`、`playwright` 等重量级或带原生扩展的依赖放在一份清单中，首次安装慢，平台失败时也难定位。
- `mlx-whisper` 只适用于 Apple Silicon；这应继续作为 macOS 优化分支，不能成为 Windows 必需依赖。
- `ffmpeg` / `ffprobe`、模型缓存目录、临时目录和用户数据目录需要统一经过运行时路径层解析，不能依赖当前工作目录或 Unix 路径格式。

## 推荐的跨平台分层

### A. 源码运行模式

保留现在的开发方式，但增加平台适配层：

```text
scripts/
  preflight.py              # 统一检查 Python、Node、FFmpeg、模型服务
  run_backend.py            # 跨平台启动 FastAPI，负责路径和端口
  run_frontend.*            # 仅开发环境需要
run-notebi.ps1              # Windows 开发入口
run-notebi.command          # macOS 入口
run-notebi.sh               # Linux 入口
```

源码模式只保证“开发者可运行”，不承诺用户机器上自动装好全部 AI 依赖。依赖按平台拆成：

```text
requirements-core.txt
requirements-macos-arm64.txt
requirements-macos-x64.txt
requirements-windows-x64.txt
requirements-linux-x64.txt
```

其中 `core` 放 FastAPI、HTTP、字幕、文件解析等基础能力；ASR、说话人分析、PDF/OCR、向量库按能力组安装。这样没有 GPU 或不需要 PDF 的用户不会被无关依赖阻塞。

### B. 桌面壳（当前不纳入交付）

Tauri 2 或其他桌面壳可以作为以后可选的产品化方向，但当前不作为验收条件。用户明确需要保留源码、方便拿到华为内网适配，因此第一版使用 `.bat` 和 Python 脚本更合适：

```text
Optional desktop shell
├── bundled frontend/dist
├── NoteBi backend sidecar
├── ffmpeg / ffprobe sidecar
├── user data directory
└── model registry and health check
```

后端 sidecar 的候选实现顺序：

1. 第一版使用“内置 CPython + 已构建 site-packages + 启动参数”，便于排查动态导入和模型插件问题。
2. 稳定后再评估 PyInstaller 单文件/目录包，减少用户可见文件，但不以“单文件”为验收条件。
3. 如果以后采用桌面壳，只负责窗口、启动/停止服务、日志和打包；业务 API 继续由 FastAPI 提供，减少重写范围。

## Windows 懒人包设计

目标是“解压 → 双击 `start-notebi.bat` → 配置模型 → 使用”，建议提供 `NoteBi-Windows-x64-runtime.zip` 和可选的 `NoteBi-Windows-x64-models.zip`；华为内网再提供合并后的完整包：

```text
NoteBi/
├── start-notebi.bat              # 源码可见的一键启动入口
├── stop-notebi.bat
├── runtime/
│   ├── python/                   # 内置 CPython，固定版本
│   ├── backend/                  # FastAPI 与已验证依赖
│   └── ffmpeg/bin/               # ffmpeg.exe / ffprobe.exe
├── frontend/dist/
├── models/
│   ├── manifest.json             # 模型名称、版本、大小、SHA256、许可证
│   ├── asr/                      # 可选本地 ASR 模型
│   └── diarization/              # 可选说话人模型
├── data/                         # 用户笔记、素材、缓存
├── config/
│   ├── models.example.yaml
│   └── models.yaml               # 用户填写，不进 Git
└── logs/
```

首屏只做三项检查：

1. FFmpeg、后端和前端是否启动。
2. 本地 ASR / 说话人模型是否存在；没有则显示“下载模型”或“配置远程服务”。
3. Chat / Summary / Embedding / Rerank 四类模型是否可用，并显示具体失败原因。

模型配置建议统一为：

```yaml
chat:
  provider: openai_compatible
  base_url: http://127.0.0.1:8000/v1
  api_key_env: NOTEBI_CHAT_API_KEY
  model: Qwen3-32B
embedding:
  provider: openai_compatible
  base_url: http://127.0.0.1:8000/v1
  model: bge-m3
rerank:
  provider: openai_compatible
  base_url: http://127.0.0.1:8000/v1
  model: bge-reranker-v2-m3
```

API Key 只从环境变量或本地未跟踪配置读取；懒人包不预置任何真实密钥。

## 模型包策略

### Windows 完整离线包随包提供

- FFmpeg / FFprobe。
- 经过预热并验证的本地 ASR / 说话人模型缓存。
- 模型清单、SHA256 校验和、许可证来源。
- OpenAI-compatible 内网模型服务的配置说明，不包含真实密钥。

### 公开开源仓库默认不随包提供

- 大型 Chat LLM 权重。
- 需要特定 GPU/NPU、驱动、CANN、CUDA 或商业许可的模型。
- 真实 API Key、内网地址和用户数据。

华为内网完整包可以包含经许可的模型权重；公开仓库则只提交构建脚本和模型清单格式。

## 华为昇腾兼容边界

NoteBi 应继续支持昇腾，但要把“支持方式”定义清楚：

- **Windows 客户端**：作为 UI、转写、文件处理和模型配置端，通过局域网/本机端口调用远程 OpenAI-compatible Chat、Embedding、Rerank 服务。
- **昇腾推理节点**：在 Linux + Ascend 驱动/CANN + vLLM Ascend 或 MindIE 上部署模型服务，NoteBi 只填写 `base_url` 和模型名。
- **不把 CANN/vLLM Ascend 直接塞入 Windows 懒人包**：当前 vLLM Ascend 官方项目的前置条件明确写的是 Linux，并依赖 CANN、PyTorch、torch-npu；这与 Windows 原生懒人包不是同一运行目标。
- 如果用户使用的是旧的 Ascend 310 Windows 推理场景，应单独做“Windows + 指定硬件/版本”适配，不把它作为通用昇腾包的默认承诺。

这样既满足昇腾模型兼容，也不会让 Windows 用户被 Linux/NPU 驱动链卡住。

## 发布与验收矩阵

每个版本至少产出：

| 目标 | 运行方式 | 必验收 |
|---|---|---|
| macOS Apple Silicon | `.dmg` / `.app` | 本地 ASR、说话人、远程模型、导出 |
| macOS Intel | `.dmg` / `.app` | Fast-Whisper CPU、远程模型、导出 |
| Windows x64 | `.zip` / 安装包 | 解压启动、FFmpeg、ASR、说话人、导出 |
| Linux x64 | 源码 / Docker | Fast-Whisper、远程模型、导出 |
| Ascend Linux | 源码 / Docker + 远程模型 | vLLM-Ascend 或 MindIE OpenAI-compatible 接口 |

CI 至少做三层：

1. 纯前后端单元测试和构建，不下载大模型。
2. 每个平台的打包启动 smoke test，验证健康检查和基本 UI。
3. 带硬件/模型的手工或 self-hosted runner 验收，不把 GPU/NPU 依赖硬塞进公共 CI。

## 分阶段实施顺序

1. **P1：完成源码跨平台启动入口和 preflight**：macOS、Windows、Linux 的文档和启动方式。
2. **P2：完成 Windows 源码/离线双模式 `.bat`**：源码模式使用 `.venv`，离线模式使用内置 runtime。
3. **P3：完成 Windows offline bundle 构建器**：源码、CPython、FFmpeg、前端、模型清单和 SHA256。
4. **P4：发布 README、开源清单和昇腾内网文档**：不上传密钥、用户数据和内部地址。
5. **P5：维护者确认后再创建 GitHub Release**：上传 Windows runtime 包和华为内网完整包；桌面壳作为以后可选方向。

## 官方依据

- [Tauri 2：Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)：支持把 Python API server 或 PyInstaller 程序作为 sidecar，并按目标架构提供二进制。
- [Python on Windows：The embeddable package](https://docs.python.org/3/using/windows.html#the-embeddable-package)：嵌入式 Python 是面向应用集成的最小 ZIP 运行时，第三方包应由应用构建时随包提供。
- [Microsoft：Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install)：Windows 10 2004+ / Windows 11 可用 `wsl --install` 建立 Linux 运行环境。
- [Microsoft：GPU accelerated ML in WSL](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gpu-compute)：WSL 可承载 NVIDIA CUDA、DirectML 等 GPU 推理路径。
- [vLLM Ascend](https://github.com/vllm-project/vllm-ascend)：当前项目说明的 Ascend 推理环境前置条件为 Linux、CANN、PyTorch 和 torch-npu。
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)：项目列出 Windows、macOS、Linux 以及说话人分离能力，适合作为跨平台本地说话人能力候选。
- [faiss-cpu](https://pypi.org/project/faiss-cpu/)：当前发行版提供 Windows x86-64、macOS 和 Linux 的 CPU wheel，但索引仍需按架构/SIMD 重新验证。
