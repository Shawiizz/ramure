//! Branches merged, rebased, renamed, deleted; remotes and tags; the history drawn from
//! some names only; undo and redo; the interactive rebase.

mod common;

use common::{commit, git, repository, write};
use ramure_git::actions::{self, Step, StepAction};
use ramure_git::{ref_state, restore, status, ChangeKind, Head, Move, Repository, Snapshot, View};
use std::path::Path;

fn snapshot(dir: &Path) -> Snapshot {
    Repository::open(dir).unwrap().snapshot(100).unwrap()
}

fn summaries(dir: &Path) -> Vec<String> {
    snapshot(dir).commits.into_iter().map(|c| c.summary).collect()
}

fn head(dir: &Path) -> String {
    match snapshot(dir).head {
        Head::Branch { name } => name,
        other => panic!("{other:?}"),
    }
}

/// `main` with one commit, `feature` with one more on top, `main` checked out.
fn forked(dir: &Path) {
    write(dir, "a.txt", "a\n");
    git(dir, &["add", "a.txt"]);
    commit(dir, "Add a", 1);
    git(dir, &["switch", "-q", "-c", "feature"]);
    write(dir, "f.txt", "f\n");
    git(dir, &["add", "f.txt"]);
    commit(dir, "Add f", 2);
    git(dir, &["switch", "-q", "main"]);
}

#[test]
fn a_branch_merges_into_another_switched_to_first() {
    let dir = repository();
    let d = dir.path();
    forked(d);
    git(d, &["switch", "-q", "-c", "other"]);
    actions::merge(d, "feature", Some("main"), None).unwrap();
    assert_eq!(head(d), "main");
    assert!(d.join("f.txt").exists());
}

#[test]
fn a_branch_rebases_onto_another() {
    let dir = repository();
    let d = dir.path();
    forked(d);
    write(d, "m.txt", "m\n");
    git(d, &["add", "m.txt"]);
    commit(d, "Add m", 3);
    actions::rebase_branch(d, "feature", "main", None).unwrap();
    assert_eq!(head(d), "feature");
    assert_eq!(summaries(d), ["Add f", "Add m", "Add a"]);
}

#[test]
fn a_branch_is_renamed_and_deleted_once_merged_or_when_forced() {
    let dir = repository();
    let d = dir.path();
    forked(d);
    actions::rename_branch(d, "feature", "topic").unwrap();
    let names = |d: &Path| snapshot(d).branches.into_iter().map(|b| b.name).collect::<Vec<_>>();
    assert_eq!(names(d), ["main", "topic"]);
    assert!(actions::delete_branch(d, "topic", false).is_err(), "not merged yet");
    actions::delete_branch(d, "topic", true).unwrap();
    assert_eq!(names(d), ["main"]);
}

#[test]
fn remotes_are_added_edited_fetched_and_removed_and_tags_deleted() {
    let origin = repository();
    commit(origin.path(), "First", 1);
    let dir = repository();
    let d = dir.path();
    commit(d, "Mine", 1);
    let url = origin.path().to_str().unwrap();
    actions::add_remote(d, "upstream", url).unwrap();
    actions::fetch_remote(d, "upstream").unwrap();
    assert_eq!(snapshot(d).remote_branches[0].name, "upstream/main");
    actions::edit_remote(d, "upstream", "origin", url).unwrap();
    assert_eq!(snapshot(d).remotes[0].name, "origin");
    actions::remove_remote(d, "origin").unwrap();
    assert!(snapshot(d).remotes.is_empty());

    let id = snapshot(d).commits[0].id.clone();
    actions::tag(d, "v1", &id, None, None).unwrap();
    actions::delete_tag(d, "v1").unwrap();
    assert!(snapshot(d).tags.is_empty());
}

#[test]
fn the_history_leaves_out_the_hidden_names_or_keeps_to_the_soloed_ones() {
    let dir = repository();
    let d = dir.path();
    forked(d);
    git(d, &["switch", "-q", "-c", "side"]);
    commit(d, "Side work", 3);
    git(d, &["switch", "-q", "main"]);
    let drawn = |view: View| {
        let s = Repository::open(d).unwrap().snapshot_with(100, &view).unwrap();
        s.commits.into_iter().map(|c| c.summary).collect::<Vec<_>>()
    };
    let hidden = View { hidden: vec!["branch:feature".into()], solo: vec![] };
    assert_eq!(drawn(hidden), ["Side work", "Add a"]);
    let solo = View { hidden: vec![], solo: vec!["branch:feature".into()] };
    assert_eq!(drawn(solo), ["Add f", "Add a"]);
}

