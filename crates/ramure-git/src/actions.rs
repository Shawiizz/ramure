//! What changes a repository or talks to its remotes, through the git command.

use crate::cli::{git, git_answer, git_as, git_with};
use crate::{Error, Identity, Operation};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Stages `paths`: their changes go into the next commit.
pub fn stage(dir: &Path, paths: &[String]) -> Result<(), Error> {
    with_paths(dir, &["add", "--all"], paths)
}

/// Takes `paths` out of the next commit, leaving their changes in the working tree.
pub fn unstage(dir: &Path, paths: &[String]) -> Result<(), Error> {
    if has_commits(dir)? {
        with_paths(dir, &["restore", "--staged"], paths)
    } else {
        // nothing to restore from before the first commit
        with_paths(dir, &["rm", "--cached", "-r", "-q"], paths)
    }
}

/// Commits what is staged with `message`, signed by `identity` (the configured one when
/// `None`); returns the new commit's id.
pub fn commit(dir: &Path, message: &str, identity: Option<&Identity>) -> Result<String, Error> {
    if message.trim().is_empty() {
        return Err(Error::Command("A commit needs a message.".into()));
    }
    git_as(dir, &["commit", "-q", "-m", message], identity)?;
    let id = git(dir, &["rev-parse", "HEAD"])?;
    Ok(String::from_utf8_lossy(&id).trim().to_owned())
}

/// Puts what is staged into the last commit, under `message`: its author stays, the
/// committer becomes `identity`.
pub fn amend(dir: &Path, message: &str, identity: Option<&Identity>) -> Result<(), Error> {
    if message.trim().is_empty() {
        return Err(Error::Command("A commit needs a message.".into()));
    }
    if !has_commits(dir)? {
        return Err(Error::Command("There is no commit yet to amend.".into()));
    }
    git_as(dir, &["commit", "-q", "--amend", "--allow-empty", "-m", message], identity).map(drop)
}

/// Creates the branch `name` at `start` (a commit or branch; HEAD when `None`) and
/// switches to it.
pub fn create_branch(dir: &Path, name: &str, start: Option<&str>) -> Result<(), Error> {
    let mut args = vec!["switch", "-c", name];
    args.extend(start);
    git(dir, &args).map(drop)
}

/// Switches to the local branch `name`. A remote branch (`origin/feature`) gives a local
/// branch following it, or switches to that branch when it exists.
pub fn checkout(dir: &Path, name: &str, remote: bool) -> Result<(), Error> {
    if !remote {
        return git(dir, &["switch", name]).map(drop);
    }
    let local = name.split_once('/').map_or(name, |(_, branch)| branch);
    let exists = git_answer(dir, &["rev-parse", "--verify", "-q", &format!("refs/heads/{local}")])?.is_some();
    if exists {
        git(dir, &["switch", local]).map(drop)
    } else {
        git(dir, &["switch", "-c", local, "--track", name]).map(drop)
    }
}

/// Fetches every remote; with `prune`, the branches they deleted go here too.
pub fn fetch(dir: &Path, prune: bool) -> Result<(), Error> {
    let prune = if prune { "--prune" } else { "--no-prune" };
    git(dir, &["fetch", "--all", prune]).map(drop)
}

/// How a pull joins the upstream's commits to the branch's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Pull {
    /// Moves the branch forward when it has nothing of its own, merges otherwise.
    Merge,
    /// Only moves the branch forward: refused once the two have diverged.
    FastForward,
    /// Replays the branch's own commits on top of the upstream's.
    Rebase,
}

/// Brings the upstream's commits into the current branch, as `how` says, the changes being
/// worked on set aside meanwhile; a merge commit it makes is signed by `identity`. A branch
/// following no remote branch is refused rather than given the remote's default branch.
pub fn pull(dir: &Path, how: Pull, identity: Option<&Identity>) -> Result<(), Error> {
    if !has_upstream(dir)? {
        return Err(Error::Command("This branch follows no remote branch: set its upstream to pull.".into()));
    }
    let how = match how {
        Pull::Merge => "--no-rebase",
        Pull::FastForward => "--ff-only",
        Pull::Rebase => "--rebase",
    };
    git_as(dir, &["pull", how, "--autostash"], identity).map(drop)
}

/// Sends the current branch to its upstream; without one, to `origin`, which it then
/// follows. `force` replaces what the upstream has, unless someone pushed there since the
/// last fetch.
pub fn push(dir: &Path, force: bool) -> Result<(), Error> {
    if has_upstream(dir)? {
        let mut args = vec!["push"];
        if force {
            args.push("--force-with-lease");
        }
        git(dir, &args).map(drop)
    } else {
        git(dir, &["push", "-u", "origin", "HEAD"]).map(drop)
    }
}

