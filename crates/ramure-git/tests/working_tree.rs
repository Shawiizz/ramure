//! The working tree, the diffs, and changing a repository or exchanging with a remote.

mod common;

use common::{commit, git, init, repository, write};
use ramure_git::actions::Pull;
use ramure_git::{
    actions, commit_files, compare_files, file_diff, file_versions, stash_files, status, Change, ChangeKind, Head, Identity,
    LineKind, Repository, Side,
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

    let diff = file_diff(d, &unstaged[0], Side::Unstaged, false).unwrap();
    let lines: Vec<_> = diff.hunks[0].lines.iter().map(|l| (l.kind, l.text.as_str())).collect();
    assert_eq!(lines, [(LineKind::Context, "one"), (LineKind::Removed, "two"), (LineKind::Added, "2")]);
    let new = file_diff(d, &unstaged[1], Side::Unstaged, false).unwrap();
    assert_eq!(new.hunks[0].lines[0].text, "hello");

    actions::stage(d, &["a.txt".into(), "notes/new.md".into()]).unwrap();
    let (staged, unstaged) = staged_and_unstaged(d);
    assert_eq!(staged, [change("a.txt", ChangeKind::Modified), change("notes/new.md", ChangeKind::Added)]);
    assert!(unstaged.is_empty());
    assert_eq!(file_diff(d, &staged[0], Side::Staged, false).unwrap().hunks[0].lines.len(), 3);

    actions::unstage(d, &["notes/new.md".into()]).unwrap();
    let (staged, unstaged) = staged_and_unstaged(d);
    assert_eq!(staged, [change("a.txt", ChangeKind::Modified)]);
    assert_eq!(unstaged, [change("notes/new.md", ChangeKind::Untracked)]);

    let id = actions::commit(d, "Change a", None).unwrap();
    let (staged, _) = staged_and_unstaged(d);
    assert!(staged.is_empty());
    assert_eq!(commit_files(d, &id).unwrap(), [change("a.txt", ChangeKind::Modified)]);
    let in_commit = file_diff(d, &change("a.txt", ChangeKind::Modified), Side::Commit(&id), false).unwrap();
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
    actions::push(mine.path(), false).unwrap();
    let upstream = status(mine.path()).unwrap().upstream.unwrap();
    assert_eq!((upstream.name.as_str(), upstream.ahead, upstream.behind), ("origin/main", 0, 0));

    let theirs = tempfile::tempdir().unwrap();
    git(theirs.path(), &["clone", "-q", url, "."]);
    init(theirs.path());
    write(theirs.path(), "b.txt", "b\n");
    actions::stage(theirs.path(), &["b.txt".into()]).unwrap();
    actions::commit(theirs.path(), "Second", None).unwrap();
    actions::push(theirs.path(), false).unwrap();

    actions::fetch(mine.path(), true).unwrap();
    assert_eq!(status(mine.path()).unwrap().upstream.unwrap().behind, 1);
    actions::pull(mine.path(), Pull::Merge, None).unwrap();
    assert!(mine.path().join("b.txt").exists());
    assert_eq!(status(mine.path()).unwrap().upstream.unwrap().behind, 0);

    // a remote branch checked out gives a local branch following it
    git(theirs.path(), &["switch", "-q", "-c", "topic"]);
    actions::push(theirs.path(), false).unwrap();
    actions::fetch(mine.path(), true).unwrap();
    actions::checkout(mine.path(), "origin/topic", true).unwrap();
    let snapshot = Repository::open(mine.path()).unwrap().snapshot(10).unwrap();
    assert!(matches!(snapshot.head, Head::Branch { ref name } if name == "topic"));
    assert_eq!(snapshot.status.upstream.unwrap().name, "origin/topic");
}

/// The commit `what` names in `dir`, and its parents.
fn parents(dir: &std::path::Path, what: &str) -> Vec<String> {
    let out = std::process::Command::new("git")
        .args(["rev-list", "--parents", "-n1", what])
        .current_dir(dir)
        .output()
        .unwrap();
    String::from_utf8(out.stdout).unwrap().split_whitespace().map(str::to_owned).collect()
}

/// A remote and the clone `mine`, where `main` and its upstream each have a commit the
/// other lacks.
fn diverged() -> (tempfile::TempDir, tempfile::TempDir) {
    let remote = tempfile::tempdir().unwrap();
    git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
    let url = remote.path().to_str().unwrap();
    let mine = tempfile::tempdir().unwrap();
    init(mine.path());
    git(mine.path(), &["remote", "add", "origin", url]);
    commit(mine.path(), "First", 0);
    actions::push(mine.path(), false).unwrap();

    let theirs = tempfile::tempdir().unwrap();
    git(theirs.path(), &["clone", "-q", url, "."]);
    init(theirs.path());
    write(theirs.path(), "theirs.txt", "theirs\n");
    git(theirs.path(), &["add", "."]);
    commit(theirs.path(), "Theirs", 1);
    git(theirs.path(), &["push", "-q"]);

    write(mine.path(), "mine.txt", "mine\n");
    git(mine.path(), &["add", "."]);
    commit(mine.path(), "Mine", 2);
    actions::fetch(mine.path(), true).unwrap();
    (remote, mine)
}

