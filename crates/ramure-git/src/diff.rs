//! What changed in a file: in the working tree, in the index, or in a commit, as hunks of
//! numbered lines.

use crate::cli::{git, git_answer};
use crate::status::{Change, ChangeKind};
use crate::Error;
use gix::diff::blob::{self, Algorithm, Diff, InternedInput};
use gix::index::entry::Stage;
use serde::Serialize;
use std::path::Path;

/// Lines beyond this are left out: a diff that long is read in an editor.
const MAX_LINES: usize = 20_000;
/// Files beyond this are not read whole: one that big is opened in an editor.
const MAX_BYTES: usize = 16 * 1024 * 1024;

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
    /// Between two commits: from the first to the second.
    Compare(&'a str, &'a str),
}

/// The diff of the file `change` in the repository at `dir`; lines whose spaces alone
/// changed in amount (indentation, the end of the line) left out when `ignore_whitespace`.
pub fn file_diff(
    dir: &Path,
    change: &Change,
    side: Side,
    ignore_whitespace: bool,
) -> Result<FileDiff, Error> {
    let paths: Vec<&str> = change.old_path.iter().map(String::as_str).chain([change.path.as_str()]).collect();
    let mut args = match side {
        Side::Unstaged if change.kind == ChangeKind::Untracked => return untracked(dir, &change.path),
        Side::Unstaged => vec!["diff", "--no-ext-diff", "-M"],
        Side::Staged => vec!["diff", "--no-ext-diff", "-M", "--cached"],
        // what never changes is reckoned here from its two versions, with no git to start
        Side::Commit(_) | Side::Stash(_) | Side::Compare(..) => {
            let versions = file_versions(dir, change, side)?;
            return Ok(reckon(versions.old.as_deref(), versions.new.as_deref(), ignore_whitespace));
        }
    };
    if ignore_whitespace {
        args.push("--ignore-space-change");
    }
    args.push("--");
    args.extend(paths);
    Ok(parse(&String::from_utf8_lossy(&git(dir, &args)?)))
}

/// A changed file as it was and as it is, in bytes (their encoding is the reader's to
/// choose); none on the side where the file is not.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Versions {
    pub old: Option<Vec<u8>>,
    pub new: Option<Vec<u8>>,
}

/// The two versions of the file `change`: before and after it, on its `side`.
pub fn file_versions(dir: &Path, change: &Change, side: Side) -> Result<Versions, Error> {
    let path = change.path.as_str();
    let old_path = change.old_path.as_deref().unwrap_or(path);
    let added = matches!(change.kind, ChangeKind::Added | ChangeKind::Untracked);
    let deleted = change.kind == ChangeKind::Deleted;
    // read here rather than by a git started for each version: a diff opens at once
    let repo = gix::open(dir).map_err(Error::git)?;
    let blob_unless = |gone: bool, spec: String| if gone { Ok(None) } else { blob(&repo, &spec) };
    let (old, new) = match side {
        Side::Unstaged => {
            // in a conflict, the index holds our side as stage 2
            let stage = if change.kind == ChangeKind::Conflicted { "2" } else { "0" };
            let new = if deleted { None } else { working_copy(dir, path)? };
            (blob_unless(change.kind == ChangeKind::Untracked, format!(":{stage}:{path}"))?, new)
        }
        Side::Staged => {
            (blob_unless(added, format!("HEAD:{old_path}"))?, blob_unless(deleted, format!(":0:{path}"))?)
        }
        Side::Commit(id) => {
            (blob_unless(added, format!("{id}^:{old_path}"))?, blob_unless(deleted, format!("{id}:{path}"))?)
        }
        Side::Stash(id) if change.kind == ChangeKind::Untracked => {
            (None, blob(&repo, &format!("{id}^3:{path}"))?)
        }
        Side::Stash(id) => {
            (blob_unless(added, format!("{id}^1:{old_path}"))?, blob_unless(deleted, format!("{id}:{path}"))?)
        }
        Side::Compare(from, to) => {
            (blob_unless(added, format!("{from}:{old_path}"))?, blob_unless(deleted, format!("{to}:{path}"))?)
        }
    };
    Ok(Versions { old, new })
}