/// Whether the current branch follows a remote branch.
fn has_upstream(dir: &Path) -> Result<bool, Error> {
    Ok(git_answer(dir, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?.is_some())
}

/// Puts the changes of `paths` aside (every change without any), new files included, under
/// `message` (git's own when `None`), leaving them as HEAD has them. The stash's commits
/// are signed by `identity`.
pub fn stash(
    dir: &Path,
    message: Option<&str>,
    paths: &[String],
    identity: Option<&Identity>,
) -> Result<(), Error> {
    let mut args = vec!["stash", "push", "--include-untracked"];
    if let Some(message) = message {
        args.extend(["-m", message]);
    }
    if !paths.is_empty() {
        args.push("--");
        args.extend(paths.iter().map(String::as_str));
    }
    git_as(dir, &args, identity).map(drop)
}

/// Throws away the changes of `paths`, staged ones too when `staged`: followed files go
/// back to what is staged (to HEAD), new files are deleted.
pub fn discard(dir: &Path, paths: &[String], staged: bool) -> Result<(), Error> {
    if staged {
        unstage(dir, paths)?;
    }
    let mut args = vec!["ls-files", "-z", "--others", "--exclude-standard", "--"];
    args.extend(paths.iter().map(String::as_str));
    let out = git(dir, &args)?;
    let untracked: Vec<String> = out
        .split(|&b| b == 0)
        .filter(|p| !p.is_empty())
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect();
    let followed: Vec<String> = paths.iter().filter(|p| !untracked.contains(p)).cloned().collect();
    with_paths(dir, &["restore"], &followed)?;
    with_paths(dir, &["clean", "-f", "-q"], &untracked)
}

/// Throws away every change, staged or not, new files included: the working tree as HEAD
/// has it.
pub fn discard_all(dir: &Path) -> Result<(), Error> {
    if has_commits(dir)? {
        git(dir, &["reset", "-q", "--hard"])?;
    } else {
        git(dir, &["rm", "-r", "-q", "--cached", "--ignore-unmatch", "."])?;
    }
    git(dir, &["clean", "-f", "-d", "-q"]).map(drop)
}

/// Brings back the changes of the stash `id`, kept in the list.
pub fn stash_apply(dir: &Path, index: usize, id: &str) -> Result<(), Error> {
    with_stash(dir, "apply", index, id)
}

/// Brings back the changes of the stash `id` and takes it off the list, unless they clash
/// with the working tree.
pub fn stash_pop(dir: &Path, index: usize, id: &str) -> Result<(), Error> {
    with_stash(dir, "pop", index, id)
}

/// Throws the stash `id` away.
pub fn stash_drop(dir: &Path, index: usize, id: &str) -> Result<(), Error> {
    with_stash(dir, "drop", index, id)
}

/// Runs `git stash command stash@{index}`, once sure that it is still the stash `id`: the
/// list shifts as stashes come and go.
fn with_stash(dir: &Path, command: &str, index: usize, id: &str) -> Result<(), Error> {
    let name = format!("stash@{{{index}}}");
    let found = git_answer(dir, &["rev-parse", "--verify", "-q", &name])?;
    if found.as_deref().map(|f| String::from_utf8_lossy(f).trim().to_owned()).as_deref() != Some(id) {
        return Err(Error::Command("The stashes changed meanwhile: look at them again.".into()));
    }
    git(dir, &["stash", command, "-q", &name]).map(drop)
}

/// Puts HEAD on the commit `id`, on no branch.
pub fn checkout_commit(dir: &Path, id: &str) -> Result<(), Error> {
    git(dir, &["switch", "-q", "--detach", id]).map(drop)
}

/// Applies the changes the commit `id` brought (to its first parent, for a merge) onto the
/// current branch, as a new commit signed by `identity`.
pub fn cherry_pick(dir: &Path, id: &str, identity: Option<&Identity>) -> Result<(), Error> {
    with_mainline(dir, "cherry-pick", id, identity)
}

/// A new commit undoing what the commit `id` brought (to its first parent, for a merge).
pub fn revert(dir: &Path, id: &str, identity: Option<&Identity>) -> Result<(), Error> {
    with_mainline(dir, "revert", id, identity)
}

fn with_mainline(dir: &Path, command: &str, id: &str, identity: Option<&Identity>) -> Result<(), Error> {
    let merge = git_answer(dir, &["rev-parse", "--verify", "-q", &format!("{id}^2")])?.is_some();
    let mut args = vec![command, "--no-edit"];
    if merge {
        args.extend(["-m", "1"]);
    }
    args.push(id);
    git_as(dir, &args, identity).map(drop)
}

/// Replays the current branch's own commits on top of the commit `onto`.
pub fn rebase(dir: &Path, onto: &str, identity: Option<&Identity>) -> Result<(), Error> {
    git_as(dir, &["rebase", onto], identity).map(drop)
}

/// How far a reset goes besides moving the branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reset {
    /// The index and the working tree stay: what the commits after held is staged.
    Soft,
    /// The index follows, the working tree stays: their changes are left unstaged.
    Mixed,
    /// Both follow: every change since is gone.
    Hard,
}

