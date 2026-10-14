//! What a commit's menu does: switch to it, take its changes, undo them, move a branch
//! onto it or to it, tag it; and the operations git stops in the middle of.

mod common;

use common::{commit, git, repository, write};
use ramure_git::actions::{self, Reset, Sides, Version};
use ramure_git::{status, ChangeKind, Head, Operation, Repository, Snapshot};
use std::path::Path;

fn snapshot(dir: &Path) -> Snapshot {
    Repository::open(dir).unwrap().snapshot(100).unwrap()
}

fn id_of(dir: &Path, summary: &str) -> String {
    snapshot(dir).commits.into_iter().find(|c| c.summary == summary).unwrap().id
}

/// A file added, then changed on `main` and on `feature` in two ways that clash.
fn clashing(dir: &Path) {
    write(dir, "a.txt", "one\n");
    git(dir, &["add", "a.txt"]);
    commit(dir, "Add a", 1);
    git(dir, &["switch", "-q", "-c", "feature"]);
    write(dir, "a.txt", "feature\n");
    git(dir, &["commit", "-q", "-am", "Feature a"]);
    git(dir, &["switch", "-q", "main"]);
    write(dir, "a.txt", "main\n");
    git(dir, &["commit", "-q", "-am", "Main a"]);
}

#[test]
fn a_commit_can_be_checked_out_on_no_branch() {
    let dir = repository();
    let d = dir.path();
    commit(d, "First", 1);
    commit(d, "Second", 2);
    let first = id_of(d, "First");
    actions::checkout_commit(d, &first).unwrap();
    assert!(matches!(snapshot(d).head, Head::Detached { ref id } if *id == first));
}

#[test]
fn a_commit_cherry_picked_brings_its_changes_and_one_reverted_takes_them_back() {
    let dir = repository();
    let d = dir.path();
    commit(d, "First", 1);
    git(d, &["switch", "-q", "-c", "feature"]);
    write(d, "f.txt", "f\n");
    git(d, &["add", "f.txt"]);
    commit(d, "Add f", 2);
    git(d, &["switch", "-q", "main"]);

    actions::cherry_pick(d, &id_of(d, "Add f"), None).unwrap();
    assert!(d.join("f.txt").exists());
    let picked = snapshot(d).commits.into_iter().find(|c| c.summary == "Add f" && c.parents.len() == 1);
    assert!(picked.is_some());

    let head = snapshot(d).branches.into_iter().find(|b| b.name == "main").unwrap().target;
    actions::revert(d, &head, None).unwrap();
    assert!(!d.join("f.txt").exists());
    assert_eq!(snapshot(d).commits[0].summary, "Revert \"Add f\"");
}

#[test]
fn a_reset_keeps_the_changes_staged_unstaged_or_not_at_all() {
    let dir = repository();
    let d = dir.path();
    commit(d, "First", 1);
    write(d, "b.txt", "b\n");
    git(d, &["add", "b.txt"]);
    commit(d, "Add b", 2);
    let first = id_of(d, "First");
    let second = id_of(d, "Add b");

    actions::reset(d, &first, Reset::Soft).unwrap();
    assert_eq!(status(d).unwrap().staged[0].kind, ChangeKind::Added);
    actions::reset(d, &second, Reset::Hard).unwrap();

    actions::reset(d, &first, Reset::Mixed).unwrap();
    let s = status(d).unwrap();
    assert!(s.staged.is_empty());
    assert_eq!(s.unstaged[0].kind, ChangeKind::Untracked);
    actions::reset(d, &second, Reset::Hard).unwrap();

    actions::reset(d, &first, Reset::Hard).unwrap();
    assert!(!d.join("b.txt").exists());
    assert_eq!(snapshot(d).commits[0].summary, "First");
}

