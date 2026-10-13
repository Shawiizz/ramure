//! Reading real repositories, made with the git command in a temporary folder.

use ramure_git::{Head, Repository};
use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "Ada")
        .env("GIT_AUTHOR_EMAIL", "ada@example.com")
        .env("GIT_COMMITTER_NAME", "Ada")
        .env("GIT_COMMITTER_EMAIL", "ada@example.com")
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?}");
}

/// A commit at a given time, so the history's order does not depend on the clock.
fn commit(dir: &Path, message: &str, time: u32) {
    let date = format!("{} +0000", 1_700_000_000 + time);
    let status = Command::new("git")
        .args(["commit", "--allow-empty", "-q", "-m", message])
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "Ada")
        .env("GIT_AUTHOR_EMAIL", "ada@example.com")
        .env("GIT_COMMITTER_NAME", "Ada")
        .env("GIT_COMMITTER_EMAIL", "ada@example.com")
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .status()
        .expect("git runs");
    assert!(status.success());
}

fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    dir
}

#[test]
fn a_branch_merged_back_draws_two_lanes_joining() {
    let dir = repository();
    let d = dir.path();
    commit(d, "First", 1);
    git(d, &["switch", "-q", "-c", "feature"]);
    commit(d, "Feature work", 2);
    git(d, &["switch", "-q", "main"]);
    commit(d, "Main work", 3);
    let date = "1700000004 +0000";
    let status = Command::new("git")
        .args(["merge", "-q", "--no-ff", "-m", "Merge feature", "feature"])
        .current_dir(d)
        .env("GIT_AUTHOR_NAME", "Ada")
        .env("GIT_AUTHOR_EMAIL", "ada@example.com")
        .env("GIT_COMMITTER_NAME", "Ada")
        .env("GIT_COMMITTER_EMAIL", "ada@example.com")
        .env("GIT_AUTHOR_DATE", date)
        .env("GIT_COMMITTER_DATE", date)
        .status()
        .unwrap();
    assert!(status.success());
    git(d, &["tag", "v1"]);

    let snapshot = Repository::open(d).unwrap().snapshot(100).unwrap();
    assert!(matches!(&snapshot.head, Head::Branch { name } if name == "main"));
    let names: Vec<_> = snapshot.branches.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, ["feature", "main"]);
    assert_eq!(snapshot.tags[0].name, "v1");
    let summaries: Vec<_> = snapshot.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, ["Merge feature", "Main work", "Feature work", "First"]);
    assert_eq!(snapshot.commits[0].author, "Ada");
    // the merge opens a lane for the feature, which joins main again at the first commit
    assert_eq!(snapshot.graph[0].out, vec![0, 1]);
    assert_eq!(snapshot.graph[2].lane, 1);
    assert_eq!(snapshot.graph[3].into, vec![0, 1]);
}

#[test]
fn a_clone_lists_its_remote_branches_without_their_head() {
    let origin = repository();
    commit(origin.path(), "First", 1);
    let clone = tempfile::tempdir().unwrap();
    git(clone.path(), &["clone", "-q", origin.path().to_str().unwrap(), "."]);
    let snapshot = Repository::open(clone.path()).unwrap().snapshot(100).unwrap();
    let names: Vec<_> = snapshot.remote_branches.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(names, ["origin/main"]);
}

#[test]
fn a_parent_dated_after_its_child_still_comes_after_it() {
    let dir = repository();
    let d = dir.path();
    commit(d, "Parent from a fast clock", 50);
    commit(d, "Child", 10);
    let snapshot = Repository::open(d).unwrap().snapshot(100).unwrap();
    let summaries: Vec<_> = snapshot.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, ["Child", "Parent from a fast clock"]);
}

#[test]
fn a_new_repository_has_no_history_yet() {
    let dir = repository();
    let snapshot = Repository::open(dir.path()).unwrap().snapshot(100).unwrap();
    assert!(matches!(&snapshot.head, Head::Unborn { name } if name == "main"));
    assert!(snapshot.commits.is_empty());
}

#[test]
fn a_folder_inside_the_repository_opens_it_and_another_folder_does_not() {
    let dir = repository();
    std::fs::create_dir(dir.path().join("src")).unwrap();
    assert!(Repository::open(&dir.path().join("src")).is_ok());
    let outside = tempfile::tempdir().unwrap();
    assert!(Repository::open(outside.path()).is_err());
}
