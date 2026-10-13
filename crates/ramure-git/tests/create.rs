//! Repositories coming to be: cloned, made anew; and the ssh key git signs in with.

mod common;

use common::{commit, repository};
use ramure_git::{clone, init, set_ssh_key, ssh_command, Identity, Repository};
use std::path::PathBuf;

#[test]
fn a_repository_is_cloned_and_tells_how_far_it_got() {
    let source = repository();
    commit(source.path(), "First", 1);
    commit(source.path(), "Second", 2);
    let parent = tempfile::tempdir().unwrap();
    let into = parent.path().join("copy");

    let mut told = Vec::new();
    clone(source.path().to_str().unwrap(), &into, |line| told.push(line.to_owned())).unwrap();

    assert!(told.iter().any(|line| line.contains("Cloning into")), "{told:?}");
    let commits = Repository::open(&into).unwrap().snapshot(10).unwrap().commits;
    assert_eq!(commits.len(), 2);
}

#[test]
fn a_failed_clone_says_why() {
    let parent = tempfile::tempdir().unwrap();
    let nowhere = parent.path().join("nowhere");
    let error = clone(nowhere.to_str().unwrap(), &parent.path().join("copy"), |_| {}).unwrap_err();
    assert!(error.to_string().contains("fatal"), "{error}");
}

#[test]
fn a_repository_is_made_with_or_without_a_first_commit() {
    let parent = tempfile::tempdir().unwrap();
    let ada = Identity { name: "Ada".to_owned(), email: "ada@example.com".to_owned() };

    let bare = parent.path().join("bare");
    init(&bare, None, Some(&ada)).unwrap();
    assert!(Repository::open(&bare).unwrap().snapshot(10).unwrap().commits.is_empty());

    let started = parent.path().join("deep").join("started");
    init(&started, Some("Started"), Some(&ada)).unwrap();
    let commits = Repository::open(&started).unwrap().snapshot(10).unwrap().commits;
    assert_eq!((commits.len(), commits[0].author.as_str()), (1, "Ada"));
    assert_eq!(std::fs::read_to_string(started.join("README.md")).unwrap(), "# Started\n");
}

#[test]
fn the_ssh_key_chosen_is_quoted_for_the_shell_git_runs_ssh_in() {
    assert_eq!(ssh_command(), None);
    set_ssh_key(Some(PathBuf::from(r"C:\Users\O'Brien\.ssh\id_ed25519")));
    let ssh = ssh_command().unwrap();
    assert!(ssh.starts_with(r"ssh -i 'C:/Users/O'\''Brien/.ssh/id_ed25519'"), "{ssh}");
    set_ssh_key(None);
    assert_eq!(ssh_command(), None);
}
