//! What changed in a file: in the working tree, in the index, or in a commit, as hunks of
//! numbered lines.

use crate::cli::git;
use crate::status::{Change, ChangeKind};
use crate::Error;
use serde::Serialize;
use std::path::Path;

/// Lines beyond this are left out: a diff that long is read in an editor.
const MAX_LINES: usize = 20_000;

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub binary: bool,
    pub hunks: Vec<Hunk>,
    /// Lines left out past [`MAX_LINES`].
    pub truncated: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    /// The `@@ … @@` line, with the function it is in when git names it.
    pub header: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub kind: LineKind,
    /// Its number in the old version, for a kept or removed line.
    pub old: Option<u32>,
    /// Its number in the new version, for a kept or added line.
    pub new: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

/// Where a change lies.
#[derive(Debug, Clone, Copy)]
pub enum Side<'a> {
    /// Changed in the working tree, not staged.
    Unstaged,
    /// Staged, ready to commit.
    Staged,
    /// Brought by this commit (against its first parent).
    Commit(&'a str),
    /// Put aside in this stash.
    Stash(&'a str),
}

/// The diff of the file `change` in the repository at `dir`.
pub fn file_diff(dir: &Path, change: &Change, side: Side) -> Result<FileDiff, Error> {
    let untracked_side = match side {
        Side::Stash(id) => format!("{id}^3"),
        _ => String::new(),
    };
    let paths: Vec<&str> = change.old_path.iter().map(String::as_str).chain([change.path.as_str()]).collect();
    let mut args = match side {
        Side::Unstaged if change.kind == ChangeKind::Untracked => return untracked(dir, &change.path),
        Side::Unstaged => vec!["diff", "--no-ext-diff", "-M"],
        Side::Staged => vec!["diff", "--no-ext-diff", "-M", "--cached"],
        // a stash keeps the new files it took along in a parent of their own, with no parent
        Side::Stash(_) if change.kind == ChangeKind::Untracked => {
            vec!["diff-tree", "-p", "--root", "--no-commit-id", &untracked_side]
        }
        Side::Commit(id) | Side::Stash(id) => {
            vec!["show", "--no-ext-diff", "--format=", "--diff-merges=first-parent", "-p", "-M", id]
        }
    };
    args.push("--");
    args.extend(paths);
    Ok(parse(&String::from_utf8_lossy(&git(dir, &args)?)))
}

/// The files a commit changed (against its first parent).
pub fn commit_files(dir: &Path, id: &str) -> Result<Vec<Change>, Error> {
    let out =
        git(dir, &["show", "--format=", "--diff-merges=first-parent", "-z", "-M", "--name-status", id])?;
    let mut fields =
        out.split(|&b| b == 0).filter(|f| !f.is_empty()).map(|f| String::from_utf8_lossy(f).into_owned());
    let mut changes = Vec::new();
    while let Some(status) = fields.next() {
        let code = status.as_bytes().first().copied().unwrap_or(b'M');
        let kind = match code {
            b'A' => ChangeKind::Added,
            b'D' => ChangeKind::Deleted,
            b'R' => ChangeKind::Renamed,
            b'C' => ChangeKind::Copied,
            b'T' => ChangeKind::TypeChanged,
            _ => ChangeKind::Modified,
        };
        let old_path =
            if matches!(kind, ChangeKind::Renamed | ChangeKind::Copied) { fields.next() } else { None };
        let Some(path) = fields.next() else { break };
        changes.push(Change { path, old_path, kind });
    }
    Ok(changes)
}

/// A file git does not follow yet: all of it is new.
fn untracked(dir: &Path, path: &str) -> Result<FileDiff, Error> {
    let bytes = std::fs::read(dir.join(path)).map_err(|e| Error::Command(format!("{path}: {e}")))?;
    if bytes.contains(&0) {
        return Ok(FileDiff { binary: true, ..FileDiff::default() });
    }
    let text = String::from_utf8_lossy(&bytes);
    let total = text.lines().count();
    let lines: Vec<Line> = text
        .lines()
        .take(MAX_LINES)
        .zip(1..)
        .map(|(text, n)| Line { kind: LineKind::Added, old: None, new: Some(n), text: text.to_owned() })
        .collect();
    let header = format!("@@ -0,0 +1,{total} @@");
    let hunks = if lines.is_empty() { Vec::new() } else { vec![Hunk { header, lines }] };
    Ok(FileDiff { binary: false, hunks, truncated: total > MAX_LINES })
}

/// Reads a unified diff of one file.
fn parse(out: &str) -> FileDiff {
    let mut diff = FileDiff::default();
    let (mut old, mut new, mut count) = (0, 0, 0);
    for raw in out.lines() {
        if let Some(header) = raw.strip_prefix("@@") {
            (old, new) = hunk_starts(header);
            diff.hunks.push(Hunk { header: raw.to_owned(), lines: Vec::new() });
            continue;
        }
        if raw.starts_with("Binary files ") || raw == "GIT binary patch" {
            diff.binary = true;
            continue;
        }
        let Some(hunk) = diff.hunks.last_mut() else { continue };
        if count == MAX_LINES {
            diff.truncated = true;
            break;
        }
        let (kind, text) = match raw.as_bytes().first() {
            Some(b'+') => (LineKind::Added, &raw[1..]),
            Some(b'-') => (LineKind::Removed, &raw[1..]),
            Some(b' ') => (LineKind::Context, &raw[1..]),
            None => (LineKind::Context, ""),
            // "\ No newline at end of file"
            _ => continue,
        };
        let line = match kind {
            LineKind::Added => {
                new += 1;
                Line { kind, old: None, new: Some(new - 1), text: text.to_owned() }
            }
            LineKind::Removed => {
                old += 1;
                Line { kind, old: Some(old - 1), new: None, text: text.to_owned() }
            }
            LineKind::Context => {
                old += 1;
                new += 1;
                Line { kind, old: Some(old - 1), new: Some(new - 1), text: text.to_owned() }
            }
        };
        hunk.lines.push(line);
        count += 1;
    }
    diff
}

/// The first line numbers of a hunk, from ` -12,5 +14,6 @@ fn`.
fn hunk_starts(header: &str) -> (u32, u32) {
    let start = |sign: char| {
        header
            .split_whitespace()
            .find_map(|part| part.strip_prefix(sign))
            .and_then(|range| range.split(',').next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(1)
    };
    (start('-'), start('+'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_kept_removed_and_added_lines() {
        let out = "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -3,3 +3,3 @@ fn main()\n keep\n-old\n+new\n keep too\n\\ No newline at end of file\n";
        let diff = parse(out);
        assert!(!diff.binary);
        let hunk = &diff.hunks[0];
        assert_eq!(hunk.header, "@@ -3,3 +3,3 @@ fn main()");
        let numbered: Vec<_> = hunk.lines.iter().map(|l| (l.kind, l.old, l.new, l.text.as_str())).collect();
        assert_eq!(
            numbered,
            [
                (LineKind::Context, Some(3), Some(3), "keep"),
                (LineKind::Removed, Some(4), None, "old"),
                (LineKind::Added, None, Some(4), "new"),
                (LineKind::Context, Some(5), Some(5), "keep too"),
            ]
        );
    }

    #[test]
    fn a_binary_file_has_no_lines() {
        let diff = parse("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n");
        assert!(diff.binary);
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn a_new_file_starts_at_line_one() {
        assert_eq!(hunk_starts(" -0,0 +1,4 @@"), (0, 1));
        assert_eq!(hunk_starts(" -7 +7,2 @@ impl X"), (7, 7));
    }
}
