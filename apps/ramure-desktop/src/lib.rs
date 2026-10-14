//! The Ramure desktop application: the window, and the commands the interface calls.
//! Every command names the repository by its path; those that change it answer with its
//! new state.

use ramure_git::actions::{Planned, Pull, Reset, Rewrite, Sides, Step, Version};
use ramure_git::{
    actions, Blame, Change, FileCommit, FileDiff, Identity, Move, Operation, Part, Picked, RefLogEntry,
    RefState, Repository, SavedFile, Side, Snapshot, View,
};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

mod github;
mod programs;
mod ssh;
mod terminal;
mod windows;

/// Commits read at once, as the settings say.
static HISTORY_LIMIT: AtomicUsize = AtomicUsize::new(5000);
/// The names each repository's history is drawn from, as its sidebar sets them.
static VIEWS: Mutex<BTreeMap<PathBuf, View>> = Mutex::new(BTreeMap::new());
/// The commits each repository's history reads, once it read more than the settings say.
static READ: Mutex<BTreeMap<PathBuf, usize>> = Mutex::new(BTreeMap::new());
/// The keys of the global git configuration the settings may write.
const GLOBAL_KEYS: [&str; 5] =
    ["core.longpaths", "core.autocrlf", "init.defaultBranch", "user.name", "user.email"];

#[derive(Debug, thiserror::Error)]
enum CommandError {
    #[error(transparent)]
    Git(#[from] ramure_git::Error),
    #[error("The settings could not be saved: {0}")]
    Settings(String),
    #[error("{0}")]
    System(String),
}

impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type Answer<T> = Result<T, CommandError>;

fn snapshot(path: &Path) -> Answer<Snapshot> {
    let view = VIEWS.lock().unwrap_or_else(|e| e.into_inner()).get(path).cloned().unwrap_or_default();
    Ok(Repository::open(path)?.snapshot_with(history_length(path), &view)?)
}

/// How many commits the history of `path` reads.
fn history_length(path: &Path) -> usize {
    let first = HISTORY_LIMIT.load(Ordering::Relaxed);
    READ.lock().unwrap_or_else(|e| e.into_inner()).get(path).map_or(first, |&read| read.max(first))
}

/// The history of `path` read further back, by as many commits as the settings say; to its
/// first commit with `all`.
#[tauri::command(async)]
fn read_more(path: PathBuf, all: bool) -> Answer<Snapshot> {
    let more = if all {
        usize::MAX
    } else {
        history_length(&path).saturating_add(HISTORY_LIMIT.load(Ordering::Relaxed))
    };
    READ.lock().unwrap_or_else(|e| e.into_inner()).insert(path.clone(), more);
    snapshot(&path)
}

/// The values of the global configuration's `keys`; those not set are left out.
#[tauri::command(async)]
fn global_config(keys: Vec<String>) -> Answer<BTreeMap<String, String>> {
    Ok(ramure_git::global_config(&keys)?)
}

/// Sets, or unsets with `None`, one of the global configuration's keys the settings show.
#[tauri::command(async)]
fn set_global_config(key: String, value: Option<String>) -> Answer<()> {
    if !GLOBAL_KEYS.contains(&key.as_str()) {
        return Err(CommandError::System(format!("{key} is not set from Ramure")));
    }
    Ok(ramure_git::set_global_config(&key, value.as_deref())?)
}

/// Clones `url` into the new folder `name` of `parent`; `progress` hears each line git
/// tells of it. Answers the new repository's path.
#[tauri::command(async)]
fn clone_repository(
    url: String,
    parent: PathBuf,
    name: String,
    progress: tauri::ipc::Channel<String>,
) -> Answer<PathBuf> {
    let into = folder_in(&parent, &name)?;
    ramure_git::clone(&url, &into, |line| {
        let _ = progress.send(line.to_owned());
    })?;
    Ok(into)
}

/// A new repository in the folder `name` of `parent`, an empty one or one made; with
/// `readme`, a README in a first commit. Answers its path.
#[tauri::command(async)]
fn create_repository(
    parent: PathBuf,
    name: String,
    readme: bool,
    identity: Option<Identity>,
) -> Answer<PathBuf> {
    let dir = folder_in(&parent, &name)?;
    if dir.read_dir().is_ok_and(|mut entries| entries.next().is_some()) {
        return Err(CommandError::System(format!("{} is not empty", dir.display())));
    }
    ramure_git::init(&dir, readme.then_some(name.as_str()), identity.as_ref())?;
    Ok(dir)
}

/// The folder `name` in `parent`, refused when it is not one plain name.
fn folder_in(parent: &Path, name: &str) -> Answer<PathBuf> {
    let mut parts = Path::new(name).components();
    if !matches!((parts.next(), parts.next()), (Some(std::path::Component::Normal(_)), None)) {
        return Err(CommandError::System(format!("{name} is not a folder name")));
    }
    Ok(parent.join(name))
}

/// The signature of the commit `id`, none when it has none.
#[tauri::command(async)]
fn signature(path: PathBuf, id: String) -> Answer<Option<ramure_git::Signature>> {
    Ok(ramure_git::signature(&path, &id)?)
}

/// The signature of the commit `id` checked: slow, as gpg may be.
#[tauri::command(async)]
fn verify_signature(path: PathBuf, id: String) -> Answer<ramure_git::Verification> {
    Ok(ramure_git::verify(&path, &id)?)
}

/// The profile's identity made the one git uses outside Ramure.
#[tauri::command(async)]
fn set_global_identity(identity: Identity) -> Answer<()> {
    Ok(ramure_git::set_global_identity(&identity)?)
}

/// Opens the repository at `path`, or its `file`, with the editor `command` (`code`).
#[tauri::command(async)]
fn open_in_editor(path: PathBuf, file: Option<String>, command: String) -> Answer<()> {
    let target = match file {
        Some(file) => ramure_git::full_path(&path, &file)?,
        None => path,
    };
    let started = editor(&command, &target).spawn();
    started.map(drop).map_err(|e| CommandError::System(format!("{command}: {e}")))
}

/// `command` with `target` after it, run as the system's shell would: editors' launchers
/// are often scripts (`code.cmd`).
#[cfg(windows)]
fn editor(command: &str, target: &Path) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut run = std::process::Command::new("cmd");
    run.arg("/C").raw_arg(format!("{command} \"{}\"", target.display())).creation_flags(CREATE_NO_WINDOW);
    run
}

