//! The working tree, the diffs, and changing a repository or exchanging with a remote.

mod common;

use common::{commit, git, init, repository, write};
use ramure_git::{
    actions, commit_files, file_diff, stash_files, status, Change, ChangeKind, Head, Identity, LineKind,
    Repository, Side,
};

fn change(path: &str, kind: ChangeKind) -> Change {
    Change { path: path.to_owned(), old_path: None, kind }
}

fn staged_and_unstaged(dir: &std::path::Path) -> (Vec<Change>, Vec<Change>) {
    let s = status(dir).unwrap();
    (s.staged, s.unstaged)
}

#[test]
fn a_change_goes_from_the_working_tree_to_the_index_to_a_commit() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "one\ntwo\n");
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);

    write(d, "a.txt", "one\n2\n");
    write(d, "notes/new.md", "hello\n");
    let (staged, unstaged) = staged_and_unstaged(d);
    assert!(staged.is_empty());
    assert_eq!(
        unstaged,
        [change("a.txt", ChangeKind::Modified), change("notes/new.md", ChangeKind::Untracked)]
    );

    let diff = file_diff(d, &unstaged[0], Side::Unstaged).unwrap();
    let lines: Vec<_> = diff.hunks[0].lines.iter().map(|l| (l.kind, l.text.as_str())).collect();
    assert_eq!(lines, [(LineKind::Context, "one"), (LineKind::Removed, "two"), (LineKind::Added, "2")]);
    let new = file_diff(d, &unstaged[1], Side::Unstaged).unwrap();
    assert_eq!(new.hunks[0].lines[0].text, "hello");

    actions::stage(d, &["a.txt".into(), "notes/new.md".into()]).unwrap();
    let (staged, unstaged) = staged_and_unstaged(d);
    assert_eq!(staged, [change("a.txt", ChangeKind::Modified), change("notes/new.md", ChangeKind::Added)]);
    assert!(unstaged.is_empty());
    assert_eq!(file_diff(d, &staged[0], Side::Staged).unwrap().hunks[0].lines.len(), 3);

    actions::unstage(d, &["notes/new.md".into()]).unwrap();
    let (staged, unstaged) = staged_and_unstaged(d);
    assert_eq!(staged, [change("a.txt", ChangeKind::Modified)]);
    assert_eq!(unstaged, [change("notes/new.md", ChangeKind::Untracked)]);

    let id = actions::commit(d, "Change a", None).unwrap();
    let (staged, _) = staged_and_unstaged(d);
    assert!(staged.is_empty());
    assert_eq!(commit_files(d, &id).unwrap(), [change("a.txt", ChangeKind::Modified)]);
    let in_commit = file_diff(d, &change("a.txt", ChangeKind::Modified), Side::Commit(&id)).unwrap();
    assert_eq!(in_commit.hunks[0].lines.len(), 3);
}

#[test]
fn the_first_commit_shows_its_files_and_can_be_unstaged_before() {
    let dir = repository();
    let d = dir.path();
    write(d, "first.txt", "x\n");
    actions::stage(d, &["first.txt".into()]).unwrap();
    actions::unstage(d, &["first.txt".into()]).unwrap();
    assert_eq!(staged_and_unstaged(d).1, [change("first.txt", ChangeKind::Untracked)]);
    actions::stage(d, &["first.txt".into()]).unwrap();
    let id = actions::commit(d, "First", None).unwrap();
    assert_eq!(commit_files(d, &id).unwrap(), [change("first.txt", ChangeKind::Added)]);
}