/// The blob `spec` names, in a tree (`HEAD:src/a.rs`) or at a stage of the index
/// (`:2:src/a.rs`); none when there is no such blob.
fn blob(repo: &gix::Repository, spec: &str) -> Result<Option<Vec<u8>>, Error> {
    let id = match spec.strip_prefix(':').and_then(|rest| rest.split_once(':')) {
        Some((stage, path)) => {
            let stage = match stage {
                "1" => Stage::Base,
                "2" => Stage::Ours,
                "3" => Stage::Theirs,
                _ => Stage::Unconflicted,
            };
            let index = repo.index_or_empty().map_err(Error::git)?;
            match index.entry_by_path_and_stage(path.into(), stage) {
                Some(entry) => entry.id,
                None => return Ok(None),
            }
        }
        None => match repo.rev_parse_single(spec) {
            Ok(id) => id.detach(),
            Err(_) => return Ok(None),
        },
    };
    match repo.find_object(id) {
        Ok(object) if object.kind == gix::object::Kind::Blob => too_big(object.detach().data).map(Some),
        _ => Ok(None),
    }
}

/// The file in the working tree, none when it is not there.
fn working_copy(dir: &Path, path: &str) -> Result<Option<Vec<u8>>, Error> {
    match std::fs::read(dir.join(path)) {
        Ok(bytes) => too_big(bytes).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::Command(format!("{path}: {e}"))),
    }
}

fn too_big(bytes: Vec<u8>) -> Result<Vec<u8>, Error> {
    if bytes.len() > MAX_BYTES {
        return Err(Error::Command(format!(
            "This file is {} MB: too big to show here.",
            bytes.len() / (1024 * 1024)
        )));
    }
    Ok(bytes)
}

/// The files a commit changed (against its first parent).
pub fn commit_files(dir: &Path, id: &str) -> Result<Vec<Change>, Error> {
    let out =
        git(dir, &["show", "--format=", "--diff-merges=first-parent", "-z", "-M", "--name-status", id])?;
    Ok(changes(&out))
}

/// The files that differ from the commit `from` to the commit `to`.
pub fn compare_files(dir: &Path, from: &str, to: &str) -> Result<Vec<Change>, Error> {
    Ok(changes(&git(dir, &["diff", "--no-ext-diff", "-z", "-M", "--name-status", from, to])?))
}

/// What a pull request changes: from where it left its base to its last commit.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullFiles {
    pub from: String,
    pub to: String,
    pub files: Vec<Change>,
}

/// The pull request `number` of `remote`: it brings its last commit `head` into the branch
/// `base`, whose last commit is `base_id`.
pub struct Pulled<'a> {
    pub remote: &'a str,
    pub number: u64,
    pub base: &'a str,
    pub base_id: &'a str,
    pub head: &'a str,
}

/// The files a pull request changes, from where its branch left its base: its commits
/// fetched first when this repository lacks them, whatever branches it follows.
pub fn pull_files(dir: &Path, pull: &Pulled) -> Result<PullFiles, Error> {
    let present = |id: &str| -> Result<bool, Error> {
        Ok(git_answer(dir, &["cat-file", "-e", &format!("{id}^{{commit}}")])?.is_some())
    };
    let Pulled { remote, number, base, base_id, head } = *pull;
    if !present(head)? || !present(base_id)? {
        git(dir, &["fetch", "--no-tags", remote, &format!("pull/{number}/head"), base])?;
    }
    let from = git(dir, &["merge-base", base_id, head])?;
    let from = String::from_utf8_lossy(&from).trim().to_owned();
    let files = compare_files(dir, &from, head)?;
    Ok(PullFiles { from, to: head.to_owned(), files })
}

/// The changes `--name-status -z` lists.
fn changes(out: &[u8]) -> Vec<Change> {
    let mut fields =
        out.split(|&b| b == 0).filter(|f| !f.is_empty()).map(|f| String::from_utf8_lossy(f).into_owned());
    let mut changes = Vec::new();
    while let Some(status) = fields.next() {
        let kind = kind_of(status.as_bytes().first().copied().unwrap_or(b'M'));
        let old_path =
            if matches!(kind, ChangeKind::Renamed | ChangeKind::Copied) { fields.next() } else { None };
        let Some(path) = fields.next() else { break };
        changes.push(Change { path, old_path, kind });
    }
    changes
}

