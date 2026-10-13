//! One file at a time: its history, its blame, its changes thrown away or ignored.

mod common;

use common::{git, git_at, repository, write};
use ramure_git::{
    actions, blame, delete_file, file_history, ignore, read_file, status, write_file, ChangeKind,
};
use std::path::Path;

fn add_and_commit(dir: &Path, message: &str, time: u32) {
    git(dir, &["add", "-A"]);
    git_at(dir, &["commit", "-q", "-m", message], time);
}

#[test]
fn a_file_history_follows_it_through_its_renames() {
    let dir = repository();
    let d = dir.path();
    write(d, "old.txt", "one\ntwo\nthree\nfour\n");
    add_and_commit(d, "Write it", 1);
    write(d, "other.txt", "other\n");
    add_and_commit(d, "Something else", 2);
    git(d, &["mv", "old.txt", "new.txt"]);
    add_and_commit(d, "Rename it", 3);
    write(d, "new.txt", "one\ntwo\nthree\nfour\nfive\n");
    add_and_commit(d, "Lengthen it", 4);

    let history = file_history(d, "new.txt").unwrap();
    let summaries: Vec<&str> = history.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, ["Lengthen it", "Rename it", "Write it"]);
    assert_eq!(history[1].change.kind, ChangeKind::Renamed);
    assert_eq!(history[1].change.old_path.as_deref(), Some("old.txt"));
    assert_eq!(history[2].change.path, "old.txt");
    assert_eq!(history[0].author, "Ada");
}

#[test]
fn a_blame_names_the_commit_of_each_line() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "first\nsecond\n");
    add_and_commit(d, "Two lines", 1);
    write(d, "a.txt", "first\nchanged\n");
    add_and_commit(d, "Change the second", 2);
    write(d, "a.txt", "first\nchanged\nnot committed\n");

    let now = blame(d, "a.txt", None).unwrap();
    assert_eq!(now.text, "first\nchanged\nnot committed\n");
    let summaries: Vec<&str> = now.lines.iter().map(|id| now.commits[id].summary.as_str()).collect();
    assert_eq!(summaries[..2], ["Two lines", "Change the second"]);
    assert!(now.lines[2].bytes().all(|b| b == b'0'));
    assert_eq!(now.commits[&now.lines[0]].email, "ada@example.com");

    let then = blame(d, "a.txt", Some("HEAD~")).unwrap();
    assert_eq!(then.text, "first\nsecond\n");
}

#[test]
fn discarding_puts_followed_files_back_and_deletes_new_ones() {
    let dir = repository();
    let d = dir.path();
    write(d, "kept.txt", "kept\n");
    add_and_commit(d, "First", 1);
    write(d, "kept.txt", "changed\n");
    write(d, "new.txt", "new\n");

    actions::discard(d, &["kept.txt".into(), "new.txt".into()], false).unwrap();
    assert_eq!(std::fs::read_to_string(d.join("kept.txt")).unwrap().trim_end(), "kept");
    assert!(!d.join("new.txt").exists());

    write(d, "kept.txt", "staged\n");
    write(d, "added.txt", "added\n");
    actions::stage(d, &["kept.txt".into(), "added.txt".into()]).unwrap();
    actions::discard(d, &["kept.txt".into(), "added.txt".into()], true).unwrap();
    assert_eq!(std::fs::read_to_string(d.join("kept.txt")).unwrap().trim_end(), "kept");
    assert!(!d.join("added.txt").exists());
    let s = status(d).unwrap();
    assert!(s.staged.is_empty() && s.unstaged.is_empty());
}

#[test]
fn discarding_everything_leaves_the_tree_as_head_has_it() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "a\n");
    add_and_commit(d, "First", 1);
    write(d, "a.txt", "changed\n");
    write(d, "b.txt", "staged\n");
    actions::stage(d, &["b.txt".into()]).unwrap();
    write(d, "deep/c.txt", "new\n");

    actions::discard_all(d).unwrap();
    let s = status(d).unwrap();
    assert!(s.staged.is_empty() && s.unstaged.is_empty());
    assert!(!d.join("b.txt").exists() && !d.join("deep").exists());
}

#[test]
fn a_file_stashed_alone_leaves_the_others() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "a\n");
    write(d, "b.txt", "b\n");
    add_and_commit(d, "First", 1);
    write(d, "a.txt", "a changed\n");
    write(d, "b.txt", "b changed\n");

    actions::stash(d, Some("Only a"), &["a.txt".into()], None).unwrap();
    let unstaged: Vec<String> = status(d).unwrap().unstaged.into_iter().map(|c| c.path).collect();
    assert_eq!(unstaged, ["b.txt"]);
}

#[test]
fn an_ignored_pattern_is_added_once_in_the_file_line_endings() {
    let dir = repository();
    let d = dir.path();
    std::fs::write(d.join(".gitignore"), "target\r\nnode_modules").unwrap();
    write(d, "notes.log", "x\n");
    ignore(d, "*.log").unwrap();
    ignore(d, "*.log").unwrap();
    assert_eq!(std::fs::read_to_string(d.join(".gitignore")).unwrap(), "target\r\nnode_modules\r\n*.log\r\n");
    assert!(status(d).unwrap().unstaged.iter().all(|c| c.path != "notes.log"));
}

#[test]
fn a_file_is_read_written_and_deleted_inside_the_repository_only() {
    let dir = repository();
    let d = dir.path();
    write_file(d, "a.txt", b"hello").unwrap();
    assert_eq!(read_file(d, "a.txt").unwrap(), b"hello");
    delete_file(d, "a.txt").unwrap();
    assert!(!d.join("a.txt").exists());
    assert!(read_file(d, "../outside.txt").is_err());
    assert!(write_file(d, "/etc/passwd", b"x").is_err());
}
