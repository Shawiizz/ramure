//! The stashes: work put aside, each hanging on the commit it was made on.

use crate::cli::{git, git_answer};
use crate::diff::commit_files;
use crate::repository::Commit;
use crate::status::{Change, ChangeKind};
use crate::Error;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    /// Its place in the list: `stash@{index}`, 0 the newest.
    pub index: usize,
    pub id: String,
    pub message: String,
}

/// The stashes, newest first, and the commits that draw them in the history: each with
/// only the commit it was made on for parent.
pub(crate) fn stashes(dir: &Path) -> Result<(Vec<Stash>, Vec<Commit>), Error> {
    const FIELDS: &str = "--format=%H%x1f%P%x1f%at%x1f%an%x1f%ae%x1f%gs%x1e";
    let out = git(dir, &["stash", "list", FIELDS])?;
    let text = String::from_utf8_lossy(&out);
    let mut stashes = Vec::new();
    let mut commits = Vec::new();
    for (index, record) in text.split('\u{1e}').map(str::trim).filter(|r| !r.is_empty()).enumerate() {
        let fields: Vec<&str> = record.split('\u{1f}').collect();
        let [id, parents, time, author, email, message] = fields[..] else {
            return Err(Error::Command(format!("Unexpected stash entry: {record}")));
        };
        stashes.push(Stash { index, id: id.to_owned(), message: message.to_owned() });
        commits.push(Commit {
            id: id.to_owned(),
            parents: parents.split(' ').take(1).filter(|p| !p.is_empty()).map(str::to_owned).collect(),
            summary: message.to_owned(),
            body: String::new(),
            author: author.to_owned(),
            email: email.to_owned(),
            time: time.parse().unwrap_or_default(),
        });
    }
    Ok((stashes, commits))
}

/// The files a stash holds: its changes to followed files, then the new files it took
/// along (untracked, kept in its third parent).
pub fn stash_files(dir: &Path, id: &str) -> Result<Vec<Change>, Error> {
    let mut files = commit_files(dir, id)?;
    let untracked = format!("{id}^3");
    if git_answer(dir, &["rev-parse", "--verify", "-q", &untracked])?.is_some() {
        let out = git(dir, &["ls-tree", "-r", "-z", "--name-only", &untracked])?;
        files.extend(out.split(|&b| b == 0).filter(|p| !p.is_empty()).map(|p| Change {
            path: String::from_utf8_lossy(p).into_owned(),
            old_path: None,
            kind: ChangeKind::Untracked,
        }));
    }
    Ok(files)
}