#[cfg(not(windows))]
fn editor(command: &str, target: &Path) -> std::process::Command {
    let mut run = std::process::Command::new("sh");
    run.arg("-c").arg(format!("{command} \"$1\"")).arg("sh").arg(target);
    run
}

/// The names the history of `path` is drawn from, from now on.
#[tauri::command(async)]
fn set_view(path: PathBuf, view: View) -> Answer<Snapshot> {
    VIEWS.lock().unwrap_or_else(|e| e.into_inner()).insert(path.clone(), view);
    snapshot(&path)
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
    Compare { from: String, to: String },
}

impl Where {
    fn side(&self) -> Side<'_> {
        match self {
            Where::Unstaged => Side::Unstaged,
            Where::Staged => Side::Staged,
            Where::Commit { id } => Side::Commit(id),
            Where::Stash { id } => Side::Stash(id),
            Where::Compare { from, to } => Side::Compare(from, to),
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
fn compare_files(path: PathBuf, from: String, to: String) -> Answer<Vec<Change>> {
    Ok(ramure_git::compare_files(&path, &from, &to)?)
}

#[tauri::command(async)]
fn stash_files(path: PathBuf, id: String) -> Answer<Vec<Change>> {
    Ok(ramure_git::stash_files(&path, &id)?)
}

#[tauri::command(async)]
fn stash(
    path: PathBuf,
    message: Option<String>,
    files: Vec<String>,
    identity: Option<Identity>,
) -> Answer<Snapshot> {
    actions::stash(&path, message.as_deref(), &files, identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn discard(path: PathBuf, files: Vec<String>, staged: bool) -> Answer<Snapshot> {
    actions::discard(&path, &files, staged)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn discard_all(path: PathBuf) -> Answer<Snapshot> {
    actions::discard_all(&path)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn commits_changing(path: PathBuf, text: String) -> Answer<Vec<String>> {
    Ok(ramure_git::commits_changing(&path, &text)?)
}

#[tauri::command(async)]
fn reflog(path: PathBuf) -> Answer<Vec<RefLogEntry>> {
    Ok(ramure_git::reflog(&path)?)
}

#[tauri::command(async)]
fn files(path: PathBuf) -> Answer<Vec<String>> {
    Ok(ramure_git::files(&path)?)
}

#[tauri::command(async)]
fn ignore(path: PathBuf, pattern: String) -> Answer<Snapshot> {
    ramure_git::ignore(&path, &pattern)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn delete_file(path: PathBuf, file: String) -> Answer<Snapshot> {
    ramure_git::delete_file(&path, &file)?;
    snapshot(&path)
}

/// The working tree's `file`, as raw bytes.
#[tauri::command(async)]
fn read_file(path: PathBuf, file: String) -> Answer<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(ramure_git::read_file(&path, &file)?))
}

#[tauri::command(async)]
fn write_file(path: PathBuf, file: String, text: String) -> Answer<Snapshot> {
    ramure_git::write_file(&path, &file, text.as_bytes())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn file_history(path: PathBuf, file: String) -> Answer<Vec<FileCommit>> {
    Ok(ramure_git::file_history(&path, &file)?)
}

#[tauri::command(async)]
fn blame(path: PathBuf, file: String, at: Option<String>) -> Answer<Blame> {
    Ok(ramure_git::blame(&path, &file, at.as_deref())?)
}

#[tauri::command(async)]
fn checkout_pull(path: PathBuf, remote: String, number: u64) -> Answer<Snapshot> {
    actions::checkout_pull(&path, &remote, number)?;
    snapshot(&path)
}

/// Opens a web page in the user's browser; only `https` ones.
#[tauri::command(async)]
fn open_url(url: String) -> Answer<()> {
    if !url.starts_with("https://") {
        return Err(CommandError::System(format!("{url} is not a web page")));
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| CommandError::System(e.to_string()))
}

/// Opens the working tree's `file` in the program the system gives its kind.
#[tauri::command(async)]
fn open_file(path: PathBuf, file: String) -> Answer<()> {
    let full = ramure_git::full_path(&path, &file)?;
    tauri_plugin_opener::open_path(full, None::<&str>).map_err(|e| CommandError::System(e.to_string()))
}

/// Shows the working tree's `file` selected in its folder.
#[tauri::command(async)]
fn reveal_file(path: PathBuf, file: String) -> Answer<()> {
    let full = ramure_git::full_path(&path, &file)?;
    tauri_plugin_opener::reveal_item_in_dir(full).map_err(|e| CommandError::System(e.to_string()))
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
fn conflict_sides(path: PathBuf, file: String) -> Answer<Sides> {
    Ok(actions::conflict_sides(&path, &file)?)
}

/// The files as they are now, to be put back later: before and after a discard.
#[tauri::command(async)]
fn save_files(path: PathBuf, files: Vec<String>) -> Answer<Vec<SavedFile>> {
    Ok(ramure_git::save_files(&path, &files)?)
}

/// Puts files back as `to` saved them, from how `from` saved them: a discard undone or
/// done again.
#[tauri::command(async)]
fn restore_files(path: PathBuf, to: Vec<SavedFile>, from: Vec<SavedFile>) -> Answer<Snapshot> {
    ramure_git::restore_files(&path, &to, &from)?;
    snapshot(&path)
}

/// Resolves a conflict with one side's version of the whole file.
#[tauri::command(async)]
fn take(path: PathBuf, file: String, version: Version) -> Answer<Snapshot> {
    actions::take(&path, &file, version)?;
    snapshot(&path)
}

/// Stages, unstages or throws away some of a file's changed lines.
#[tauri::command(async)]
fn apply_lines(path: PathBuf, file: String, part: Part, lines: Vec<Picked>) -> Answer<Snapshot> {
    ramure_git::apply_lines(&path, &file, part, &lines)?;
    snapshot(&path)
}

/// Commits what is staged; with `amend`, into the last commit instead.
#[tauri::command(async)]
fn commit(path: PathBuf, message: String, amend: bool, identity: Option<Identity>) -> Answer<Snapshot> {
    if amend {
        actions::amend(&path, &message, identity.as_ref())?;
    } else {
        actions::commit(&path, &message, identity.as_ref())?;
    }
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
fn fetch(path: PathBuf, prune: bool) -> Answer<Snapshot> {
    actions::fetch(&path, prune)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn pull(path: PathBuf, how: Pull, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::pull(&path, how, identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn push(path: PathBuf, force: bool) -> Answer<Snapshot> {
    actions::push(&path, force)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn rewrite(path: PathBuf, id: String, to: Rewrite, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::rewrite(&path, &id, &to, identity.as_ref())?;
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

#[tauri::command(async)]
fn merge(path: PathBuf, from: String, into: Option<String>, identity: Option<Identity>) -> Answer<Snapshot> {
    actions::merge(&path, &from, into.as_deref(), identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn rebase_branch(
    path: PathBuf,
    branch: String,
    onto: String,
    identity: Option<Identity>,
) -> Answer<Snapshot> {
    actions::rebase_branch(&path, &branch, &onto, identity.as_ref())?;
    snapshot(&path)
}

#[tauri::command(async)]
fn delete_branch(path: PathBuf, name: String, force: bool) -> Answer<Snapshot> {
    actions::delete_branch(&path, &name, force)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn delete_remote_branch(path: PathBuf, name: String) -> Answer<Snapshot> {
    actions::delete_remote_branch(&path, &name)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn rename_branch(path: PathBuf, name: String, new_name: String) -> Answer<Snapshot> {
    actions::rename_branch(&path, &name, &new_name)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn set_upstream(path: PathBuf, name: String, upstream: String) -> Answer<Snapshot> {
    actions::set_upstream(&path, &name, &upstream)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn push_branch(path: PathBuf, name: String) -> Answer<Snapshot> {
    actions::push_branch(&path, &name)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn fetch_remote(path: PathBuf, name: String) -> Answer<Snapshot> {
    actions::fetch_remote(&path, &name)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn add_remote(path: PathBuf, name: String, url: String) -> Answer<Snapshot> {
    actions::add_remote(&path, &name, &url)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn edit_remote(path: PathBuf, name: String, new_name: String, url: String) -> Answer<Snapshot> {
    actions::edit_remote(&path, &name, &new_name, &url)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn remove_remote(path: PathBuf, name: String) -> Answer<Snapshot> {
    actions::remove_remote(&path, &name)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn delete_tag(path: PathBuf, name: String) -> Answer<Snapshot> {
    actions::delete_tag(&path, &name)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn push_tag(path: PathBuf, remote: String, name: String) -> Answer<Snapshot> {
    actions::push_tag(&path, &remote, &name)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn rebase_plan(path: PathBuf, onto: String) -> Answer<Vec<Planned>> {
    Ok(actions::rebase_plan(&path, &onto)?)
}

#[tauri::command(async)]
fn rebase_interactive(
    path: PathBuf,
    onto: String,
    steps: Vec<Step>,
    identity: Option<Identity>,
) -> Answer<Snapshot> {
    actions::rebase_interactive(&path, &onto, &steps, identity.as_ref())?;
    snapshot(&path)
}

/// Where HEAD, the branches and the tags are: before and after an action, for undo.
#[tauri::command(async)]
fn ref_state(path: PathBuf) -> Answer<RefState> {
    Ok(ramure_git::ref_state(&path)?)
}

/// Puts HEAD, the branches and the tags back as `to` has them, from `from`.
#[tauri::command(async)]
fn restore(path: PathBuf, to: RefState, from: RefState, how: Move) -> Answer<Snapshot> {
    ramure_git::restore(&path, &to, &from, how)?;
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
fn lock_down(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;
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
fn lock_down(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

pub fn run() {
    tracing_subscriber::fmt().init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SettingsFile::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                lock_down(&window)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_repository,
            file_diff,
            file_versions,
            commit_files,
            stash_files,
            compare_files,
            files,
            reflog,
            commits_changing,
            apply_lines,
            take,
            save_files,
            restore_files,
            conflict_sides,
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
            discard,
            discard_all,
            ignore,
            delete_file,
            read_file,
            write_file,
            file_history,
            blame,
            open_file,
            reveal_file,
            terminal::terminal_shells,
            clone_repository,
            create_repository,
            ssh::set_ssh_key,
            ssh::ssh_public_key,
            ssh::ssh_generate,
            ssh::ssh_test,
            ssh::gpg_keys,
            github::github_device_start,
            github::github_device_poll,
            github::github_account,
            github::github_sign_out,
            github::github_repositories,
            github::github_pulls,
            github::github_checks,
            github::github_create_pull,
            github::github_default_branch,
            github::github_add_ssh_key,
            github::github_avatars,
            open_url,
            checkout_pull,
            signature,
            verify_signature,
            terminal::terminal_open,
            read_more,
            global_config,
            set_global_config,
            set_global_identity,
            open_in_editor,
            windows::open_window,
            windows::window_under,
            windows::give_tab,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            checkout_commit,
            cherry_pick,
            revert,
            rebase,
            reset,
            tag,
            abort,
            proceed,
            set_view,
            merge,
            rebase_branch,
            delete_branch,
            delete_remote_branch,
            rename_branch,
            set_upstream,
            push_branch,
            fetch_remote,
            add_remote,
            edit_remote,
            remove_remote,
            delete_tag,
            push_tag,
            rebase_plan,
            rebase_interactive,
            rewrite,
            ref_state,
            restore,
            global_identity,
            git_version,
            set_history_limit,
            load_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("Ramure could not start");
}
