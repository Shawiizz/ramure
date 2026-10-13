//! Real repositories, made with the git command in temporary folders.

#![allow(dead_code)]

use std::path::Path;
use std::process::Command;

/// Runs `git args` in `dir`, dated `time` seconds after a fixed instant so that the
/// history's order does not depend on the clock.
pub fn git_at(dir: &Path, args: &[&str], time: u32) {
    let date = format!("{} +0000", 1_700_000_000 + time);
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?}");
}

pub fn git(dir: &Path, args: &[&str]) {
    git_at(dir, args, 0);
}

pub fn commit(dir: &Path, message: &str, time: u32) {
    git_at(dir, &["commit", "--allow-empty", "-q", "-m", message], time);
}

/// A new repository on `main`, with an author for its commits.
pub fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    init(dir.path());
    dir
}

pub fn init(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.name", "Ada"]);
    git(dir, &["config", "user.email", "ada@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

pub fn write(dir: &Path, path: &str, text: &str) {
    let file = dir.join(path);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, text).unwrap();
}