/// Moves the current branch to the commit `id`.
pub fn reset(dir: &Path, id: &str, mode: Reset) -> Result<(), Error> {
    let mode = match mode {
        Reset::Soft => "--soft",
        Reset::Mixed => "--mixed",
        Reset::Hard => "--hard",
    };
    git(dir, &["reset", "-q", mode, id]).map(drop)
}

/// The tag `name` on the commit `id`: a plain name, or with `message` an annotated tag,
/// signed by `identity` and dated.
pub fn tag(
    dir: &Path,
    name: &str,
    id: &str,
    message: Option<&str>,
    identity: Option<&Identity>,
) -> Result<(), Error> {
    match message {
        Some(message) => git_as(dir, &["tag", "-a", name, "-m", message, id], identity).map(drop),
        None => git(dir, &["tag", name, id]).map(drop),
    }
}

/// Gives up the operation under way, the repository as it was before it.
pub fn abort(dir: &Path, operation: Operation) -> Result<(), Error> {
    git(dir, &[operation.command(), "--abort"]).map(drop)
}

/// Goes on with the operation under way, its conflicts resolved and staged.
pub fn proceed(dir: &Path, operation: Operation, identity: Option<&Identity>) -> Result<(), Error> {
    git_as(dir, &[operation.command(), "--continue"], identity).map(drop)
}

/// Merges `from` into the branch `into`, switched to first when it is not the current one;
/// a merge commit, when one is made, is signed by `identity`.
pub fn merge(dir: &Path, from: &str, into: Option<&str>, identity: Option<&Identity>) -> Result<(), Error> {
    if let Some(into) = into {
        git(dir, &["switch", "-q", into])?;
    }
    git_as(dir, &["merge", "--no-edit", from], identity).map(drop)
}

/// Replays the commits of `branch` (switched to first) on top of `onto`.
pub fn rebase_branch(dir: &Path, branch: &str, onto: &str, identity: Option<&Identity>) -> Result<(), Error> {
    git_as(dir, &["rebase", onto, branch], identity).map(drop)
}

/// Deletes the local branch `name`; one whose commits are nowhere else only with `force`.
pub fn delete_branch(dir: &Path, name: &str, force: bool) -> Result<(), Error> {
    git(dir, &["branch", if force { "-D" } else { "-d" }, name]).map(drop)
}

/// Deletes the branch `name` (`origin/feature`) on its remote.
pub fn delete_remote_branch(dir: &Path, name: &str) -> Result<(), Error> {
    let (remote, branch) =
        name.split_once('/').ok_or_else(|| Error::Command(format!("{name} is not a remote branch")))?;
    git(dir, &["push", "-q", remote, "--delete", branch]).map(drop)
}

pub fn rename_branch(dir: &Path, name: &str, new_name: &str) -> Result<(), Error> {
    git(dir, &["branch", "-m", name, new_name]).map(drop)
}

/// Makes the local branch `name` follow the remote branch `upstream` (`origin/feature`).
pub fn set_upstream(dir: &Path, name: &str, upstream: &str) -> Result<(), Error> {
    git(dir, &["branch", "-q", &format!("--set-upstream-to={upstream}"), name]).map(drop)
}

/// Sends the local branch `name` to its upstream; without one, to `origin`, which it then
/// follows.
pub fn push_branch(dir: &Path, name: &str) -> Result<(), Error> {
    let remote = git_answer(dir, &["config", &format!("branch.{name}.remote")])?;
    match remote.map(|r| String::from_utf8_lossy(&r).trim().to_owned()) {
        Some(remote) => git(dir, &["push", &remote, name]).map(drop),
        None => git(dir, &["push", "-u", "origin", name]).map(drop),
    }
}

/// Fetches the remote `name`, dropping the branches it deleted.
pub fn fetch_remote(dir: &Path, name: &str) -> Result<(), Error> {
    git(dir, &["fetch", "--prune", name]).map(drop)
}

pub fn add_remote(dir: &Path, name: &str, url: &str) -> Result<(), Error> {
    git(dir, &["remote", "add", name, url]).map(drop)
}

