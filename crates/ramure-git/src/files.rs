//! One file at a time: the commits that changed it, who wrote each of its lines, and the
//! file itself read, written or deleted.

use crate::cli::{git, git_answer};
use crate::diff::kind_of;
use crate::status::Change;
use crate::Error;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

/// A commit that changed a file, and how.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCommit {
    pub id: String,
    pub summary: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    /// The file as this commit changed it: renamed ones under the name they had then.
    pub change: Change,
}

/// The commits a history of one file goes back over, at most.
const MAX_FILE_COMMITS: &str = "--max-count=2000";

/// The commits found at most by a search in the code: a word that common is searched better.
const MAX_FOUND: &str = "--max-count=1000";

/// The commits, the newest first, that add or remove `text` somewhere: those that change how
/// many times it appears, on any branch.
pub fn commits_changing(dir: &Path, text: &str) -> Result<Vec<String>, Error> {
    let pickaxe = format!("-S{text}");
    let out = git(dir, &["log", "--all", "--format=%H", MAX_FOUND, &pickaxe])?;
    Ok(String::from_utf8_lossy(&out).lines().map(str::to_owned).collect())
}

/// The commits that changed `path`, newest first, following it through its renames.
pub fn file_history(dir: &Path, path: &str) -> Result<Vec<FileCommit>, Error> {
    let format = "--format=%x1e%H%x1f%at%x1f%an%x1f%ae%x1f%s";
    let out = git(dir, &["log", "--follow", "-M", MAX_FILE_COMMITS, format, "--name-status", "--", path])?;
    let text = String::from_utf8_lossy(&out);
    let mut commits = Vec::new();
    for record in text.split('\u{1e}').filter(|r| !r.trim().is_empty()) {
        let mut lines = record.lines().filter(|l| !l.is_empty());
        let Some(header) = lines.next() else { continue };
        let [id, time, author, email, summary] = header.split('\u{1f}').collect::<Vec<_>>()[..] else {
            return Err(Error::Command(format!("Unexpected log entry: {header}")));
        };
        // a merge lists no file: the change it brought is its parents'
        let Some(status) = lines.next() else { continue };
        let mut fields = status.split('\t');
        let kind = kind_of(fields.next().and_then(|code| code.bytes().next()).unwrap_or(b'M'));
        let (old_path, path) = match (fields.next(), fields.next()) {
            (Some(old), Some(new)) => (Some(old.to_owned()), new.to_owned()),
            (Some(only), None) => (None, only.to_owned()),
            _ => continue,
        };
        commits.push(FileCommit {
            id: id.to_owned(),
            summary: summary.to_owned(),
            author: author.to_owned(),
            email: email.to_owned(),
            time: time.parse().unwrap_or_default(),
            change: Change { path, old_path, kind },
        });
    }
    Ok(commits)
}

/// A file with, for each of its lines, the commit that last changed it.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub text: String,
    /// The commit of each line, in order; zeros for a line not committed yet.
    pub lines: Vec<String>,
    pub commits: HashMap<String, BlameCommit>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
}

/// Who wrote each line of `path`: as the working tree has it, or as the commit `at` had it.
pub fn blame(dir: &Path, path: &str, at: Option<&str>) -> Result<Blame, Error> {
    let mut args = vec!["blame", "--porcelain"];
    args.extend(at);
    args.extend(["--", path]);
    let out = git(dir, &args)?;
    let mut blame = Blame { text: String::new(), lines: Vec::new(), commits: HashMap::new() };
    let mut current = String::new();
    for raw in out.split(|&b| b == b'\n') {
        let line = String::from_utf8_lossy(raw);
        if let Some(content) = line.strip_prefix('\t') {
            blame.text.push_str(content.strip_suffix('\r').unwrap_or(content));
            blame.text.push('\n');
            blame.lines.push(current.clone());
            continue;
        }
        let (key, value) = line.split_once(' ').unwrap_or((&line, ""));
        if key.len() == 40 && key.bytes().all(|b| b.is_ascii_hexdigit()) {
            current = key.to_owned();
            blame.commits.entry(current.clone()).or_default();
            continue;
        }
        let Some(commit) = blame.commits.get_mut(&current) else { continue };
        match key {
            "author" => commit.author = value.to_owned(),
            "author-mail" => commit.email = value.trim_matches(['<', '>']).to_owned(),
            "author-time" => commit.time = value.parse().unwrap_or_default(),
            "summary" => commit.summary = value.to_owned(),
            _ => {}
        }
    }
    Ok(blame)
}

