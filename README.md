<h1 align="center">NoteBi</h1>

<p align="center"><i>本地优先的 AI 多媒体笔记工具 · 把视频、音频、图文和文字整理成可编辑的结构化笔记</i></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img src="https://img.shields.io/badge/frontend-React%2019-blue" />
  <img src="https://img.shields.io/badge/backend-FastAPI-green" />
  <img src="https://img.shields.io/badge/python-3.11%2B-yellow" />
  <img src="https://img.shields.io/badge/local--first-%E2%9C%93-success" />
</p>

---

## NoteBi 是什么

NoteBi 是一个本地优先的内容笔记工具。它可以导入本地视频、音频、图片、文字或公开内容链接，完成转写、说话人识别、字幕翻译、结构化总结和多格式导出。

默认情况下，素材、笔记、模型缓存和运行日志都保存在本机。NoteBi 不会把本地文件自动上传到项目维护者的服务器；是否调用第三方模型服务，由使用者自己在设置中配置。

> 本项目处于持续开发阶段。请遵守第三方平台条款、素材版权、模型许可证和所在地法律法规。

## 功能

- 视频、音频、图片、文字和公开链接导入
- 本地语音转写、字幕编辑和字幕翻译
- 说话人识别、说话人改名和角色标注
- 普通总结与区分说话人的会议、访谈、客户接待等总结
- 总结版本保留、时间点跳转和原始素材回看
- Markdown、HTML、PDF、Word、Obsidian 等导出
- 本地知识库、向量检索和跨笔记问答
- OpenAI-compatible 模型服务配置
- 支持把 Chat、Embedding、Rerank 分别配置到不同服务
- 支持通过内网地址接入华为昇腾模型服务

## 运行方式选择

| 方式 | 适用对象 | 运行条件 |
|---|---|---|
| 源码模式 | 开发者、需要改代码的人 | Python、Node.js、FFmpeg |
| Windows 离线懒人包 | 不想安装开发环境、需要内网运行的人 | 解压后的内置 runtime 和模型 |
| 昇腾内网模式 | 使用华为内网模型的人 | NoteBi 客户端 + 内网 OpenAI-compatible 服务 |

Windows 懒人包保留完整源码，不把业务封装进不可修改的 EXE。详见 [Windows 离线懒人包说明](docs/WINDOWS_OFFLINE_BUNDLE.md)。

## 快速开始：macOS

### 环境要求

- macOS 12+
- Python 3.11+
- Node.js 18+
- FFmpeg
- 可访问的模型服务，或已经准备好的本地模型缓存

首次安装依赖：

```bash
./start-notebi.command
```

开发启动：

```bash
./dev-notebi.sh
```

启动后访问：

```text
http://localhost:5181
```

停止：

```bash
./stop-notebi.command
```

完整 macOS 说明见 [INSTALL_MACOS.md](docs/INSTALL_MACOS.md)。当前 macOS 启动器会检查并安装开发依赖，因此不适合华为内网。华为内网请使用 Windows 离线包或按照 [昇腾内网说明](docs/ASCEND_INTRANET.md) 部署。

## 快速开始：Windows 源码模式

完整 Windows 说明见 [INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md)。

源码模式适合需要改 Python、React 或模型适配代码的用户。

### 1. 安装基础环境

安装 Python 3.11、Node.js 18+ 和 FFmpeg，并确保 `python`、`npm`、`ffmpeg` 可以在终端中使用。

### 2. 安装 Python 依赖

在仓库根目录运行：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 3. 安装前端依赖

```powershell
cd frontend
npm install
cd ..
```

### 4. 启动

```text
双击 start-notebi.bat
```

如果没有 `runtime\python\python.exe`，启动器会自动进入源码开发模式，使用 `.venv` 和本机 Node.js。启动日志在 `.local\backend.log`、`.local\frontend.log`。

停止：

```text
双击 stop-notebi.bat
```

## 快速开始：Windows 离线懒人包

正式发行包解压后包含 `runtime\python`、`runtime\ffmpeg`、`frontend\dist` 和 `models`，不需要安装 Node.js，也不需要执行 pip 安装。

```text
解压 NoteBi-Windows-x64-offline.zip
双击 start-notebi.bat
浏览器打开 http://127.0.0.1:5181
```

启动器会：

1. 检查内置 Python、FFmpeg、前端构建产物和模型清单。
2. 校验模型 SHA256。
3. 设置离线环境变量，禁止运行时下载模型。
4. 启动本地 FastAPI 和静态前端服务。
5. 自动打开浏览器并写入 `logs`。

它不会执行 `pip install`、不会访问 Hugging Face 或 ModelScope，也不会修改当前的模型 provider 配置。

## 模型配置

NoteBi 当前的模型配置仍然通过应用内的「设置 → 模型与渠道」完成，配置内容落在本机 `.local/settings.json`。本项目的打包脚本不会复制、覆盖或提交这个文件。

支持的常见配置方式：

- OpenAI-compatible 服务：填写服务地址、模型名和 API Key。
- 本机模型服务：填写 `http://127.0.0.1:<port>/v1`。
- 华为昇腾内网服务：填写内网节点的 OpenAI-compatible 地址和模型名。
- Chat、Embedding、Rerank：可以分别指定不同 provider。

首次启动没有模型服务时，界面仍然可以打开；需要生成总结、翻译或知识库问答时，再配置对应能力的模型。

## 华为昇腾内网

推荐让 Windows NoteBi 作为客户端，把大模型推理放在内网 Linux/昇腾节点：

```text
Windows NoteBi ──内网 HTTP──> 昇腾模型服务
                              ├─ Chat
                              ├─ Embedding
                              └─ Rerank
```

NoteBi 不内置或改写昇腾驱动、CANN、vLLM-Ascend 和现有模型配置。详细部署边界、离线转移流程和配置位置见 [ASCEND_INTRANET.md](docs/ASCEND_INTRANET.md)。

## 开发与验证

```bash
# 后端测试
./.venv/bin/python -m pytest backend/tests -q

# 前端测试与构建
cd frontend
pnpm test --run
pnpm build
cd ..

# 源码树预检
./.venv/bin/python scripts/portable_preflight.py --mode source --root .
```

Windows 离线包构建需要一台可以准备 Windows runtime 和模型缓存的构建机：

```bash
python scripts/build_windows_offline_bundle.py \
  --source-root . \
  --output ./release/NoteBi-Windows-x64-offline \
  --runtime /path/to/prepared/windows-runtime \
  --models /path/to/prepared/models \
  --zip ./release/NoteBi-Windows-x64-offline.zip
```

构建脚本只复制已准备好的文件，不联网下载依赖或模型。完整参数和目录约定见 [WINDOWS_OFFLINE_BUNDLE.md](docs/WINDOWS_OFFLINE_BUNDLE.md)。

## 目录结构

```text
backend/        FastAPI API、任务和处理流程
frontend/       React + TypeScript 前端
shared/         配置、provider、转写、说话人和知识库共享模块
scripts/        预检、启动、静态服务和发行包工具
docs/           安装、开源和内网部署文档
backend/tests/  后端测试
```

## 贡献与安全

- 贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 安全问题见 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中提交密钥、Cookie 或私人素材。
- 支持范围见 [SUPPORT.md](SUPPORT.md)。

## License

[MIT](LICENSE)
