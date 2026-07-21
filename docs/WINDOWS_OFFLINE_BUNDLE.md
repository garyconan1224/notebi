# Windows 源码离线懒人包

## 目标

这个包面向“解压后直接使用”和“拿到华为内网继续改代码”两个场景。它不是封闭式 EXE，而是完整源码加可替换的运行环境，因此可以直接修改 Python、React、启动脚本和模型适配代码。

## 包内结构

```text
NoteBi-Windows-x64-offline/
├── start-notebi.bat
├── stop-notebi.bat
├── backend/
├── frontend/
│   └── dist/
├── shared/
├── scripts/
├── runtime/
│   ├── python/
│   └── ffmpeg/bin/
├── models/
│   ├── .cache/hub/
│   ├── sherpa/
│   └── manifest.json
├── BUNDLE_MANIFEST.json
└── logs/
```

`data/`、`.local/` 和 `logs/` 是运行时目录，不应从开发机复制用户数据进包。模型清单只记录模型文件相对路径、SHA256 和是否必需。

## 构建原则

构建机可以联网准备依赖和模型，华为内网运行机不需要联网。构建脚本只做复制、哈希和压缩，不执行 pip、npm、Hugging Face 或 ModelScope 下载。

打包前必须先在源码目录执行 `./build-notebi.sh`，它会把前端编译为带 NoteBi build marker 的产物；不能直接使用缺少该标记（或用旧方式生成）的 `frontend/dist`。

```bash
python scripts/build_windows_offline_bundle.py \
  --source-root . \
  --output ./release/NoteBi-Windows-x64-offline \
  --runtime /path/to/windows-runtime \
  --models /path/to/windows-models \
  --zip ./release/NoteBi-Windows-x64-offline.zip
```

参数说明：

- `--runtime`：已经准备好的 Windows 运行时目录，必须包含 `python/python.exe` 和 `ffmpeg/bin/ffmpeg.exe`、`ffprobe.exe`。
- `--models`：已经准备好的模型目录；可以是 Hugging Face 缓存，也可以包含 sherpa-onnx 模型目录。
- `--output`：未存在的输出目录。为了避免误删用户文件，脚本不会覆盖已有目录。
- `--zip`：可选的 ZIP 路径。

## 模型目录注意事项

懒人包不会因为“模型文件放在 models 目录”就自动改变 NoteBi 的模型语义。当前代码使用既有模型加载方式：

- faster-whisper / Hugging Face 模型放到 `models/.cache/hub`，启动器会把 `HF_HOME` 和 `HF_HUB_CACHE` 指向这里。
- Windows ZIP 使用 `snapshots/<revision>/` 下的普通文件快照，不依赖符号链接；预检和 ASR 状态检查会识别这种离线布局。
- sherpa-onnx 说话人模型放到 `models/sherpa`，启动器会通过已有的 `NOTEBI_SHERPA_MODEL_DIR` 环境变量指向这里。
- Chat、Embedding、Rerank 模型仍通过现有「设置 → 模型与渠道」配置，不改 provider 结构。

第一次制作内网包时，应在联网构建机上用与发行包相同的 Python 和依赖版本预热模型缓存，然后复制缓存并运行预检。不要只复制一个模型名称字符串。

## 启动流程

双击 `start-notebi.bat` 后：

1. 检查 runtime、前端构建产物和模型清单。
2. 校验模型 SHA256。
3. 设置 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`、`HF_DATASETS_OFFLINE=1`。
4. 启动 FastAPI 后端和 Python 静态前端服务。
5. 等待 `/health` 后打开浏览器。

任何预检失败都会停止启动，并提示查看 `logs/backend.log` 和 `logs/frontend.log`。

停止方式：双击 `stop-notebi.bat`。它只停止由当前包记录的进程，不会扫描或终止其他 Python 进程。

## 内网适配

推荐把 Windows 包作为客户端，昇腾模型服务放在内网 Linux/昇腾节点。拿到内网后可以直接修改源码、替换 runtime、替换 `models` 或调整启动脚本；不需要重新打包成 EXE。

如果要把 NoteBi 后端本身运行在昇腾 Linux 节点，应使用 Linux 的源码启动方式或容器部署，不要把 Windows `.bat` 当作 Linux 启动器。
