//! Reads Git repositories for Ramure: where HEAD is, the branches and tags, the history
//! and the graph that draws it.

mod graph;
mod repository;

pub use graph::{layout, Row};
pub use repository::{Branch, Commit, Head, Repository, Snapshot};
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{} is not in a Git repository ({reason})", path.display())]
    NotARepository { path: PathBuf, reason: String },
    #[error("Git: {0}")]
    Git(String),
}

impl Error {
    pub(crate) fn git(e: impl std::fmt::Display) -> Self {
        Self::Git(e.to_string())
    }
}
