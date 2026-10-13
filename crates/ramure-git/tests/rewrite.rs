//! Commits rewritten after the fact: their message, author and dates; and a rewritten
//! branch force-pushed.

mod common;

use common::{commit, git, repository};
use ramure_git::actions::{self, Rewrite};
use std::path::Path;
use std::process::Command;

/// `git log -1 --format=<format> <what>`, trimmed.
fn show(dir: &Path, what: &str, format: &str) -> String {
    let out = Command::new("git")
        .args(["log", "-1", &format!("--format={format}"), what])
        .current_dir(dir)
        .output()
        .unwrap();
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

fn rewrite_to(message: &str, commit_date_too: bool) -> Rewrite {
    Rewrite {
        message: message.to_owned(),
        author_name: "Grace".to_owned(),
        author_email: "grace@example.com".to_owned(),
        time: 1_600_000_000,
        offset: 120,
        commit_date_too,
    }
}

fn three_commits() -> tempfile::TempDir {
    let dir = repository();
    commit(dir.path(), "First", 1);
    commit(dir.path(), "Second", 2);
    commit(dir.path(), "Third", 3);
    dir
}

#[test]
fn a_commit_in_the_middle_is_rewritten_and_the_next_ones_replayed() {
    let dir = three_commits();
    let d = dir.path();
    let second = show(d, "HEAD~", "%H");

    actions::rewrite(d, &second, &rewrite_to("Second, told better\n\nWith a body.", true), None).unwrap();

    assert_eq!(show(d, "HEAD~", "%B"), "Second, told better\n\nWith a body.");
    assert_eq!(show(d, "HEAD~", "%an <%ae>"), "Grace <grace@example.com>");
    assert_eq!(show(d, "HEAD~", "%at %ai"), "1600000000 2020-09-13 14:26:40 +0200");
    assert_eq!(show(d, "HEAD~", "%ct"), "1600000000");
    assert_eq!(show(d, "HEAD", "%s %an"), "Third Ada");
    assert_eq!(show(d, "HEAD~2", "%s %an"), "First Ada");
    assert!(!d.join(".git/ramure-rebase").exists());
}

#[test]
fn the_last_commit_is_amended_its_commit_date_moved_only_when_asked() {
    let dir = three_commits();
    let d = dir.path();
    let committed = show(d, "HEAD", "%ct");

    actions::rewrite(d, "HEAD", &rewrite_to("Third again", false), None).unwrap();

    assert_eq!(show(d, "HEAD", "%s %an %at"), "Third again Grace 1600000000");
    assert_ne!(show(d, "HEAD", "%ct"), "1600000000");
    assert!(show(d, "HEAD", "%ct").parse::<i64>().unwrap() >= committed.parse::<i64>().unwrap());
    assert_eq!(show(d, "HEAD~", "%s"), "Second");
    assert!(!d.join(".git/ramure-rebase").exists());
}

#[test]
fn the_first_commit_is_rewritten_too() {
    let dir = three_commits();
    let d = dir.path();
    let first = show(d, "HEAD~2", "%H");

    actions::rewrite(d, &first, &rewrite_to("The very first", true), None).unwrap();

    assert_eq!(show(d, "HEAD~2", "%s %an"), "The very first Grace");
    assert_eq!(show(d, "HEAD", "%s"), "Third");
}

#[test]
fn quotes_and_dollars_in_an_author_name_are_kept_as_they_are() {
    let dir = three_commits();
    let d = dir.path();
    let to = Rewrite { author_name: "O'Brien $HOME".to_owned(), ..rewrite_to("Second", true) };

    actions::rewrite(d, &show(d, "HEAD~", "%H"), &to, None).unwrap();

    assert_eq!(show(d, "HEAD~", "%an"), "O'Brien $HOME");
}

#[test]
fn a_merge_after_the_commit_or_another_branch_s_commit_is_refused() {
    let dir = repository();
    let d = dir.path();
    commit(d, "First", 1);
    let first = show(d, "HEAD", "%H");
    git(d, &["switch", "-q", "-c", "side"]);
    commit(d, "On the side", 2);
    let side = show(d, "HEAD", "%H");
    git(d, &["switch", "-q", "main"]);
    commit(d, "On main", 3);
    git(d, &["merge", "-q", "--no-ff", "-m", "Merge side", "side"]);

    let error = actions::rewrite(d, &first, &rewrite_to("x", true), None).unwrap_err().to_string();
    assert!(error.contains("merge"), "{error}");
    git(d, &["switch", "-q", "side"]);
    git(d, &["reset", "-q", "--hard", "HEAD~"]);
    let error = actions::rewrite(d, &side, &rewrite_to("x", true), None).unwrap_err().to_string();
    assert!(error.contains("current branch"), "{error}");
}

#[test]
fn a_rewritten_branch_is_pushed_only_by_force() {
    let remote = tempfile::tempdir().unwrap();
    git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
    let dir = three_commits();
    let d = dir.path();
    git(d, &["remote", "add", "origin", remote.path().to_str().unwrap()]);
    actions::push(d, false).unwrap();

    actions::rewrite(d, &show(d, "HEAD~", "%H"), &rewrite_to("Second, rewritten", true), None).unwrap();
    assert!(actions::push(d, false).is_err());
    actions::push(d, true).unwrap();

    assert_eq!(show(remote.path(), "main~", "%s"), "Second, rewritten");
}
