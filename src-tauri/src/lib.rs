use serde::Serialize;
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const BACKEND_URL: &str = "http://127.0.0.1:8001";
const HEALTH_URL: &str = "http://127.0.0.1:8001/health";

#[derive(Default)]
struct BackendState {
    child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapResult {
    status: &'static str,
    backend_url: &'static str,
}

async fn backend_is_healthy(client: &reqwest::Client) -> bool {
    match client.get(HEALTH_URL).send().await {
        Ok(response) if response.status().is_success() => response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| {
                body.get("status")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .is_some_and(|status| status == "healthy"),
        _ => false,
    }
}

fn prepend_path(tool_dir: &Path) -> Result<OsString, String> {
    let mut entries = vec![tool_dir.to_path_buf()];
    if let Some(current) = std::env::var_os("PATH") {
        entries.extend(std::env::split_paths(&current));
    }
    std::env::join_paths(entries).map_err(|error| format!("无法配置 FFmpeg 路径: {error}"))
}

fn ensure_runtime_dirs(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位 NoteBi 用户数据目录: {error}"))?;
    let data_dir = root.join("data");
    let state_dir = root.join("state");
    let projects_dir = root.join("projects");
    for directory in [&data_dir, &state_dir, &projects_dir] {
        std::fs::create_dir_all(directory)
            .map_err(|error| format!("无法创建目录 {}: {error}", directory.display()))?;
    }
    Ok((data_dir, state_dir, projects_dir))
}

fn backend_executable(tool_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        tool_dir.join("backend/notebi-backend.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        tool_dir.join("backend/notebi-backend")
    }
}

fn runtime_has_required_tools(tool_dir: &Path) -> bool {
    #[cfg(target_os = "windows")]
    let media_tools = [tool_dir.join("ffmpeg.exe"), tool_dir.join("ffprobe.exe")];
    #[cfg(not(target_os = "windows"))]
    let media_tools = [tool_dir.join("ffmpeg"), tool_dir.join("ffprobe")];

    backend_executable(tool_dir).is_file() && media_tools.iter().all(|path| path.is_file())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("无法打开运行时归档 {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("无法读取运行时归档 {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn runtime_manifest_digest(path: &Path) -> Result<String, String> {
    let contents = std::fs::read_to_string(path)
        .map_err(|error| format!("无法读取运行时校验文件 {}: {error}", path.display()))?;
    let digest = contents
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("运行时校验文件格式无效: {}", path.display()));
    }
    Ok(digest)
}

fn install_runtime_archive(
    archive_path: &Path,
    manifest_path: &Path,
    install_root: &Path,
) -> Result<PathBuf, String> {
    let expected_digest = runtime_manifest_digest(manifest_path)?;
    let actual_digest = sha256_file(archive_path)?;
    if actual_digest != expected_digest {
        return Err(format!(
            "NoteBi 运行时归档校验失败: expected={expected_digest} actual={actual_digest}"
        ));
    }

    let install_dir = install_root.join(&expected_digest);
    if runtime_has_required_tools(&install_dir) {
        return Ok(install_dir);
    }

    std::fs::create_dir_all(install_root)
        .map_err(|error| format!("无法创建运行时安装目录 {}: {error}", install_root.display()))?;
    let staging_dir =
        install_root.join(format!(".{expected_digest}.{}-staging", std::process::id()));
    if staging_dir.exists() {
        std::fs::remove_dir_all(&staging_dir).map_err(|error| {
            format!("无法清理运行时临时目录 {}: {error}", staging_dir.display())
        })?;
    }
    std::fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("无法创建运行时临时目录 {}: {error}", staging_dir.display()))?;

    let unpack_result = (|| -> Result<(), String> {
        let archive_file = File::open(archive_path)
            .map_err(|error| format!("无法打开运行时归档 {}: {error}", archive_path.display()))?;
        tar::Archive::new(archive_file)
            .unpack(&staging_dir)
            .map_err(|error| format!("无法解包 NoteBi 运行时: {error}"))?;
        if !runtime_has_required_tools(&staging_dir) {
            return Err("NoteBi 运行时归档缺少后端或 FFmpeg 文件".to_string());
        }
        Ok(())
    })();
    if let Err(error) = unpack_result {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(error);
    }

    match std::fs::rename(&staging_dir, &install_dir) {
        Ok(()) => Ok(install_dir),
        Err(_) if runtime_has_required_tools(&install_dir) => {
            let _ = std::fs::remove_dir_all(&staging_dir);
            Ok(install_dir)
        }
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging_dir);
            Err(format!(
                "无法启用 NoteBi 运行时目录 {}: {error}",
                install_dir.display()
            ))
        }
    }
}

fn resolve_tool_dir(packaged_tool_dir: &Path, state_dir: &Path) -> Result<PathBuf, String> {
    if runtime_has_required_tools(packaged_tool_dir) {
        return Ok(packaged_tool_dir.to_path_buf());
    }

    let archive_path = packaged_tool_dir.join("runtime.tar");
    let manifest_path = packaged_tool_dir.join("runtime.tar.sha256");
    if archive_path.is_file() && manifest_path.is_file() {
        let app_root = state_dir
            .parent()
            .ok_or_else(|| "无法定位 NoteBi 运行时安装目录".to_string())?;
        return install_runtime_archive(&archive_path, &manifest_path, &app_root.join("runtime"));
    }

    Err(format!(
        "NoteBi 本地运行时文件缺失: {}",
        packaged_tool_dir.display()
    ))
}

