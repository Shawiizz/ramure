//! Reading real repositories.

mod common;

use common::{commit, git, git_at, repository};
use ramure_git::{Head, Repository};

#[test]
fn a_branch_merged_back_draws_two_lanes_joining() {
    let dir = repository();
    let d = dir.path();
    commit(d, "First", 1);
    git(d, &["switch", "-q", "-c", "feature"]);
    commit(d, "Feature work", 2);
    git(d, &["switch", "-q", "main"]);
    commit(d, "Main work", 3);
    git_at(d, &["merge", "-q", "--no-ff", "-m", "Merge feature", "feature"], 4);
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

#[test]
fn a_commit_keeps_its_description_apart_from_its_summary() {
    let dir = repository();
    let d = dir.path();
    let body = "Why it was done.\n\nAnd how.";
    git(d, &["commit", "--allow-empty", "-q", "-m", "Summary", "-m", body]);
    git(d, &["commit", "--allow-empty", "-q", "-m", "No description"]);
    let snapshot = Repository::open(d).unwrap().snapshot(10).unwrap();
    let messages: Vec<_> = snapshot.commits.iter().map(|c| (c.summary.as_str(), c.body.as_str())).collect();
    assert_eq!(messages, [("No description", ""), ("Summary", body)]);
}
