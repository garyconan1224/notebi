# NoteBi 全平台发行路线

> 状态：Windows/Linux 桌面壳、sidecar、模型目录设置和预览构建工作流已进入实现验证；Apple 暂缓。本文不代表任何平台安装包已经通过实机验收。

## 结论

NoteBi 当前是 React 前端加本地 FastAPI 服务，不是原生桌面应用。要提供面向普通用户的 macOS、Windows 和 Linux 安装包，推荐保留现有业务架构，新增一个轻量桌面壳：

```text
Tauri 2 桌面壳
├── 原生安装器（应用目录、许可证）
├── 设置页模型管理器（目录、明确点击下载、切换）
├── frontend/dist
├── NoteBi FastAPI sidecar（各平台原生构建）
├── FFmpeg / FFprobe（各平台独立资产）
├── 用户数据目录
└── 启动门禁（文件校验、/health、前端可读）
```

桌面壳只负责窗口、启动/停止后端、端口与健康检查、日志位置和升级。笔记、转写、总结、知识库和导出仍由现有 FastAPI 与 React 代码提供，避免重写业务。

## 为什么采用 Tauri 2 + Python sidecar

- Tauri 可直接使用现有 Vite 构建产物，不需要重写 React 页面。
- Tauri 的 `externalBin` 支持把 Python API 服务作为 sidecar，并要求按目标架构提供对应二进制。
- 后端使用 PyInstaller `onedir` sidecar，安装时已经展开依赖，避免 `onefile` 首次运行临时解压约 1 GB 内容导致长时间白屏；模型权重不打入 sidecar。
- PyInstaller 不是交叉编译器：Windows 包在 Windows 构建，macOS 包在 macOS 构建，Linux 包在 Linux 构建。
- 安装器不塞入、选择或下载模型权重。应用通过资源检查和 `/health` 后正常打开；用户之后在「设置 → 本地模型」选择目录并明确点击下载。

## 首次安装状态机

```text
欢迎
  ↓
系统预检（架构 / 磁盘 / 权限 / 网络或离线模式）
  ↓
选择应用安装目录 ── 独立检查空间与写权限
  ↓
安装应用 runtime / FFmpeg / sidecar / frontend
  ↓
启动本地后端并等待 /health，同时验证前端资源
  ↓
全部成功 → 启用“打开 NoteBi”
```

任何应用安装或健康检查失败都停留在对应阶段，不打开主页面。模型不属于安装门禁：用户进入应用后在设置页选择目录并点击下载。

### 目录契约

- **应用安装目录**：只保存可替换的程序、runtime、FFmpeg、sidecar 与前端资源；升级时允许原子替换。
- **模型存储目录**：保存按模型 ID / 版本隔离的权重和 manifest，可放在空间更大的磁盘，并在应用升级时继续复用。
- **用户数据目录**：笔记数据库、设置和日志使用系统应用数据目录，不与应用目录或模型目录混放。
- 安装状态只记录目录引用、版本、完成分块和校验结果；不记录 API key 或第三方服务凭据。

### 打开门禁

“打开 NoteBi”默认禁用，只有以下条件同时满足才启用：

1. runtime、FFmpeg、sidecar 和前端资源版本与安装 manifest 一致。
2. 本地后端进程成功启动，`/health` 在超时前返回成功。
3. 前端入口可读取，安装器没有未解决的致命错误。

所有模型都在应用内按需下载。下载失败只影响对应能力，不把已健康启动的 NoteBi 重新判定为安装失败。

## 目标发行资产

| 目标 | GitHub Release 资产 | 最低验收 |
|---|---|---|
| Windows x64 | `NoteBi_<version>_windows-x64-unsigned-preview-setup.exe` | 未签名提示、安装/卸载、FFmpeg、设置页模型下载、导出 |
| Linux x64 | `NoteBi_<version>_linux-x64-preview.AppImage` 与 `.deb`（CPU-only PyTorch） | Ubuntu 实机启动、CPU ASR、远程模型、导出 |
| macOS Apple Silicon / Intel | 后置 `.dmg` | 等 Apple 账号后再接入签名、公证与原生 job |