#[test]
fn a_commit_is_undone_its_changes_staged_again_and_redone() {
    let dir = repository();
    let d = dir.path();
    forked(d);
    write(d, "b.txt", "b\n");
    actions::stage(d, &["b.txt".into()]).unwrap();
    let before = ref_state(d).unwrap();
    actions::commit(d, "Add b", None).unwrap();
    let after = ref_state(d).unwrap();

    let main = |d: &Path| {
        let s = snapshot(d);
        let target = s.branches.iter().find(|b| b.name == "main").unwrap().target.clone();
        s.commits.into_iter().find(|c| c.id == target).unwrap().summary
    };
    restore(d, &before, &after, Move::Soft).unwrap();
    assert_eq!(main(d), "Add a");
    assert_eq!(status(d).unwrap().staged[0].kind, ChangeKind::Added);
    restore(d, &after, &before, Move::Soft).unwrap();
    assert_eq!(main(d), "Add b");
    assert!(status(d).unwrap().staged.is_empty());
}

#[test]
fn a_new_branch_switched_to_is_undone_back_to_the_branch_before() {
    let dir = repository();
    let d = dir.path();
    forked(d);
    let before = ref_state(d).unwrap();
    actions::create_branch(d, "topic", None).unwrap();
    let after = ref_state(d).unwrap();
    restore(d, &before, &after, Move::Keep).unwrap();
    assert_eq!(head(d), "main");
    assert!(!snapshot(d).branches.iter().any(|b| b.name == "topic"));
    restore(d, &after, &before, Move::Keep).unwrap();
    assert_eq!(head(d), "topic");
}

#[test]
fn a_hard_reset_is_undone_with_its_files_and_a_stale_undo_is_refused() {
    let dir = repository();
    let d = dir.path();
    forked(d);
    git(d, &["merge", "-q", "feature"]);
    let first = snapshot(d).commits.into_iter().find(|c| c.summary == "Add a").unwrap().id;
    let before = ref_state(d).unwrap();
    actions::reset(d, &first, actions::Reset::Hard).unwrap();
    let after = ref_state(d).unwrap();
    assert!(!d.join("f.txt").exists());
    restore(d, &before, &after, Move::Keep).unwrap();
    assert!(d.join("f.txt").exists());
    assert!(restore(d, &before, &after, Move::Keep).is_err(), "the repository moved on");
}

#[test]
fn an_interactive_rebase_reorders_rewords_squashes_and_drops() {
    let dir = repository();
    let d = dir.path();
    commit(d, "Base", 1);
    for (i, name) in ["One", "Two", "Three", "Four"].into_iter().enumerate() {
        write(d, &format!("{i}.txt"), name);
        git(d, &["add", "."]);
        commit(d, name, 2 + i as u32);
    }
    let base = snapshot(d).commits.into_iter().find(|c| c.summary == "Base").unwrap().id;
    let plan = actions::rebase_plan(d, &base).unwrap();
    let ids: Vec<_> = plan.iter().map(|p| (p.summary.as_str(), p.id.clone())).collect();
    assert_eq!(ids.iter().map(|(s, _)| *s).collect::<Vec<_>>(), ["One", "Two", "Three", "Four"]);
    let step = |i: usize, action, message: Option<&str>| Step {
        id: ids[i].1.clone(),
        action,
        message: message.map(str::to_owned),
    };
    let steps = [
        step(2, StepAction::Reword, Some("Three, said better")),
        step(0, StepAction::Pick, None),
        step(3, StepAction::Squash, None),
        step(1, StepAction::Drop, None),
    ];
    actions::rebase_interactive(d, &base, &steps, None).unwrap();
    let after = snapshot(d);
    let messages: Vec<_> = after.commits.iter().map(|c| (c.summary.as_str(), c.body.as_str())).collect();
    assert_eq!(messages, [("One", "Four"), ("Three, said better", ""), ("Base", "")]);
    assert!(!d.join("1.txt").exists(), "Two was dropped");
}
