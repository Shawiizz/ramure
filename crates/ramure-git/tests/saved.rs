//! Changes thrown away, brought back, thrown away again.

mod common;

use common::{commit, git, repository, write};
use ramure_git::{actions, restore_files, save_files, status};
use std::path::Path;

fn read(dir: &Path, path: &str) -> Option<String> {
    std::fs::read_to_string(dir.join(path)).ok()
}

#[test]
fn changes_thrown_away_come_back_and_go_again() {
    let dir = repository();
    let d = dir.path();
    git(d, &["config", "core.autocrlf", "false"]);
    write(d, "a.txt", "one\n");
    write(d, "b.txt", "two\n");
    git(d, &["add", "."]);
    commit(d, "First", 1);
    write(d, "a.txt", "one changed\r\n");
    write(d, "b.txt", "two staged\n");
    git(d, &["add", "b.txt"]);
    write(d, "b.txt", "two staged then changed\n");
    write(d, "new/c.txt", "three\n");
    let paths = ["a.txt", "b.txt", "new/c.txt"].map(String::from);

    let before = save_files(d, &paths).unwrap();
    actions::discard_all(d).unwrap();
    let after = save_files(d, &paths).unwrap();
    assert_eq!(read(d, "a.txt").as_deref(), Some("one\n"));
    assert_eq!(read(d, "new/c.txt"), None);

    restore_files(d, &before, &after).unwrap();
    assert_eq!(read(d, "a.txt").as_deref(), Some("one changed\r\n"));
    assert_eq!(read(d, "b.txt").as_deref(), Some("two staged then changed\n"));
    assert_eq!(read(d, "new/c.txt").as_deref(), Some("three\n"));
    let s = status(d).unwrap();
    assert_eq!(s.staged.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["b.txt"]);
    assert_eq!(s.unstaged.len(), 3);
    assert_eq!(save_files(d, &paths).unwrap(), before);

    restore_files(d, &after, &before).unwrap();
    assert_eq!(save_files(d, &paths).unwrap(), after);
    assert!(status(d).unwrap().unstaged.is_empty());
}

#[test]
fn files_changed_since_are_left_alone() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "one\n");
    git(d, &["add", "."]);
    commit(d, "First", 1);
    write(d, "a.txt", "changed\n");
    let paths = [String::from("a.txt")];
    let before = save_files(d, &paths).unwrap();
    actions::discard(d, &paths, false).unwrap();
    let after = save_files(d, &paths).unwrap();
    write(d, "a.txt", "changed again\n");
    assert!(restore_files(d, &before, &after).is_err());
    assert_eq!(read(d, "a.txt").as_deref(), Some("changed again\n"));
}

#[test]
fn a_conflict_comes_back_with_its_sides() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "one\n");
    git(d, &["add", "."]);
    commit(d, "First", 1);
    git(d, &["switch", "-q", "-c", "feature"]);
    write(d, "a.txt", "feature\n");
    git(d, &["commit", "-q", "-am", "Feature"]);
    git(d, &["switch", "-q", "main"]);
    write(d, "a.txt", "main\n");
    git(d, &["commit", "-q", "-am", "Main"]);
    assert!(actions::merge(d, "feature", None, None).is_err());
    let paths = [String::from("a.txt")];

    let before = save_files(d, &paths).unwrap();
    assert_eq!(before[0].index.len(), 3);
    actions::take(d, "a.txt", actions::Version::Current).unwrap();
    let after = save_files(d, &paths).unwrap();
    restore_files(d, &before, &after).unwrap();
    assert_eq!(status(d).unwrap().conflicted[0].path, "a.txt");
}
