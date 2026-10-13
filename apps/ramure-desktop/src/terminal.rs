//! Terminals opened in a repository: a shell in a pseudo-console, its output streamed to
//! the interface as it comes, what is typed written to it.

use crate::programs::{git_bash, on_path};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{Channel, Response};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

static SESSIONS: Mutex<BTreeMap<u32, Session>> = Mutex::new(BTreeMap::new());
static NEXT: AtomicU32 = AtomicU32::new(1);

fn with_session<T>(id: u32, act: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
    let mut sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions.get_mut(&id).ok_or("This terminal is closed.")?;
    act(session)
}

/// The shells a terminal can run on this computer, by the names the settings give them;
/// the system's own choice is always there besides.
#[tauri::command]
pub fn terminal_shells() -> Vec<&'static str> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let mut found = vec!["powershell"];
    if on_path("pwsh.exe").is_some() {
        found.push("pwsh");
    }
    found.push("cmd");
    if git_bash().is_some() {
        found.push("gitBash");
    }
    if on_path("wsl.exe").is_some() {
        found.push("wsl");
    }
    found
}

/// The shell `name` names, opening in `dir`: on Windows the newest PowerShell by default,
/// elsewhere the user's own.
fn shell(name: &str, dir: &Path) -> CommandBuilder {
    if !cfg!(windows) {
        return CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_owned()));
    }
    let name = if name == "auto" {
        if on_path("pwsh.exe").is_some() {
            "pwsh"
        } else {
            "powershell"
        }
    } else {
        name
    };
    match name {
        "cmd" => CommandBuilder::new("cmd.exe"),
        "gitBash" => {
            let mut command = CommandBuilder::new(git_bash().unwrap_or_else(|| PathBuf::from("bash.exe")));
            command.args(["--login", "-i"]);
            command
        }
        "wsl" => {
            let mut command = CommandBuilder::new("wsl.exe");
            command.arg("--cd");
            command.arg(dir);
            command
        }
        powershell => {
            let mut command =
                CommandBuilder::new(if powershell == "pwsh" { "pwsh.exe" } else { "powershell.exe" });
            command.arg("-NoLogo");
            command
        }
    }
}

/// The shell `shell` in the folder `path`, `cols` by `rows` characters; its output goes to
/// `output` in chunks of bytes, then an empty one once it has ended. Answers the
/// terminal's id.
#[tauri::command(async)]
pub fn terminal_open(
    path: PathBuf,
    shell: String,
    cols: u16,
    rows: u16,
    output: Channel<Response>,
) -> Result<u32, String> {
    open(&path, &shell, cols, rows, output).map_err(|e| e.to_string())
}

fn open(
    path: &Path,
    name: &str,
    cols: u16,
    rows: u16,
    output: Channel<Response>,
) -> Result<u32, Box<dyn std::error::Error>> {
    let pair = native_pty_system().openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
    let mut command = shell(name, path);
    command.cwd(path);
    command.env("TERM", "xterm-256color");
    if let Some(ssh) = ramure_git::ssh_command() {
        command.env("GIT_SSH_COMMAND", ssh);
    }
    let child = pair.slave.spawn_command(command)?;
    // the shell holds its end of the console now; ours would keep it open past the shell
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, Session { master: pair.master, writer, child });
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        while let Ok(read @ 1..) = reader.read(&mut buffer) {
            if output.send(Response::new(buffer[..read].to_vec())).is_err() {
                break;
            }
        }
        let _ = output.send(Response::new(Vec::new()));
    });
    Ok(id)
}

/// What was typed, or pasted, in the terminal `id`.
#[tauri::command(async)]
pub fn terminal_write(id: u32, data: String) -> Result<(), String> {
    with_session(id, |session| {
        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|()| session.writer.flush())
            .map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn terminal_resize(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    with_session(id, |session| {
        session
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    })
}

/// Ends the terminal `id` and its shell.
#[tauri::command(async)]
pub fn terminal_close(id: u32) {
    let session = SESSIONS.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    if let Some(mut session) = session {
        let _ = session.child.kill();
    }
}