#[tauri::command]
async fn bootstrap_backend(
    app: tauri::AppHandle,
    state: State<'_, BackendState>,
) -> Result<BootstrapResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("无法创建健康检查客户端: {error}"))?;

    if backend_is_healthy(&client).await {
        return Ok(BootstrapResult {
            status: "ready",
            backend_url: BACKEND_URL,
        });
    }

    let (data_dir, state_dir, projects_dir) = ensure_runtime_dirs(&app)?;
    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录: {error}"))?;
    let packaged_tool_dir = resource_root.join("resources");

    {
        let mut child_guard = state
            .child
            .lock()
            .map_err(|_| "本地服务状态锁已损坏".to_string())?;
        let needs_spawn = match child_guard.as_mut() {
            Some(child) => !matches!(child.try_wait(), Ok(None)),
            None => true,
        };
        if needs_spawn {
            if let Some(mut stale_child) = child_guard.take() {
                let _ = stale_child.kill();
                let _ = stale_child.wait();
            }

            let tool_dir = resolve_tool_dir(&packaged_tool_dir, &state_dir)?;
            let path = prepend_path(&tool_dir)?;
            let executable = backend_executable(&tool_dir);
            if !executable.is_file() {
                return Err(format!("NoteBi 本地服务文件缺失: {}", executable.display()));
            }

            let log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(state_dir.join("backend.log"))
                .map_err(|error| format!("无法打开后端日志: {error}"))?;
            let stderr = log
                .try_clone()
                .map_err(|error| format!("无法复制后端日志句柄: {error}"))?;
            let mut command = Command::new(executable);
            command
                .args(["--host", "127.0.0.1", "--port", "8001"])
                .env("NOTEBI_DATA_DIR", &data_dir)
                .env("NOTEBI_STATE_DIR", &state_dir)
                .env("NOTEBI_PROJECTS_DIR", &projects_dir)
                .env(
                    "CORS_ALLOW_ORIGINS",
                    "http://tauri.localhost,tauri://localhost,http://localhost:5181,http://127.0.0.1:5181",
                )
                .env("PATH", path)
                .stdin(Stdio::null())
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(stderr));
            #[cfg(target_os = "windows")]
            command.creation_flags(0x08000000);

            let child = command
                .spawn()
                .map_err(|error| format!("NoteBi 本地服务启动失败: {error}"))?;
            *child_guard = Some(child);
        }
    }

    for _ in 0..90 {
        if backend_is_healthy(&client).await {
            return Ok(BootstrapResult {
                status: "ready",
                backend_url: BACKEND_URL,
            });
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Err("本地服务在 45 秒内未通过健康检查。请重试并查看应用日志。".to_string())
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![bootstrap_backend])
        .build(tauri::generate_context!())
        .expect("error while building NoteBi desktop application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Ok(mut guard) = app_handle.state::<BackendState>().child.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn append_file(builder: &mut tar::Builder<File>, path: &str, contents: &[u8]) {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, path, contents)
            .expect("append runtime file");
    }

    fn required_test_paths() -> [&'static str; 3] {
        #[cfg(target_os = "windows")]
        {
            ["backend/notebi-backend.exe", "ffmpeg.exe", "ffprobe.exe"]
        }
        #[cfg(not(target_os = "windows"))]
        {
            ["backend/notebi-backend", "ffmpeg", "ffprobe"]
        }
    }

    fn make_runtime_archive(root: &Path) -> (PathBuf, PathBuf) {
        let archive_path = root.join("runtime.tar");
        let file = File::create(&archive_path).expect("create runtime archive");
        let mut builder = tar::Builder::new(file);
        for path in required_test_paths() {
            append_file(&mut builder, path, path.as_bytes());
        }
        builder.finish().expect("finish runtime archive");

        let digest = sha256_file(&archive_path).expect("hash runtime archive");
        let manifest_path = root.join("runtime.tar.sha256");
        let mut manifest = File::create(&manifest_path).expect("create digest manifest");
        writeln!(manifest, "{digest}  runtime.tar").expect("write digest manifest");
        (archive_path, manifest_path)
    }

    #[test]
    fn installs_verified_runtime_archive_and_reuses_it() {
        let temp = tempfile::tempdir().expect("temporary runtime directory");
        let (archive_path, manifest_path) = make_runtime_archive(temp.path());
        let install_root = temp.path().join("installed");

        let first = install_runtime_archive(&archive_path, &manifest_path, &install_root)
            .expect("install verified runtime");
        assert!(runtime_has_required_tools(&first));

        let second = install_runtime_archive(&archive_path, &manifest_path, &install_root)
            .expect("reuse verified runtime");
        assert_eq!(first, second);
    }

    #[test]
    fn rejects_runtime_archive_with_mismatched_digest() {
        let temp = tempfile::tempdir().expect("temporary runtime directory");
        let (archive_path, manifest_path) = make_runtime_archive(temp.path());
        std::fs::write(&manifest_path, format!("{}  runtime.tar\n", "0".repeat(64)))
            .expect("replace digest manifest");

        let error = install_runtime_archive(
            &archive_path,
            &manifest_path,
            &temp.path().join("installed"),
        )
        .expect_err("mismatched digest must fail");
        assert!(error.contains("校验失败"));
    }
}
