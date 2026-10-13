//! The Ramure desktop application: the window, and the commands the interface calls.
//! Every command names the repository by its path; those that change it answer with its
//! new state.

use ramure_git::{actions, Change, FileDiff, Identity, Repository, Side, Snapshot};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Commits read at once.
const HISTORY_LIMIT: usize = 5000;

#[derive(Debug, thiserror::Error)]
enum CommandError {
    #[error(transparent)]
    Git(#[from] ramure_git::Error),
    #[error("The settings could not be saved: {0}")]
    Settings(String),
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type Answer<T> = Result<T, CommandError>;

fn snapshot(path: &Path) -> Answer<Snapshot> {
    Ok(Repository::open(path)?.snapshot(HISTORY_LIMIT)?)
}

/// The repository holding `path`: its branches, tags, history and working tree.
#[tauri::command(async)]
fn open_repository(path: PathBuf) -> Answer<Snapshot> {
    snapshot(&path)
}

/// Where a change is, as the interface names it.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Where {
    Unstaged,
    Staged,
    Commit { id: String },
    Stash { id: String },
}

#[tauri::command(async)]
fn file_diff(path: PathBuf, change: Change, side: Where) -> Answer<FileDiff> {
    let side = match &side {
        Where::Unstaged => Side::Unstaged,
        Where::Staged => Side::Staged,
        Where::Commit { id } => Side::Commit(id),
        Where::Stash { id } => Side::Stash(id),
    };
    Ok(ramure_git::file_diff(&path, &change, side)?)
}

#[tauri::command(async)]
fn commit_files(path: PathBuf, id: String) -> Answer<Vec<Change>> {
    Ok(ramure_git::commit_files(&path, &id)?)
}

#[tauri::command(async)]
fn stash_files(path: PathBuf, id: String) -> Answer<Vec<Change>> {
    Ok(ramure_git::stash_files(&path, &id)?)
}

#[tauri::command(async)]
fn stash(path: PathBuf, message: Option<String>, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::stash(&path, message.as_deref(), identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn stash_apply(path: PathBuf, index: usize, id: String) -> Answer<Snapshot> {
    actions::stash_apply(&path, index, &id)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn stash_pop(path: PathBuf, index: usize, id: String) -> Answer<Snapshot> {
    actions::stash_pop(&path, index, &id)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn stash_drop(path: PathBuf, index: usize, id: String) -> Answer<Snapshot> {
    actions::stash_drop(&path, index, &id)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn stage(path: PathBuf, files: Vec<String>) -> Answer<Snapshot> {
    actions::stage(&path, &files)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn unstage(path: PathBuf, files: Vec<String>) -> Answer<Snapshot> {
    actions::unstage(&path, &files)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn commit(path: PathBuf, message: String, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::commit(&path, &message, identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn create_branch(path: PathBuf, name: String, start: Option<String>) -> Answer<Snapshot> {
    actions::create_branch(&path, &name, start.as_deref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn checkout(path: PathBuf, name: String, remote: bool) -> Answer<Snapshot> {
    actions::checkout(&path, &name, remote)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn fetch(path: PathBuf) -> Answer<Snapshot> {
    actions::fetch(&path)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn pull(path: PathBuf, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::pull(&path, identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn push(path: PathBuf) -> Answer<Snapshot> {
    actions::push(&path)?;
    snapshot(&path)
}

/// The identity git uses when no profile says otherwise.
#[tauri::command(async)]
fn global_identity() -> Answer<Identity> {
    Ok(ramure_git::global_identity()?)
}

/// Guards the settings file: one write at a time.
#[derive(Default)]
struct SettingsFile(Mutex<()>);

fn settings_path(app: &AppHandle) -> Answer<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| CommandError::Settings(e.to_string()))?;
    Ok(dir.join("settings.json"))
}

/// The interface's settings (profiles, tabs, workspaces) as it last saved them; none on
/// the first run, or when the file cannot be read.
#[tauri::command(async)]
fn load_settings(app: AppHandle, file: State<'_, SettingsFile>) -> Answer<Option<serde_json::Value>> {
    let _guard = file.0.lock().unwrap_or_else(|e| e.into_inner());
    let path = settings_path(&app)?;
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(None);
    };
    match serde_json::from_str(&text) {
        Ok(settings) => Ok(Some(settings)),
        Err(e) => {
            tracing::warn!("{} is not valid JSON, starting afresh: {e}", path.display());
            Ok(None)
        }
    }
}

/// Replaces the settings, written aside first so that a crash never leaves half a file.
#[tauri::command(async)]
fn save_settings(app: AppHandle, file: State<'_, SettingsFile>, settings: serde_json::Value) -> Answer<()> {
    let _guard = file.0.lock().unwrap_or_else(|e| e.into_inner());
    let path = settings_path(&app)?;
    let fail = |e: std::io::Error| CommandError::Settings(e.to_string());
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(fail)?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| CommandError::Settings(e.to_string()))?;
    let aside = path.with_extension("json.tmp");
    std::fs::write(&aside, text).map_err(fail)?;
    std::fs::rename(&aside, &path).map_err(fail)
}

pub fn run() {
    tracing_subscriber::fmt().init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SettingsFile::default())
        .invoke_handler(tauri::generate_handler![
            open_repository,
            file_diff,
            commit_files,
            stash_files,
            stage,
            unstage,
            commit,
            create_branch,
            checkout,
            fetch,
            pull,
            push,
            stash,
            stash_apply,
            stash_pop,
            stash_drop,
            global_identity,
            load_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("Ramure could not start");
}