/// Renames the remote `name` and points it at `url`.
pub fn edit_remote(dir: &Path, name: &str, new_name: &str, url: &str) -> Result<(), Error> {
    if new_name != name {
        git(dir, &["remote", "rename", name, new_name])?;
    }
    git(dir, &["remote", "set-url", new_name, url]).map(drop)
}

pub fn remove_remote(dir: &Path, name: &str) -> Result<(), Error> {
    git(dir, &["remote", "remove", name]).map(drop)
}

pub fn delete_tag(dir: &Path, name: &str) -> Result<(), Error> {
    git(dir, &["tag", "-d", name]).map(drop)
}

/// Sends the tag `name` to the remote `remote`.
pub fn push_tag(dir: &Path, remote: &str, name: &str) -> Result<(), Error> {
    git(dir, &["push", "-q", remote, &format!("refs/tags/{name}")]).map(drop)
}

/// A commit the current branch would replay in a rebase, oldest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub id: String,
    pub summary: String,
    pub message: String,
}

/// The commits of the current branch since `onto`, as an interactive rebase would list
/// them: oldest first, merges left out.
pub fn rebase_plan(dir: &Path, onto: &str) -> Result<Vec<Planned>, Error> {
    let range = format!("{onto}..HEAD");
    let out = git(dir, &["log", "--reverse", "--no-merges", "--format=%H%x1f%s%x1f%B%x1e", &range])?;
    let text = String::from_utf8_lossy(&out);
    Ok(text
        .split('\u{1e}')
        .map(str::trim)
        .filter(|record| !record.is_empty())
        .filter_map(|record| {
            let mut fields = record.splitn(3, '\u{1f}');
            Some(Planned {
                id: fields.next()?.to_owned(),
                summary: fields.next()?.to_owned(),
                message: fields.next().unwrap_or_default().trim().to_owned(),
            })
        })
        .collect())
}

/// What an interactive rebase does with a commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepAction {
    Pick,
    /// Picked, with the step's message.
    Reword,
    /// Joined to the commit before, their messages put together.
    Squash,
    /// Joined to the commit before, its message dropped.
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub action: StepAction,
    pub message: Option<String>,
}

/// Replays the current branch on top of `onto` as `steps` say, in their order. The new
/// messages are kept in the repository's own folder: a rebase stopped on conflicts still
/// finds them when it goes on.
pub fn rebase_interactive(
    dir: &Path,
    onto: &str,
    steps: &[Step],
    identity: Option<&Identity>,
) -> Result<(), Error> {
    if let Some(first) = steps.iter().find(|s| s.action != StepAction::Drop) {
        if matches!(first.action, StepAction::Squash | StepAction::Fixup) {
            return Err(Error::Command(
                "The first commit kept cannot be squashed into the one before it.".into(),
            ));
        }
    }
    let work = rebase_folder(dir)?;
    let mut todo = String::new();
    for (i, step) in steps.iter().enumerate() {
        let word = match step.action {
            StepAction::Pick | StepAction::Reword => "pick",
            StepAction::Squash => "squash",
            StepAction::Fixup => "fixup",
            StepAction::Drop => "drop",
        };
        todo.push_str(&format!("{word} {}\n", step.id));
        if let (StepAction::Reword, Some(message)) = (step.action, &step.message) {
            let file = write_in(&work, &format!("message-{i}"), message)?;
            todo.push_str(&format!("exec git commit --amend --only --quiet -F \"{file}\"\n"));
        }
    }
    replay(dir, Some(onto), &work, &todo, identity)
}

/// What a commit becomes, rewritten: its message, its author and its date.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rewrite {
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    /// Seconds since 1970, and the offset from UTC it is told in, in minutes.
    pub time: i64,
    pub offset: i32,
    /// The commit date set to the same as well: most tools show that one.
    pub commit_date_too: bool,
}

impl Rewrite {
    /// The date as git reads it: `1700000000 +0200`.
    fn date(&self) -> String {
        let sign = if self.offset < 0 { '-' } else { '+' };
        let minutes = self.offset.unsigned_abs();
        format!("{} {sign}{:02}{:02}", self.time, minutes / 60, minutes % 60)
    }
}

