//! Git for Ramure: where HEAD is, the branches and tags, the history and the graph that
//! draws it (read with gitoxide); the working tree, the diffs and every change to the
//! repository or exchange with a remote (through the git command).

pub mod actions;
mod cli;
mod diff;
mod graph;
mod identity;
mod repository;
mod stash;
mod status;

pub use diff::{commit_files, file_diff, file_versions, FileDiff, Hunk, Line, LineKind, Side, Versions};
pub use graph::{layout, Row};
pub use identity::{git_version, global_identity, Identity};
pub use repository::{Branch, Commit, Head, Repository, Snapshot};
pub use stash::{stash_files, Stash};
pub use status::{status, Change, ChangeKind, Status, Upstream};
use std::path::PathBuf;

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
