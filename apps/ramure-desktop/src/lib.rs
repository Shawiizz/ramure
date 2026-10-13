//! The Ramure desktop application: the window, and the commands the interface calls.

use ramure_git::{Repository, Snapshot};
use std::path::PathBuf;

/// Commits read at once.
const HISTORY_LIMIT: usize = 5000;

#[derive(Debug, thiserror::Error)]
enum CommandError {
    #[error(transparent)]
    Git(#[from] ramure_git::Error),
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// The repository holding `path`: its branches, tags and history.
#[tauri::command(async)]
fn open_repository(path: PathBuf) -> Result<Snapshot, CommandError> {
    Ok(Repository::open(&path)?.snapshot(HISTORY_LIMIT)?)
}

pub fn run() {
    tracing_subscriber::fmt().init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_repository])
        .run(tauri::generate_context!())
        .expect("Ramure could not start");
}