#[test]
fn a_rename_is_one_change_with_where_it_came_from() {
    let dir = repository();
    let d = dir.path();
    write(d, "old.txt", "same content\nover several lines\n");
    actions::stage(d, &["old.txt".into()]).unwrap();
    let first = actions::commit(d, "Add", None).unwrap();
    git(d, &["mv", "old.txt", "new.txt"]);
    let staged = status(d).unwrap().staged;
    assert_eq!(staged[0].kind, ChangeKind::Renamed);
    assert_eq!(staged[0].old_path.as_deref(), Some("old.txt"));
    let id = actions::commit(d, "Rename", None).unwrap();
    let files = commit_files(d, &id).unwrap();
    assert_eq!(
        (files[0].kind, files[0].old_path.as_deref(), files[0].path.as_str()),
        (ChangeKind::Renamed, Some("old.txt"), "new.txt")
    );
    assert_ne!(first, id);
}

#[test]
fn an_empty_message_does_not_commit() {
    let dir = repository();
    assert!(actions::commit(dir.path(), "  ", None).is_err());
}

#[test]
fn branches_are_created_and_switched() {
    let dir = repository();
    let d = dir.path();
    commit(d, "First", 1);
    actions::create_branch(d, "feature", None).unwrap();
    let head = Repository::open(d).unwrap().snapshot(10).unwrap().head;
    assert!(matches!(head, Head::Branch { ref name } if name == "feature"));
    actions::checkout(d, "main", false).unwrap();
    let head = Repository::open(d).unwrap().snapshot(10).unwrap().head;
    assert!(matches!(head, Head::Branch { ref name } if name == "main"));
}

#[test]
fn work_goes_to_a_remote_and_comes_back_in_another_clone() {
    let remote = tempfile::tempdir().unwrap();
    git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
    let url = remote.path().to_str().unwrap();

    let mine = tempfile::tempdir().unwrap();
    init(mine.path());
    git(mine.path(), &["remote", "add", "origin", url]);
    write(mine.path(), "a.txt", "a\n");
    actions::stage(mine.path(), &["a.txt".into()]).unwrap();
    actions::commit(mine.path(), "First", None).unwrap();
    // no upstream yet: the push sets it
    actions::push(mine.path()).unwrap();
    let upstream = status(mine.path()).unwrap().upstream.unwrap();
    assert_eq!((upstream.name.as_str(), upstream.ahead, upstream.behind), ("origin/main", 0, 0));

    let theirs = tempfile::tempdir().unwrap();
    git(theirs.path(), &["clone", "-q", url, "."]);
    init(theirs.path());
    write(theirs.path(), "b.txt", "b\n");
    actions::stage(theirs.path(), &["b.txt".into()]).unwrap();
    actions::commit(theirs.path(), "Second", None).unwrap();
    actions::push(theirs.path()).unwrap();

    actions::fetch(mine.path()).unwrap();
    assert_eq!(status(mine.path()).unwrap().upstream.unwrap().behind, 1);
    actions::pull(mine.path(), None).unwrap();
    assert!(mine.path().join("b.txt").exists());
    assert_eq!(status(mine.path()).unwrap().upstream.unwrap().behind, 0);

    // a remote branch checked out gives a local branch following it
    git(theirs.path(), &["switch", "-q", "-c", "topic"]);
    actions::push(theirs.path()).unwrap();
    actions::fetch(mine.path()).unwrap();
    actions::checkout(mine.path(), "origin/topic", true).unwrap();
    let snapshot = Repository::open(mine.path()).unwrap().snapshot(10).unwrap();
    assert!(matches!(snapshot.head, Head::Branch { ref name } if name == "topic"));
    assert_eq!(snapshot.status.upstream.unwrap().name, "origin/topic");
}

#[test]
fn a_failing_command_reports_what_git_said() {
    let dir = repository();
    let error = actions::checkout(dir.path(), "nowhere", false).unwrap_err().to_string();
    assert!(error.contains("nowhere"), "{error}");
}

#[test]
fn a_failing_command_leaves_out_the_hints() {
    let dir = repository();
    let error = actions::create_branch(dir.path(), "bad name..", None).unwrap_err().to_string();
    assert!(error.contains("not a valid branch name"), "{error}");
    assert!(!error.contains("hint:"), "{error}");
}

