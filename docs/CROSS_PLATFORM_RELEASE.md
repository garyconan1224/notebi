# NoteBi 全平台发行路线

> 状态：架构与首次安装流程已确认；新增依赖和生产实现仍需按批授权。桌面壳与安装包尚未实现，本文不代表任何平台安装包已经通过实机验收。

## 结论

NoteBi 当前是 React 前端加本地 FastAPI 服务，不是原生桌面应用。要提供面向普通用户的 macOS、Windows 和 Linux 安装包，推荐保留现有业务架构，新增一个轻量桌面壳：

```text
Tauri 2 桌面壳
├── 安装引导（系统预检、两个独立目录、许可证）
├── 模型管理器（下载/导入、断点续传、SHA256）
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
- 后端先使用 PyInstaller `onedir` 或等价的目录式 runtime；重量级模型和动态库不适合一开始压成单文件。
- PyInstaller 不是交叉编译器：Windows 包在 Windows 构建，macOS 包在 macOS 构建，Linux 包在 Linux 构建。
- 在线安装器本身不默认塞入模型权重。用户在安装阶段确认必需/可选模型，安装器先下载所选模型并显示来源、许可证、版本、大小与 SHA256；全部校验完成后才安装并启动应用。内网离线包导入已有模型包，但走相同校验和启动门禁。

## 首次安装状态机

```text
欢迎
  ↓
系统预检（架构 / 磁盘 / 权限 / 网络或离线模式）
  ↓
选择应用安装目录 ── 独立检查空间与写权限
  ↓
选择模型存储目录 ── 独立检查空间与写权限
  ↓
确认模型清单、来源、许可证与预计体积
  ↓
下载或导入模型（暂停 / 继续 / 断点续传 / 重试）
  ↓
manifest + 大小 + SHA256 校验
  ↓
安装应用 runtime / FFmpeg / sidecar / frontend
  ↓
启动本地后端并等待 /health，同时验证前端资源
  ↓
全部成功 → 启用“打开 NoteBi”
```

任何失败都停留在对应阶段，不打开页面，并保留已经校验通过的分块或模型。用户返回修改目录时，安装器应先判断已完成内容能否原地复用，不能无提示重复下载。

### 目录契约

- **应用安装目录**：只保存可替换的程序、runtime、FFmpeg、sidecar 与前端资源；升级时允许原子替换。
- **模型存储目录**：保存按模型 ID / 版本隔离的权重和 manifest，可放在空间更大的磁盘，并在应用升级时继续复用。
- **用户数据目录**：笔记数据库、设置和日志使用系统应用数据目录，不与应用目录或模型目录混放。
- 安装状态只记录目录引用、版本、完成分块和校验结果；不记录 API key 或第三方服务凭据。

### 打开门禁

“打开 NoteBi”默认禁用，只有以下条件同时满足才启用：

1. 本次选择的必需模型全部存在且 SHA256 匹配。
2. runtime、FFmpeg、sidecar 和前端资源版本与安装 manifest 一致。
3. 本地后端进程成功启动，`/health` 在超时前返回成功。
4. 前端入口可读取，安装器没有未解决的致命错误。

可选增强模型允许用户不选择；一旦选择，就必须完成下载和校验后才算本次安装成功。后续在应用内新增可选模型时，沿用同一下载器与校验规则，但不改变首次安装的完成记录。

## 目标发行资产

| 目标 | GitHub Release 资产 | 最低验收 |
|---|---|---|
| macOS Apple Silicon | `NoteBi_<version>_aarch64.dmg` | 签名、公证、启动、ASR、说话人、导出 |
| macOS Intel | `NoteBi_<version>_x64.dmg` | 签名、公证、CPU ASR、远程模型、导出 |
| Windows x64 | `NoteBi_<version>_x64-setup.exe` 或 `.msi` | 签名、安装/卸载、FFmpeg、ASR、说话人、导出 |
| Linux x64 | `NoteBi_<version>_amd64.AppImage` 与 `.deb` | Ubuntu 实机启动、ASR、远程模型、导出 |

Linux ARM64 和 Windows ARM64 放在第二阶段；先把四个主要资产做成可重复构建和可真实验收的版本。

## 原生构建矩阵

GitHub Actions 使用各平台原生 runner：

- `macos-latest`：Apple Silicon；另用 Intel runner 构建 x64。
- `windows-latest`：Windows x64。
- `ubuntu-22.04`：Linux x64。

每个 job 依次完成：锁定 Python / Node / Rust 版本、安装发行依赖、运行前后端测试、构建前端、构建 Python sidecar、生成安装包、启动 smoke test、上传草稿 Release。不得在一个平台伪造另一个平台的构建或验收结果。

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

### R1：桌面壳最小闭环

1. 维护者确认架构并授权新增 Rust / Tauri / PyInstaller 依赖。
2. 新增 Tauri 2 壳和单一开发平台 sidecar，先冻结安装状态机与三个目录契约。
3. 完成系统预检、两个目录选择、模型 manifest、断点续传、SHA256 和错误恢复。
4. 完成安装、启动、退出、后端异常、端口冲突、日志与用户数据目录；验证未完成时绝不打开窗口。
5. 用真实素材完成一次导入、转写、生成笔记、编辑、导出和重启读回。

### R2：四目标原生打包

1. 在各平台原生 runner 构建 sidecar 与安装包。
2. 把 FFmpeg 和原生 Python 依赖按平台锁定。
3. 为每个平台执行自定义应用目录、自定义模型目录、暂停续传、校验失败、安装后 `/health`、前端打开和最小 API smoke test。

### R3：签名、模型与正式 Release

1. 配置 macOS 签名/公证和 Windows 签名。
2. 审计模型许可证、版本、SHA256、镜像来源、失败恢复与首次下载遥测边界。
3. 先创建 Draft/Prerelease，完成四平台实机验收后再提升为正式 Release。

## 本轮不做

- 不安装 Rust、Tauri、PyInstaller 或新的系统依赖。
- 不提交尚不能构建的空工作流。
- 不上传模型权重、Python runtime、FFmpeg 或未签名安装包。
- 不宣称 Windows/Linux 已通过实机验收。

## 官方依据

- [Tauri GitHub Actions 发布流程](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri 外部二进制与 sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows 代码签名](https://v2.tauri.app/distribute/sign/windows/)
- [PyInstaller 平台构建边界](https://github.com/pyinstaller/pyinstaller#readme)
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
