//! Part of a file staged, unstaged or thrown away.

mod common;

use common::{commit, git, repository, write};
use ramure_git::{apply_lines, revert_lines, Part, Picked};
use std::path::Path;
use std::process::Command;

fn staged(dir: &Path, path: &str) -> String {
    let out = Command::new("git").args(["show", &format!(":{path}")]).current_dir(dir).output().unwrap();
    assert!(out.status.success(), "{path} is in the index");
    String::from_utf8(out.stdout).unwrap()
}

fn read(dir: &Path, path: &str) -> String {
    std::fs::read_to_string(dir.join(path)).unwrap()
}

fn added(new: u32) -> Picked {
    Picked { old: None, new: Some(new) }
}

fn removed(old: u32) -> Picked {
    Picked { old: Some(old), new: None }
}

const BEFORE: &str = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n";
/// Two hunks: 2 becomes two, and 11 becomes eleven with a line after it.
const AFTER: &str = "1\ntwo\n3\n4\n5\n6\n7\n8\n9\n10\neleven\nmore\n12\n";

fn changed() -> tempfile::TempDir {
    let dir = repository();
    let d = dir.path();
    git(d, &["config", "core.autocrlf", "false"]);
    write(d, "a.txt", BEFORE);
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);
    write(d, "a.txt", AFTER);
    dir
}

#[test]
fn a_hunk_is_staged_alone() {
    let dir = changed();
    let d = dir.path();
    apply_lines(d, "a.txt", Part::Stage, &[removed(11), added(11), added(12)]).unwrap();
    assert_eq!(staged(d, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\neleven\nmore\n12\n");
    assert_eq!(read(d, "a.txt"), AFTER);
}

#[test]
fn lines_picked_in_a_hunk_are_staged_alone() {
    let dir = changed();
    let d = dir.path();
    // the added "more", not the change of 11 above it
    apply_lines(d, "a.txt", Part::Stage, &[added(12)]).unwrap();
    assert_eq!(staged(d, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\nmore\n12\n");
    // the removal of 2, without adding "two"
    apply_lines(d, "a.txt", Part::Stage, &[removed(2)]).unwrap();
    assert_eq!(staged(d, "a.txt"), "1\n3\n4\n5\n6\n7\n8\n9\n10\n11\nmore\n12\n");
}

#[test]
fn a_hunk_is_unstaged_alone() {
    let dir = changed();
    let d = dir.path();
    git(d, &["add", "a.txt"]);
    apply_lines(d, "a.txt", Part::Unstage, &[removed(2), added(2)]).unwrap();
    assert_eq!(staged(d, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\neleven\nmore\n12\n");
    assert_eq!(read(d, "a.txt"), AFTER);
}

#[test]
fn lines_picked_are_thrown_away_from_the_working_tree() {
    let dir = changed();
    let d = dir.path();
    apply_lines(d, "a.txt", Part::Discard, &[added(12)]).unwrap();
    assert_eq!(read(d, "a.txt"), "1\ntwo\n3\n4\n5\n6\n7\n8\n9\n10\neleven\n12\n");
    apply_lines(d, "a.txt", Part::Discard, &[removed(2), added(2)]).unwrap();
    assert_eq!(read(d, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\neleven\n12\n");
    assert_eq!(staged(d, "a.txt"), BEFORE);
}

#[test]
fn the_last_line_without_a_newline_is_staged_with_or_without_its_change() {
    let dir = changed();
    let d = dir.path();
    write(d, "a.txt", "1\ntwo\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12");
    apply_lines(d, "a.txt", Part::Stage, &[removed(12), added(12)]).unwrap();
    assert_eq!(staged(d, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12");
    apply_lines(d, "a.txt", Part::Stage, &[removed(2), added(2)]).unwrap();
    assert_eq!(staged(d, "a.txt"), "1\ntwo\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12");
}

#[test]
fn part_of_a_new_file_is_staged_and_unstaged() {
    let dir = changed();
    let d = dir.path();
    write(d, "new.txt", "a\nb\nc\n");
    apply_lines(d, "new.txt", Part::Stage, &[added(1), added(3)]).unwrap();
    assert_eq!(staged(d, "new.txt"), "a\nc\n");
    assert_eq!(read(d, "new.txt"), "a\nb\nc\n");
    apply_lines(d, "new.txt", Part::Unstage, &[added(2)]).unwrap();
    assert_eq!(staged(d, "new.txt"), "a\n");
}

#[test]
fn part_of_a_deleted_file_is_staged() {
    let dir = changed();
    let d = dir.path();
    std::fs::remove_file(d.join("a.txt")).unwrap();
    apply_lines(d, "a.txt", Part::Stage, &[removed(1), removed(2)]).unwrap();
    assert_eq!(staged(d, "a.txt"), "3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n");
    apply_lines(d, "a.txt", Part::Stage, &(1..=10).map(removed).collect::<Vec<_>>()).unwrap();
    let out = Command::new("git").args(["ls-files", "a.txt"]).current_dir(d).output().unwrap();
    assert!(out.stdout.is_empty(), "the file is deleted from the index");
}

#[test]
fn lines_that_did_not_change_are_refused() {
    let dir = changed();
    assert!(apply_lines(dir.path(), "a.txt", Part::Stage, &[added(5)]).is_err());
}

#[test]
fn a_hunk_is_staged_with_windows_line_endings() {
    let dir = repository();
    let d = dir.path();
    git(d, &["config", "core.autocrlf", "true"]);
    write(d, "a.txt", &BEFORE.replace('\n', "\r\n"));
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);
    write(d, "a.txt", &AFTER.replace('\n', "\r\n"));
    apply_lines(d, "a.txt", Part::Stage, &[removed(2), added(2)]).unwrap();
    assert_eq!(staged(d, "a.txt"), "1\ntwo\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n");
    apply_lines(d, "a.txt", Part::Discard, &[added(12)]).unwrap();
    assert_eq!(read(d, "a.txt"), "1\r\ntwo\r\n3\r\n4\r\n5\r\n6\r\n7\r\n8\r\n9\r\n10\r\neleven\r\n12\r\n");
}

#[test]
fn a_commits_hunk_is_taken_back_out_of_the_working_tree() {
    let dir = changed();
    let d = dir.path();
    git(d, &["commit", "-q", "-am", "Change a"]);
    // the first hunk, 2 become two, reverted; the second stays
    revert_lines(d, "HEAD^", "HEAD", "a.txt", &[removed(2), added(2)]).unwrap();
    assert_eq!(read(d, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\neleven\nmore\n12\n");
    // a line alone of the second
    revert_lines(d, "HEAD^", "HEAD", "a.txt", &[added(12)]).unwrap();
    assert_eq!(read(d, "a.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\neleven\n12\n");
    assert_eq!(staged(d, "a.txt"), AFTER);
}