/// The kind of change a `--name-status` letter names.
pub(crate) fn kind_of(code: u8) -> ChangeKind {
    match code {
        b'A' => ChangeKind::Added,
        b'D' => ChangeKind::Deleted,
        b'R' => ChangeKind::Renamed,
        b'C' => ChangeKind::Copied,
        b'T' => ChangeKind::TypeChanged,
        _ => ChangeKind::Modified,
    }
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

/// Lines of context around each change, as git's diffs show them.
const CONTEXT: u32 = 3;

/// The changes from `old` to `new` as git would list them: Myers' algorithm, its lines slid
/// to read well, three lines of context, hunks that close joined; spaces changed in amount
/// left out with `ignore_whitespace`, as git's `--ignore-space-change` does.
fn reckon(old: Option<&[u8]>, new: Option<&[u8]>, ignore_whitespace: bool) -> FileDiff {
    let (old, new) = (old.unwrap_or_default(), new.unwrap_or_default());
    if old.contains(&0) || new.contains(&0) {
        return FileDiff { binary: true, ..FileDiff::default() };
    }
    let (old, new) = (String::from_utf8_lossy(old), String::from_utf8_lossy(new));
    let (old, new): (Vec<&str>, Vec<&str>) = (old.lines().collect(), new.lines().collect());
    let key = |line: &&str| if ignore_whitespace { spaces_as_one(line) } else { (*line).to_owned() };
    let mut input = InternedInput::default();
    input.update_before(old.iter().map(key));
    input.update_after(new.iter().map(key));
    let mut diff = Diff::compute(Algorithm::Myers, &input);
    diff.postprocess_lines(&input);
    // the changes, joined when the context of one reaches the next's
    let mut groups: Vec<Vec<blob::Hunk>> = Vec::new();
    for change in diff.hunks() {
        match groups.last_mut() {
            Some(group) if change.before.start - group.last().map_or(0, |c| c.before.end) <= 2 * CONTEXT => {
                group.push(change)
            }
            _ => groups.push(vec![change]),
        }
    }
    let mut file = FileDiff::default();
    let mut count = 0;
    for group in groups {
        let (first, last) = (&group[0], &group[group.len() - 1]);
        let from = first.before.start.saturating_sub(CONTEXT);
        let to = (last.before.end + CONTEXT).min(old.len() as u32);
        // where the new version is at the hunk's first line: as far from the change as the old
        let shift = first.after.start as i64 - first.before.start as i64;
        let mut lines = Vec::new();
        let (mut o, mut n) = (from, (from as i64 + shift) as u32);
        let context_to = |end: u32, lines: &mut Vec<Line>, o: &mut u32, n: &mut u32| {
            while *o < end {
                lines.push(Line {
                    kind: LineKind::Context,
                    old: Some(*o + 1),
                    new: Some(*n + 1),
                    text: old[*o as usize].to_owned(),
                });
                *o += 1;
                *n += 1;
            }
        };
        for change in &group {
            context_to(change.before.start, &mut lines, &mut o, &mut n);
            for i in change.before.clone() {
                lines.push(Line {
                    kind: LineKind::Removed,
                    old: Some(i + 1),
                    new: None,
                    text: old[i as usize].to_owned(),
                });
            }
            for i in change.after.clone() {
                lines.push(Line {
                    kind: LineKind::Added,
                    old: None,
                    new: Some(i + 1),
                    text: new[i as usize].to_owned(),
                });
            }
            (o, n) = (change.before.end, change.after.end);
        }
        context_to(to, &mut lines, &mut o, &mut n);
        if count + lines.len() > MAX_LINES {
            file.truncated = true;
            lines.truncate(MAX_LINES - count);
        }
        count += lines.len();
        let old_count = lines.iter().filter(|l| l.old.is_some()).count();
        let new_count = lines.iter().filter(|l| l.new.is_some()).count();
        let start = |first: Option<u32>, count: usize| {
            if count == 0 {
                first.map_or(0, |f| f - 1)
            } else {
                first.unwrap_or(0)
            }
        };
        let old_start = start(lines.iter().find_map(|l| l.old).or(Some(from + 1)), old_count);
        let new_start = start(lines.iter().find_map(|l| l.new).or(Some(n + 1)), new_count);
        // a range of one line is its number alone, as git writes it
        let range = |start: u32, count: usize| {
            if count == 1 {
                start.to_string()
            } else {
                format!("{start},{count}")
            }
        };
        let header = format!("@@ -{} +{} @@", range(old_start, old_count), range(new_start, new_count));
        file.hunks.push(Hunk { header, lines });
        if file.truncated {
            break;
        }
    }
    file
}

/// A line as `--ignore-space-change` compares it: no spaces at its end, every run of them
/// as one.
fn spaces_as_one(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut spaces = false;
    for c in line.trim_end().chars() {
        if c.is_whitespace() {
            spaces = true;
            continue;
        }
        if spaces {
            out.push(' ');
            spaces = false;
        }
        out.push(c);
    }
    out
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