Linux ARM64、Windows ARM64 和全部 Apple 资产放在后续阶段；先把 Windows/Linux x64 做成可重复构建和可真实验收的版本。

AppImage 在构建前把 Python sidecar、FFmpeg 与许可证文件归档并写入 SHA256 清单，避免 `linuxdeploy` 对静态 FFmpeg 和 PyInstaller 私有库执行 `patchelf`。应用首次启动时校验归档并解包到 NoteBi 用户数据目录，再启动本地服务；模型仍由用户在设置页单独选择目录和点击下载。

## 原生构建矩阵

GitHub Actions 使用各平台原生 runner：

- `windows-latest`：Windows x64。
- `ubuntu-22.04`：Linux x64。
- Apple job 当前不存在；账号通过后再增加 macOS 原生 runner。

每个预览 job 依次完成：锁定 Python / Node / Rust 版本、安装发行依赖、构建前端、构建 Python sidecar、对打包后的 sidecar 执行 `/health` smoke test、校验 FFmpeg SHA256、生成安装包、校验和与 CycloneDX SBOM，然后上传 Actions Artifact。现有前后端测试由独立工作流把关。不得在一个平台伪造另一个平台的构建或验收结果。

## 签名与密钥

- macOS 浏览器下载的应用需要 Developer ID 签名和 Apple 公证，正式发布需要 Apple Developer 账号。
- Windows 未签名安装包通常会触发 SmartScreen；正式公开前应准备代码签名证书或受支持的云签名服务。
- 证书、密码和 API 凭据只进入 GitHub Actions Secrets，不写入仓库、日志、构建缓存或 Release Asset。
- 没有正式证书时只发布清楚标记的预览版，不把 ad-hoc 签名描述成已公证发行版。

## 分批实施

### R0：GitHub 源码上线

1. 私有仓库首次推送并运行现有后端、前端和编译检查。
2. 检查 README、Issue 模板、许可证、历史密钥扫描和仓库大小。
3. 维护者确认后切换为 Public；此阶段不创建虚假的桌面 Release。

### R1：桌面壳最小闭环（实现验证中）

1. 已确认并安装 Rust / Tauri / PyInstaller 发行依赖。
2. 已新增 Tauri 2 壳、Windows/Linux 平台 sidecar 配置和三个目录契约。
3. 已补设置页模型目录保存/GET 回读；模型维持明确点击下载，不进入安装状态机。
4. 启动页在 sidecar `/health` 前阻断主路由；退出时回收由桌面壳启动的子进程。
5. 用真实素材完成一次导入、转写、生成笔记、编辑、导出和重启读回。

### R2：Windows/Linux 原生打包（CI 验证中）

1. 在 Windows/Ubuntu 原生 runner 构建 sidecar 与安装包。
2. 把 FFmpeg 和原生 Python 依赖按平台锁定。
3. 为每个平台执行自定义应用目录、自定义模型目录、暂停续传、校验失败、安装后 `/health`、前端打开和最小 API smoke test。

### R3：Apple、平台实测与正式 Release

1. Apple 账号通过后配置 macOS 签名/公证；Windows 按用户决定继续不做代码签名。
2. 审计模型许可证、版本、SHA256、镜像来源、失败恢复与首次下载遥测边界。
3. 先创建 Draft/Prerelease，完成四平台实机验收后再提升为正式 Release。

## 当前边界

- 不创建 Apple 构建、签名或公证 job。
- 不上传或在安装期下载模型权重。
- Windows 资产必须含 `unsigned-preview`，不能描述成已签名。
- 不宣称 Windows/Linux 已通过实机验收。

## 官方依据

- [Tauri GitHub Actions 发布流程](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri 外部二进制与 sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows 代码签名](https://v2.tauri.app/distribute/sign/windows/)
- [PyInstaller 平台构建边界](https://github.com/pyinstaller/pyinstaller#readme)
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
