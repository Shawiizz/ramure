//! Git for Ramure: where HEAD is, the branches and tags, the history and the graph that
//! draws it (read with gitoxide); the working tree, the diffs and every change to the
//! repository or exchange with a remote (through the git command).

pub mod actions;
mod cli;
mod create;
mod diff;
mod files;
mod graph;
mod identity;
mod partial;
mod reflog;
mod repository;
mod saved;
mod stash;
mod status;
mod undo;

pub use cli::{set_ssh_key, ssh_command, ssh_key};
pub use create::{clone, init};
pub use diff::{
    commit_files, compare_files, file_diff, file_versions, pull_files, FileDiff, Hunk, Line, LineKind,
    PullFiles, Pulled, Side, Versions,
};
pub use files::{
    blame, commits_changing, delete_file, file_history, files, full_path, ignore, read_file, signature,
    verify, write_file, Blame, BlameCommit, FileCommit, Signature, Verification,
};
pub use graph::{layout, Row};
pub use identity::{
    git_version, global_config, global_identity, set_global_config, set_global_identity, Identity, Signing,
    SigningFormat,
};
pub use partial::{apply_lines, Part, Picked};
pub use reflog::{reflog, RefLogEntry};
pub use repository::{Branch, Commit, Head, Operation, Remote, Repository, Snapshot, View};
pub use saved::{restore_files, save_files, SavedFile};
pub use stash::{stash_files, Stash};
pub use status::{status, Change, ChangeKind, Status, Upstream};
use std::path::PathBuf;
pub use undo::{ref_state, restore, HeadAt, Move, RefState};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{} is not in a Git repository ({reason})", path.display())]
    NotARepository { path: PathBuf, reason: String },
    #[error("Git: {0}")]
    Git(String),
    /// The git command failed: its own message.
    #[error("{0}")]
    Command(String),
}

impl Error {
    pub(crate) fn git(e: impl std::fmt::Display) -> Self {
        Self::Git(e.to_string())
    }
}