#[test]
fn a_pull_joins_diverged_branches_as_asked() {
    let (_remote, mine) = diverged();
    let d = mine.path();
    let before = parents(d, "HEAD")[0].clone();
    let upstream = parents(d, "origin/main")[0].clone();

    let error = actions::pull(d, Pull::FastForward, None).unwrap_err().to_string();
    assert!(!error.is_empty());
    assert_eq!(parents(d, "HEAD")[0], before);

    actions::pull(d, Pull::Rebase, None).unwrap();
    assert_eq!(parents(d, "HEAD")[1], upstream);
    assert!(d.join("theirs.txt").exists() && d.join("mine.txt").exists());

    git(d, &["reset", "-q", "--hard", &before]);
    actions::pull(d, Pull::Merge, None).unwrap();
    assert_eq!(parents(d, "HEAD")[1..], [before, upstream]);
}

#[test]
fn a_pull_keeps_the_changes_being_worked_on() {
    let (_remote, mine) = diverged();
    let d = mine.path();
    write(d, "mine.txt", "still mine\n");
    actions::pull(d, Pull::Rebase, None).unwrap();
    assert!(d.join("theirs.txt").exists());
    assert_eq!(std::fs::read_to_string(d.join("mine.txt")).unwrap().trim_end(), "still mine");
}

#[test]
fn a_pull_moves_a_branch_with_nothing_of_its_own_forward() {
    let (_remote, mine) = diverged();
    let d = mine.path();
    git(d, &["reset", "-q", "--hard", "HEAD~"]);
    actions::pull(d, Pull::FastForward, None).unwrap();
    assert_eq!(parents(d, "HEAD")[0], parents(d, "origin/main")[0]);
}

#[test]
fn a_branch_following_no_remote_branch_is_not_pulled() {
    let (_remote, mine) = diverged();
    let d = mine.path();
    git(d, &["switch", "-q", "-c", "topic"]);
    let before = parents(d, "HEAD")[0].clone();
    let error = actions::pull(d, Pull::Merge, None).unwrap_err().to_string();
    assert!(error.contains("upstream"), "{error}");
    assert_eq!(parents(d, "HEAD")[0], before);
}

#[test]
fn an_amend_puts_the_staged_changes_into_the_last_commit_under_a_new_message() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "a\n");
    actions::stage(d, &["a.txt".into()]).unwrap();
    actions::commit(d, "First", None).unwrap();
    write(d, "b.txt", "b\n");
    actions::stage(d, &["b.txt".into()]).unwrap();

    actions::amend(d, "First, with b", None).unwrap();

    let commits = Repository::open(d).unwrap().snapshot(10).unwrap().commits;
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].summary, "First, with b");
    assert_eq!(commit_files(d, &commits[0].id).unwrap().len(), 2);
    assert!(actions::amend(d, "  ", None).is_err());
}

#[test]
fn nothing_is_amended_before_the_first_commit() {
    let dir = repository();
    assert!(actions::amend(dir.path(), "Nothing", None).is_err());
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
    let grace = Identity { name: "Grace".into(), email: "grace@example.com".into(), signing: None };
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
    write(d, "a.txt", "one\n");
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);
    write(d, "a.txt", "two\n");
    write(d, "b.txt", "new\n");

    actions::stash(d, Some("Put aside"), &[], None).unwrap();
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
        let diff = file_diff(d, c, Side::Stash(&stash.id), false).unwrap();
        diff.hunks[0].lines.iter().map(|l| l.text.clone()).collect()
    };
    assert_eq!(texts(&files[0]), ["one", "two"]);
    assert_eq!(texts(&files[1]), ["new"]);

    actions::stash_apply(d, 0, &stash.id).unwrap();
    assert_eq!(status(d).unwrap().unstaged.len(), 2);
    actions::stash_drop(d, 0, &stash.id).unwrap();
    assert!(Repository::open(d).unwrap().snapshot(10).unwrap().stashes.is_empty());

    actions::stash(d, None, &[], None).unwrap();
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
    write(d, "a.txt", "a\n");
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);
    git(d, &["switch", "-q", "-c", "feature"]);
    write(d, "f.txt", "f\n");
    git(d, &["add", "f.txt"]);
    commit(d, "Add f", 2);
    git(d, &["switch", "-q", "main"]);
    write(d, "m.txt", "m\n");
    git(d, &["add", "m.txt"]);
    commit(d, "Add m", 3);
    git(d, &["merge", "-q", "--no-ff", "-m", "Merge feature", "feature"]);
    let merge = Repository::open(d).unwrap().snapshot(10).unwrap().commits[0].id.clone();
    assert_eq!(commit_files(d, &merge).unwrap(), [change("f.txt", ChangeKind::Added)]);
    let diff = file_diff(d, &change("f.txt", ChangeKind::Added), Side::Commit(&merge), false).unwrap();
    assert_eq!(diff.hunks.len(), 1);
}

