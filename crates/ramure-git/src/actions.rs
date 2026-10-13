//! What changes a repository or talks to its remotes, through the git command.

use crate::cli::{git, git_answer, git_as};
use crate::{Error, Identity, Operation};
use serde::Deserialize;
use std::path::Path;

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

/// Fetches every remote, dropping the branches they deleted.
pub fn fetch(dir: &Path) -> Result<(), Error> {
    git(dir, &["fetch", "--all", "--prune"]).map(drop)
}

/// Brings the upstream's commits into the current branch, as the user's settings say; a
/// merge commit it makes is signed by `identity`.
pub fn pull(dir: &Path, identity: Option<&Identity>) -> Result<(), Error> {
    git_as(dir, &["pull"], identity).map(drop)
}

/// Sends the current branch to its upstream; without one, to `origin`, which it then
/// follows.
pub fn push(dir: &Path) -> Result<(), Error> {
    let upstream = git_answer(dir, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?;
    if upstream.is_some() {
        git(dir, &["push"]).map(drop)
    } else {
        git(dir, &["push", "-u", "origin", "HEAD"]).map(drop)
    }
}

/// Puts every change aside, new files included, under `message` (git's own when `None`),
/// leaving the working tree as HEAD has it. The stash's commits are signed by `identity`.
pub fn stash(dir: &Path, message: Option<&str>, identity: Option<&Identity>) -> Result<(), Error> {
    let mut args = vec!["stash", "push", "--include-untracked"];
    if let Some(message) = message {
        args.extend(["-m", message]);
    }
    git_as(dir, &args, identity).map(drop)
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