#[test]
fn a_profile_signs_the_commit_instead_of_the_configured_identity() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "a\n");
    actions::stage(d, &["a.txt".into()]).unwrap();
    let grace = Identity { name: "Grace".into(), email: "grace@example.com".into() };
    actions::commit(d, "Signed", Some(&grace)).unwrap();
    let snapshot = Repository::open(d).unwrap().snapshot(10).unwrap();
    assert_eq!(
        (snapshot.commits[0].author.as_str(), snapshot.commits[0].email.as_str()),
        ("Grace", "grace@example.com")
    );
}

#[test]
fn a_stash_puts_work_aside_and_brings_it_back() {
    let dir = repository();
    let d = dir.path();
    write(
        d, "a.txt", "one
",
    );
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);
    write(
        d, "a.txt", "two
",
    );
    write(
        d, "b.txt", "new
",
    );

    actions::stash(d, Some("Put aside"), None).unwrap();
    assert!(status(d).unwrap().unstaged.is_empty());
    let snapshot = Repository::open(d).unwrap().snapshot(10).unwrap();
    let stash = &snapshot.stashes[0];
    assert_eq!((stash.index, stash.message.as_str()), (0, "On main: Put aside"));
    let drawn = snapshot.commits.iter().position(|c| c.id == stash.id).unwrap();
    let head = snapshot.commits.iter().position(|c| c.summary == "Add a").unwrap();
    assert!(drawn < head);
    assert_eq!(snapshot.commits[drawn].parents, [snapshot.commits[head].id.clone()]);

    let files = stash_files(d, &stash.id).unwrap();
    assert_eq!(files, [change("a.txt", ChangeKind::Modified), change("b.txt", ChangeKind::Untracked)]);
    let texts = |c: &Change| -> Vec<String> {
        let diff = file_diff(d, c, Side::Stash(&stash.id)).unwrap();
        diff.hunks[0].lines.iter().map(|l| l.text.clone()).collect()
    };
    assert_eq!(texts(&files[0]), ["one", "two"]);
    assert_eq!(texts(&files[1]), ["new"]);

    actions::stash_apply(d, 0, &stash.id).unwrap();
    assert_eq!(status(d).unwrap().unstaged.len(), 2);
    actions::stash_drop(d, 0, &stash.id).unwrap();
    assert!(Repository::open(d).unwrap().snapshot(10).unwrap().stashes.is_empty());

    actions::stash(d, None, None).unwrap();
    let id = Repository::open(d).unwrap().snapshot(10).unwrap().stashes[0].id.clone();
    assert!(actions::stash_pop(d, 0, &stash.id).is_err(), "an old id no longer names stash@{{0}}");
    actions::stash_pop(d, 0, &id).unwrap();
    assert_eq!(status(d).unwrap().unstaged.len(), 2);
    assert!(Repository::open(d).unwrap().snapshot(10).unwrap().stashes.is_empty());
}

#[test]
fn a_merge_lists_what_it_brought_to_its_first_parent_once() {
    let dir = repository();
    let d = dir.path();
    write(
        d, "a.txt", "a
",
    );
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);
    git(d, &["switch", "-q", "-c", "feature"]);
    write(
        d, "f.txt", "f
",
    );
    git(d, &["add", "f.txt"]);
    commit(d, "Add f", 2);
    git(d, &["switch", "-q", "main"]);
    write(
        d, "m.txt", "m
",
    );
    git(d, &["add", "m.txt"]);
    commit(d, "Add m", 3);
    git(d, &["merge", "-q", "--no-ff", "-m", "Merge feature", "feature"]);
    let merge = Repository::open(d).unwrap().snapshot(10).unwrap().commits[0].id.clone();
    assert_eq!(commit_files(d, &merge).unwrap(), [change("f.txt", ChangeKind::Added)]);
    let diff = file_diff(d, &change("f.txt", ChangeKind::Added), Side::Commit(&merge)).unwrap();
    assert_eq!(diff.hunks.len(), 1);
}