#[test]
fn line_endings_changed_alone_are_no_change() {
    let dir = repository();
    let d = dir.path();
    git(d, &["config", "core.autocrlf", "true"]);
    write(d, "same.txt", "one\ntwo\n");
    write(d, "real.txt", "one\n");
    git(d, &["add", "same.txt", "real.txt"]);
    commit(d, "Add", 1);
    write(d, "same.txt", "one\r\ntwo\r\n");
    write(d, "real.txt", "two\n");
    assert_eq!(staged_and_unstaged(d).1, [change("real.txt", ChangeKind::Modified)]);
}

#[test]
fn a_diff_can_leave_out_changes_of_spaces_alone() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "if x {\n    go();\n}\n");
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);
    write(d, "a.txt", "if x {\n        go();\n}\nstop();\n");
    let changed = |ignore| {
        let diff = file_diff(d, &change("a.txt", ChangeKind::Modified), Side::Unstaged, ignore).unwrap();
        diff.hunks.iter().flat_map(|h| &h.lines).filter(|l| l.kind != LineKind::Context).count()
    };
    assert_eq!(changed(false), 3);
    assert_eq!(changed(true), 1);
}

#[test]
fn a_change_gives_its_file_as_it_was_and_as_it_is() {
    let dir = repository();
    let d = dir.path();
    write(d, "a.txt", "one\n");
    git(d, &["add", "a.txt"]);
    commit(d, "Add a", 1);
    let first = Repository::open(d).unwrap().snapshot(1).unwrap().commits[0].id.clone();
    write(d, "a.txt", "two\n");
    git(d, &["add", "a.txt"]);
    write(d, "a.txt", "three\n");
    write(d, "new.txt", "new\n");

    let versions = |change: Change, side| {
        let v = file_versions(d, &change, side).unwrap();
        (v.old.map(String::from_utf8).transpose().unwrap(), v.new.map(String::from_utf8).transpose().unwrap())
    };
    let text = |s: &str| Some(s.to_owned());
    let modified = || change("a.txt", ChangeKind::Modified);
    assert_eq!(versions(modified(), Side::Unstaged), (text("two\n"), text("three\n")));
    assert_eq!(versions(modified(), Side::Staged), (text("one\n"), text("two\n")));
    assert_eq!(versions(change("a.txt", ChangeKind::Added), Side::Commit(&first)), (None, text("one\n")));
    assert_eq!(versions(change("new.txt", ChangeKind::Untracked), Side::Unstaged), (None, text("new\n")));
}

#[test]
fn two_commits_are_compared_file_by_file() {
    let dir = repository();
    let d = dir.path();
    git(d, &["config", "core.autocrlf", "false"]);
    write(d, "a.txt", "one
");
    write(d, "gone.txt", "bye
");
    git(d, &["add", "."]);
    commit(d, "First", 1);
    write(d, "a.txt", "two
");
    git(d, &["rm", "-q", "gone.txt"]);
    write(d, "new.txt", "hi
");
    git(d, &["add", "."]);
    commit(d, "Second", 2);

    let files = compare_files(d, "HEAD~1", "HEAD").unwrap();
    assert_eq!(
        files,
        [
            change("a.txt", ChangeKind::Modified),
            change("gone.txt", ChangeKind::Deleted),
            change("new.txt", ChangeKind::Added),
        ]
    );
    let diff = file_diff(d, &files[0], Side::Compare("HEAD~1", "HEAD"), false).unwrap();
    let lines: Vec<_> = diff.hunks[0].lines.iter().map(|l| (l.kind, l.text.as_str())).collect();
    assert_eq!(lines, [(LineKind::Removed, "one"), (LineKind::Added, "two")]);
    let versions = file_versions(d, &files[2], Side::Compare("HEAD~1", "HEAD")).unwrap();
    assert_eq!((versions.old.as_deref(), versions.new.as_deref()), (None, Some(&b"hi
"[..])));
}