/// Gives the commit `id` of the current branch a new message, author and date; the commits
/// after it are replayed on top, unchanged.
pub fn rewrite(dir: &Path, id: &str, to: &Rewrite, identity: Option<&Identity>) -> Result<(), Error> {
    let fields = [&to.author_name, &to.author_email];
    if to.message.trim().is_empty() || fields.iter().any(|f| f.trim().is_empty()) {
        return Err(Error::Command("A commit needs a message, an author name and an email.".into()));
    }
    if fields.iter().any(|f| f.contains(['<', '>', '\n'])) {
        return Err(Error::Command("An author's name or email cannot hold <, > or a line break.".into()));
    }
    if git_answer(dir, &["merge-base", "--is-ancestor", id, "HEAD"])?.is_none() {
        return Err(Error::Command("Only the commits of the current branch can be rewritten.".into()));
    }
    let id = String::from_utf8_lossy(&git(dir, &["rev-parse", id])?).trim().to_owned();
    let parent = git_answer(dir, &["rev-parse", "--verify", "-q", &format!("{id}^")])?
        .map(|p| String::from_utf8_lossy(&p).trim().to_owned());
    let range = parent.as_ref().map_or_else(|| "HEAD".to_owned(), |p| format!("{p}..HEAD"));
    if !git(dir, &["rev-list", "--merges", "-n", "1", &range])?.is_empty() {
        return Err(Error::Command("A merge comes after this commit: it cannot be replayed.".into()));
    }
    let work = rebase_folder(dir)?;
    let message = write_in(&work, "message", &to.message)?;
    let author = format!("{} <{}>", to.author_name.trim(), to.author_email.trim());
    let date = to.date();
    let head = String::from_utf8_lossy(&git(dir, &["rev-parse", "HEAD"])?).trim().to_owned();
    if head == id {
        let env: &[(&str, &str)] = if to.commit_date_too { &[("GIT_COMMITTER_DATE", &date)] } else { &[] };
        let amend =
            ["commit", "--amend", "--only", "--quiet", "--allow-empty", "-F", &message, "--author", &author];
        let amended = git_with(dir, &[&amend[..], &["--date", &date]].concat(), identity, env).map(drop);
        let _ = std::fs::remove_dir_all(&work);
        return amended;
    }
    let committed =
        if to.commit_date_too { format!("GIT_COMMITTER_DATE={} ", quoted(&date)) } else { String::new() };
    let amend = format!(
        "exec {committed}git commit --amend --only --quiet --allow-empty -F \"{message}\" --author={} --date={}\n",
        quoted(&author),
        quoted(&date)
    );
    let mut todo = String::new();
    for commit in String::from_utf8_lossy(&git(dir, &["rev-list", "--reverse", &range])?).lines() {
        todo.push_str(&format!("pick {commit}\n"));
        if commit == id {
            todo.push_str(&amend);
        }
    }
    replay(dir, parent.as_deref(), &work, &todo, identity)
}

/// The folder, in the repository's own, where a rebase's todo and messages are written: a
/// rebase stopped on conflicts still finds them when it goes on. Emptied first.
fn rebase_folder(dir: &Path) -> Result<PathBuf, Error> {
    let git_dir = String::from_utf8_lossy(&git(dir, &["rev-parse", "--absolute-git-dir"])?).trim().to_owned();
    let work = Path::new(&git_dir).join("ramure-rebase");
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(|e| Error::Command(format!("{}: {e}", work.display())))?;
    Ok(work)
}

/// Writes `text` in the rebase's folder; its path as the shell git runs commands in reads it.
fn write_in(work: &Path, name: &str, text: &str) -> Result<String, Error> {
    let path = work.join(name);
    std::fs::write(&path, text).map_err(|e| Error::Command(format!("{}: {e}", path.display())))?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}

/// Replays the commits `todo` lists on top of `onto` (from the very first one without),
/// the changes being worked on set aside meanwhile.
fn replay(
    dir: &Path,
    onto: Option<&str>,
    work: &Path,
    todo: &str,
    identity: Option<&Identity>,
) -> Result<(), Error> {
    let todo = write_in(work, "todo", todo)?;
    let editor = format!("cp \"{todo}\"");
    let base = onto.unwrap_or("--root");
    git_with(dir, &["rebase", "-i", "--autostash", base], identity, &[("GIT_SEQUENCE_EDITOR", &editor)])?;
    // a rebase stopped on conflicts still needs its files; one done, no longer
    let _ = std::fs::remove_dir_all(work);
    Ok(())
}

/// `text` as one word for the shell, whatever it holds.
fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

fn has_commits(dir: &Path) -> Result<bool, Error> {
    Ok(git_answer(dir, &["rev-parse", "--verify", "-q", "HEAD"])?.is_some())
}

fn with_paths(dir: &Path, command: &[&str], paths: &[String]) -> Result<(), Error> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = command.to_vec();
    args.push("--");
    args.extend(paths.iter().map(String::as_str));
    git(dir, &args).map(drop)
}