/// `path` inside the working tree of `dir`; refused when it would lead out of it.
fn inside(dir: &Path, path: &str) -> Result<PathBuf, Error> {
    let relative = Path::new(path);
    let plain = relative.components().all(|c| matches!(c, Component::Normal(_)));
    if path.is_empty() || !plain {
        return Err(Error::Command(format!("{path} is not a file of the repository")));
    }
    Ok(dir.join(relative))
}

fn io(path: &Path, e: std::io::Error) -> Error {
    Error::Command(format!("{}: {e}", path.display()))
}

/// The bytes of the working tree's `path`.
pub fn read_file(dir: &Path, path: &str) -> Result<Vec<u8>, Error> {
    let file = inside(dir, path)?;
    std::fs::read(&file).map_err(|e| io(&file, e))
}

/// Writes `bytes` over the working tree's `path`.
pub fn write_file(dir: &Path, path: &str, bytes: &[u8]) -> Result<(), Error> {
    let file = inside(dir, path)?;
    std::fs::write(&file, bytes).map_err(|e| io(&file, e))
}

/// Deletes the working tree's `path`; git sees it as deleted.
pub fn delete_file(dir: &Path, path: &str) -> Result<(), Error> {
    let file = inside(dir, path)?;
    std::fs::remove_file(&file).map_err(|e| io(&file, e))
}

/// The working tree's `path`, as the system names it: to open it, or show it in its folder.
pub fn full_path(dir: &Path, path: &str) -> Result<PathBuf, Error> {
    inside(dir, path)
}

/// The working tree's files git follows or could, those it ignores left out; sorted.
pub fn files(dir: &Path) -> Result<Vec<String>, Error> {
    let out = git(dir, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
    let mut files: Vec<String> = out
        .split(|&b| b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect();
    files.sort_unstable();
    // a file in conflict is listed once for each side
    files.dedup();
    Ok(files)
}

/// Adds `pattern` to the repository's `.gitignore`, made when missing, in its line endings.
pub fn ignore(dir: &Path, pattern: &str) -> Result<(), Error> {
    let file = dir.join(".gitignore");
    let mut text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(io(&file, e)),
    };
    if text.lines().any(|l| l.trim() == pattern) {
        return Ok(());
    }
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    if !text.is_empty() && !text.ends_with('\n') {
        text.push_str(eol);
    }
    text.push_str(pattern);
    text.push_str(eol);
    std::fs::write(&file, text).map_err(|e| io(&file, e))
}

/// A commit's signature: the kind of key it was made with (`ssh`, `gpg`).
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub kind: String,
}

/// The signature of the commit `id`, none when it is not signed; read from the commit
/// itself, unchecked.
pub fn signature(dir: &Path, id: &str) -> Result<Option<Signature>, Error> {
    let raw = git(dir, &["cat-file", "commit", id])?;
    let raw = String::from_utf8_lossy(&raw);
    let header = raw.split("\n\n").next().unwrap_or_default();
    let kind = if header.contains("BEGIN SSH SIGNATURE") {
        "ssh"
    } else if header.contains("BEGIN PGP SIGNATURE") {
        "gpg"
    } else {
        return Ok(None);
    };
    Ok(Some(Signature { kind: kind.to_owned() }))
}

/// A signature checked: good against the keys git trusts, and whose.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub verified: bool,
    /// Who signed, as the key says.
    pub signer: String,
}

/// Checks the signature of the commit `id` against the keys git trusts (gpg's own, or an
/// allowed signers file for ssh): it may take gpg a while.
pub fn verify(dir: &Path, id: &str) -> Result<Verification, Error> {
    let checked = git_answer(dir, &["log", "-1", "--format=%G?%x1f%GS", id])?.unwrap_or_default();
    let checked = String::from_utf8_lossy(&checked);
    let (status, signer) = checked.trim().split_once('\u{1f}').unwrap_or(("N", ""));
    Ok(Verification { verified: matches!(status, "G" | "U"), signer: signer.to_owned() })
}
