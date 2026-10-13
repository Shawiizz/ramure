//! The Ramure desktop application: the window, and the commands the interface calls.
//! Every command names the repository by its path; those that change it answer with its
//! new state.

use ramure_git::{actions, Change, FileDiff, Repository, Side, Snapshot};
use serde::Deserialize;
use std::path::{Path, PathBuf};

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
}

#[tauri::command(async)]
fn file_diff(path: PathBuf, change: Change, side: Where) -> Answer<FileDiff> {
    let side = match &side {
        Where::Unstaged => Side::Unstaged,
        Where::Staged => Side::Staged,
        Where::Commit { id } => Side::Commit(id),
    };
    Ok(ramure_git::file_diff(&path, &change, side)?)
}

#[tauri::command(async)]
fn commit_files(path: PathBuf, id: String) -> Answer<Vec<Change>> {
    Ok(ramure_git::commit_files(&path, &id)?)
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
fn commit(path: PathBuf, message: String) -> Answer<Snapshot> {
    actions::commit(&path, &message)?;
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
fn pull(path: PathBuf) -> Answer<Snapshot> {
    actions::pull(&path)?;
    snapshot(&path)
}

#[tauri::command(async)]
fn push(path: PathBuf) -> Answer<Snapshot> {
    actions::push(&path)?;
    snapshot(&path)
}

pub fn run() {
    tracing_subscriber::fmt().init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_repository,
            file_diff,
            commit_files,
            stage,
            unstage,
            commit,
            create_branch,
            checkout,
            fetch,
            pull,
            push,
        ])
        .run(tauri::generate_context!())
        .expect("Ramure could not start");
}
