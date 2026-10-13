//! What changes a repository or talks to its remotes, through the git command.

use crate::cli::{git, git_answer, git_as};
use crate::{Error, Identity};
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
