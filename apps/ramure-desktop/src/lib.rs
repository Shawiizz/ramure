//! The Ramure desktop application: the window, and the commands the interface calls.
//! Every command names the repository by its path; those that change it answer with its
//! new state.

use ramure_git::actions::Reset;
use ramure_git::{actions, Change, FileDiff, Identity, Operation, Repository, Side, Snapshot};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Commits read at once, as the settings say.
static HISTORY_LIMIT: AtomicUsize = AtomicUsize::new(5000);

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
    Ok(Repository::open(path)?.snapshot(HISTORY_LIMIT.load(Ordering::Relaxed))?)
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

impl Where {
    fn side(&self) -> Side<'_> {
        match self {
            Where::Unstaged => Side::Unstaged,
            Where::Staged => Side::Staged,
            Where::Commit { id } => Side::Commit(id),
            Where::Stash { id } => Side::Stash(id),
        }
    }
}

#[tauri::command(async)]
fn file_diff(path: PathBuf, change: Change, side: Where, ignore_whitespace: bool) -> Answer<FileDiff> {
    Ok(ramure_git::file_diff(&path, &change, side.side(), ignore_whitespace)?)
}

/// The file's two versions in one buffer, for the interface to decode as it chooses: a
/// byte saying which are there (1 the old, 2 the new), the old one's length (4 bytes,
/// little-endian), then the old bytes and the new bytes.
#[tauri::command(async)]
fn file_versions(path: PathBuf, change: Change, side: Where) -> Answer<tauri::ipc::Response> {
    let versions = ramure_git::file_versions(&path, &change, side.side())?;
    let old = versions.old.as_deref().unwrap_or_default();
    let new = versions.new.as_deref().unwrap_or_default();
    let present = u8::from(versions.old.is_some()) | u8::from(versions.new.is_some()) << 1;
    let mut buffer = Vec::with_capacity(5 + old.len() + new.len());
    buffer.push(present);
    // a file is at most 16 MB: its length fits
    buffer.extend_from_slice(&(old.len() as u32).to_le_bytes());
    buffer.extend_from_slice(old);
    buffer.extend_from_slice(new);
    Ok(tauri::ipc::Response::new(buffer))
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

/// How many commits the history reads, from the settings.
#[tauri::command]
fn set_history_limit(limit: usize) {
    HISTORY_LIMIT.store(limit.clamp(100, 100_000), Ordering::Relaxed);
}

#[tauri::command(async)]
fn git_version() -> Answer<String> {
    Ok(ramure_git::git_version()?)
}

#[tauri::command(async)]
fn checkout_commit(path: PathBuf, id: String) -> Answer<Snapshot> {
    actions::checkout_commit(&path, &id)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn cherry_pick(path: PathBuf, id: String, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::cherry_pick(&path, &id, identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn revert(path: PathBuf, id: String, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::revert(&path, &id, identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn rebase(path: PathBuf, onto: String, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::rebase(&path, &onto, identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn reset(path: PathBuf, id: String, mode: Reset) -> Answer<Snapshot> {
    actions::reset(&path, &id, mode)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn tag(
    path: PathBuf,
    name: String,
    id: String,
    message: Option<String>,
    identity: Option<Identity>,
) -> Answer<Snapshot> {
    actions::tag(&path, &name, &id, message.as_deref(), identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn abort(path: PathBuf, operation: Operation) -> Answer<Snapshot> {
    actions::abort(&path, operation)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn proceed(path: PathBuf, operation: Operation, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::proceed(&path, operation, identity.as_ref())?;
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

/// The page is an application, not a web page: no browser menu on a right click, no
/// browser shortcuts (reload, print, find, the inspector).
#[cfg(windows)]
fn lock_down(app: &tauri::App) -> tauri::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.with_webview(|webview| {
        // SAFETY: COM calls on the window's own WebView2, on the thread that owns it
        let locked = unsafe {
            webview.controller().CoreWebView2().and_then(|core| core.Settings()).and_then(|settings| {
                settings.SetAreDefaultContextMenusEnabled(false)?;
                settings.cast::<ICoreWebView2Settings3>()?.SetAreBrowserAcceleratorKeysEnabled(false)
            })
        };
        if let Err(e) = locked {
            tracing::warn!("the browser menu and shortcuts stay: {e}");
        }
    })
}

/// Only WebView2 is locked down so far.
#[cfg(not(windows))]
fn lock_down(_app: &tauri::App) -> tauri::Result<()> {
    Ok(())
}

pub fn run() {
    tracing_subscriber::fmt().init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SettingsFile::default())
        .setup(|app| Ok(lock_down(app)?))
        .invoke_handler(tauri::generate_handler![
            open_repository,
            file_diff,
            file_versions,
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
            checkout_commit,
            cherry_pick,
            revert,
            rebase,
            reset,
            tag,
            abort,
            proceed,
            global_identity,
            git_version,
            set_history_limit,
            load_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("Ramure could not start");
}
