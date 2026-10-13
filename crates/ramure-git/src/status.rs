//! The working tree's state: what is staged, what is changed but not staged, what is in
//! conflict, and how far the branch is from its upstream.

use crate::cli::git;
use crate::Error;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub upstream: Option<Upstream>,
    pub staged: Vec<Change>,
    pub unstaged: Vec<Change>,
    pub conflicted: Vec<Change>,
}

/// The remote branch the current branch follows.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    pub name: String,
    /// Commits here that the upstream lacks (to push).
    pub ahead: u32,
    /// Commits there that are not here yet (to pull).
    pub behind: u32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    /// Where a renamed or copied file came from.
    pub old_path: Option<String>,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

impl ChangeKind {
    fn from_code(code: u8) -> Option<Self> {
        Some(match code {
            b'A' => Self::Added,
            b'M' => Self::Modified,
            b'D' => Self::Deleted,
            b'R' => Self::Renamed,
            b'C' => Self::Copied,
            b'T' => Self::TypeChanged,
            _ => return None,
        })
    }
}

/// The status of the working tree of the repository at `dir`.
pub fn status(dir: &Path) -> Result<Status, Error> {
    let out = git(
        dir,
        &["--no-optional-locks", "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
    )?;
    Ok(parse(&out))
}

/// Reads `git status --porcelain=v2 -z --branch`.
fn parse(out: &[u8]) -> Status {
    let mut status = Status::default();
    let mut upstream_name = None;
    let mut records = out.split(|&b| b == 0).filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        let text = String::from_utf8_lossy(record);
        let mut fields = text.splitn(2, ' ');
        let (Some(kind), Some(rest)) = (fields.next(), fields.next()) else { continue };
        match kind {
            "#" => {
                if let Some(name) = rest.strip_prefix("branch.upstream ") {
                    upstream_name = Some(name.to_owned());
                } else if let (Some(ab), Some(name)) = (rest.strip_prefix("branch.ab "), upstream_name.take())
                {
                    let mut counts =
                        ab.split(' ').map(|n| n.trim_start_matches(['+', '-']).parse().unwrap_or(0));
                    let (ahead, behind) = (counts.next().unwrap_or(0), counts.next().unwrap_or(0));
                    status.upstream = Some(Upstream { name, ahead, behind });
                }
            }
            "1" | "2" => {
                // 1 XY sub mH mI mW hH hI path; 2 adds the score before the path, then the old path
                let fields: Vec<&str> = rest.splitn(if kind == "1" { 8 } else { 9 }, ' ').collect();
                let (Some(xy), Some(path)) = (fields.first(), fields.last()) else { continue };
                let old_path = if kind == "2" {
                    records.next().map(|r| String::from_utf8_lossy(r).into_owned())
                } else {
                    None
                };
                let xy = xy.as_bytes();
                if let Some(kind) = ChangeKind::from_code(xy[0]) {
                    status.staged.push(Change { path: (*path).to_owned(), old_path: old_path.clone(), kind });
                }
                if let Some(kind) = xy.get(1).copied().and_then(ChangeKind::from_code) {
                    status.unstaged.push(Change { path: (*path).to_owned(), old_path, kind });
                }
            }
            "u" => {
                if let Some(path) = rest.splitn(10, ' ').nth(9) {
                    status.conflicted.push(Change {
                        path: path.to_owned(),
                        old_path: None,
                        kind: ChangeKind::Conflicted,
                    });
                }
            }
            "?" => status.unstaged.push(Change {
                path: rest.to_owned(),
                old_path: None,
                kind: ChangeKind::Untracked,
            }),
            _ => {}
        }
    }
    if let Some(name) = upstream_name {
        // an upstream that is gone has no counts
        status.upstream = Some(Upstream { name, ahead: 0, behind: 0 });
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(path: &str, kind: ChangeKind) -> Change {
        Change { path: path.to_owned(), old_path: None, kind }
    }

    #[test]
    fn reads_staged_unstaged_untracked_and_the_upstream() {
        let out = b"# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 M. N... 100644 100644 100644 aaa bbb src/a.rs\0\
1 .M N... 100644 100644 100644 aaa aaa docs/read me.md\0\
1 MD N... 100644 100644 000000 aaa bbb gone.txt\0\
? new file.txt\0";
        let status = parse(out);
        assert_eq!(status.upstream, Some(Upstream { name: "origin/main".into(), ahead: 2, behind: 1 }));
        assert_eq!(
            status.staged,
            [change("src/a.rs", ChangeKind::Modified), change("gone.txt", ChangeKind::Modified)]
        );
        assert_eq!(
            status.unstaged,
            [
                change("docs/read me.md", ChangeKind::Modified),
                change("gone.txt", ChangeKind::Deleted),
                change("new file.txt", ChangeKind::Untracked),
            ]
        );
    }

    #[test]
    fn reads_a_rename_with_where_it_came_from() {
        let out = b"2 R. N... 100644 100644 100644 aaa aaa R100 lib/new.rs\0lib/old.rs\0? x\0";
        let status = parse(out);
        assert_eq!(
            status.staged,
            [Change {
                path: "lib/new.rs".into(),
                old_path: Some("lib/old.rs".into()),
                kind: ChangeKind::Renamed
            }]
        );
        assert_eq!(status.unstaged, [change("x", ChangeKind::Untracked)]);
    }

    #[test]
    fn reads_conflicts_and_a_branch_without_upstream() {
        let out = b"# branch.head main\0u UU N... 100644 100644 100644 100644 a b c both.txt\0";
        let status = parse(out);
        assert_eq!(status.upstream, None);
        assert_eq!(status.conflicted, [change("both.txt", ChangeKind::Conflicted)]);
    }
}