#[test]
fn a_tag_is_a_plain_name_or_an_annotated_one() {
    let dir = repository();
    let d = dir.path();
    commit(d, "First", 1);
    let first = id_of(d, "First");
    actions::tag(d, "light", &first, None, None).unwrap();
    actions::tag(d, "v1.0", &first, Some("The first release"), None).unwrap();
    let tags: Vec<_> = snapshot(d).tags.into_iter().map(|t| (t.name, t.target)).collect();
    assert_eq!(tags, [("light".to_owned(), first.clone()), ("v1.0".to_owned(), first)]);
    let kind = |name: &str| {
        let out = std::process::Command::new("git").args(["cat-file", "-t", name]).current_dir(d).output();
        String::from_utf8(out.unwrap().stdout).unwrap().trim().to_owned()
    };
    assert_eq!((kind("light").as_str(), kind("v1.0").as_str()), ("commit", "tag"));
}

#[test]
fn a_rebase_that_clashes_waits_and_can_be_given_up() {
    let dir = repository();
    let d = dir.path();
    clashing(d);
    git(d, &["switch", "-q", "feature"]);
    let before = id_of(d, "Feature a");

    assert!(actions::rebase(d, "main", None).is_err());
    assert_eq!(snapshot(d).operation, Some(Operation::Rebase));
    assert_eq!(status(d).unwrap().conflicted[0].path, "a.txt");

    actions::abort(d, Operation::Rebase).unwrap();
    let after = snapshot(d);
    assert_eq!(after.operation, None);
    assert!(matches!(after.head, Head::Branch { ref name } if name == "feature"));
    assert_eq!(after.branches.iter().find(|b| b.name == "feature").unwrap().target, before);
}

#[test]
fn a_cherry_pick_that_clashes_goes_on_once_resolved() {
    let dir = repository();
    let d = dir.path();
    clashing(d);

    assert!(actions::cherry_pick(d, &id_of(d, "Feature a"), None).is_err());
    assert_eq!(snapshot(d).operation, Some(Operation::CherryPick));

    write(d, "a.txt", "both\n");
    actions::stage(d, &["a.txt".into()]).unwrap();
    actions::proceed(d, Operation::CherryPick, None).unwrap();
    let after = snapshot(d);
    assert_eq!(after.operation, None);
    assert_eq!(after.commits[0].summary, "Feature a");
    assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap().trim(), "both");
}

#[test]
fn a_clone_knows_where_its_remote_is() {
    let origin = repository();
    commit(origin.path(), "First", 1);
    let clone = tempfile::tempdir().unwrap();
    let path = origin.path().to_str().unwrap();
    git(clone.path(), &["clone", "-q", path, "."]);
    let remotes = snapshot(clone.path()).remotes;
    assert_eq!(remotes.len(), 1);
    assert_eq!(remotes[0].name, "origin");
}

#[test]
fn a_conflict_is_resolved_with_one_side_of_the_file() {
    let dir = repository();
    let d = dir.path();
    clashing(d);
    assert!(actions::merge(d, "feature", None, None).is_err());
    actions::take(d, "a.txt", Version::Incoming).unwrap();
    assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap().trim_end(), "feature");
    let s = status(d).unwrap();
    assert!(s.conflicted.is_empty());
    assert_eq!(s.staged[0].path, "a.txt");
}

#[test]
fn a_conflict_with_a_deleted_file_is_resolved_by_deleting_it() {
    let dir = repository();
    let d = dir.path();
    clashing(d);
    git(d, &["switch", "-q", "feature"]);
    git(d, &["rm", "-q", "a.txt"]);
    git(d, &["commit", "-q", "-m", "Delete a"]);
    git(d, &["switch", "-q", "main"]);
    assert!(actions::merge(d, "feature", None, None).is_err());
    assert_eq!(actions::conflict_sides(d, "a.txt").unwrap(), Sides { current: true, incoming: false });
    actions::take(d, "a.txt", Version::Incoming).unwrap();
    assert!(!d.join("a.txt").exists());
    assert!(status(d).unwrap().conflicted.is_empty());
}
