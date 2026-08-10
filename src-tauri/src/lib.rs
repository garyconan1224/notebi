use serde::Serialize;
use std::ffi::OsString;
use std::fs::OpenOptions;
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
    let tool_dir = resource_root.join("resources");
    let path = prepend_path(&tool_dir)?;

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

            let backend_dir = tool_dir.join("backend");
            #[cfg(target_os = "windows")]
            let executable = backend_dir.join("notebi-backend.exe");
            #[cfg(not(target_os = "windows"))]
            let executable = backend_dir.join("notebi-backend");
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
