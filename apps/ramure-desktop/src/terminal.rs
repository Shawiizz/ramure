//! Terminals opened in a repository: a shell in a pseudo-console, its output streamed to
//! the interface as it comes, what is typed written to it.

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

/// The shell to open: PowerShell on Windows (the newer one when installed), the user's
/// own elsewhere.
fn shell() -> CommandBuilder {
    if cfg!(windows) {
        let newer = std::env::var_os("PATH")
            .is_some_and(|path| std::env::split_paths(&path).any(|dir| dir.join("pwsh.exe").is_file()));
        let mut command = CommandBuilder::new(if newer { "pwsh.exe" } else { "powershell.exe" });
        command.arg("-NoLogo");
        command
    } else {
        CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_owned()))
    }
}

/// A shell in the folder `path`, `cols` by `rows` characters; its output goes to `output`
/// in chunks of bytes, then an empty one once it has ended. Answers the terminal's id.
#[tauri::command(async)]
pub fn terminal_open(path: PathBuf, cols: u16, rows: u16, output: Channel<Response>) -> Result<u32, String> {
    open(&path, cols, rows, output).map_err(|e| e.to_string())
}

fn open(
    path: &Path,
    cols: u16,
    rows: u16,
    output: Channel<Response>,
) -> Result<u32, Box<dyn std::error::Error>> {
    let pair = native_pty_system().openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
    let mut command = shell();
    command.cwd(path);
    command.env("TERM", "xterm-256color");
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
