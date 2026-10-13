//! Undo and redo: where HEAD and every branch and tag were before an action and after it,
//! and putting them back.

use crate::cli::{git, git_answer};
use crate::Error;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// Where HEAD is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HeadAt {
    Branch { name: String },
    Detached { id: String },
}

/// HEAD, and the object each branch and tag names (`refs/heads/…`, `refs/tags/…`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefState {
    pub head: HeadAt,
    pub refs: BTreeMap<String, String>,
}

/// How the checked-out branch goes back or forth when it moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Move {
    /// The working tree and the index stay as they are (undoing a commit: its changes
    /// come back staged).
    Soft,
    /// The files follow the commit, local changes kept (undoing a merge, a revert…).
    Keep,
}

pub fn ref_state(dir: &Path) -> Result<RefState, Error> {
    let out = git(dir, &["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads", "refs/tags"])?;
    let refs = String::from_utf8_lossy(&out)
        .lines()
        .filter_map(|line| line.split_once('\0'))
        .map(|(name, id)| (name.to_owned(), id.to_owned()))
        .collect();
    let head = match git_answer(dir, &["symbolic-ref", "-q", "--short", "HEAD"])? {
        Some(name) => HeadAt::Branch { name: String::from_utf8_lossy(&name).trim().to_owned() },
        None => {
            let id = git(dir, &["rev-parse", "HEAD"])?;
            HeadAt::Detached { id: String::from_utf8_lossy(&id).trim().to_owned() }
        }
    };
    Ok(RefState { head, refs })
}

/// Puts HEAD and the branches and tags back as `to` has them, from `from`, which must be
/// how they are now: a repository changed since by other means is left alone.
pub fn restore(dir: &Path, to: &RefState, from: &RefState, how: Move) -> Result<(), Error> {
    if &ref_state(dir)? != from {
        return Err(Error::Command(
            "The repository changed since: there is nothing to undo or redo safely.".into(),
        ));
    }
    let branch_ref = |head: &HeadAt| match head {
        HeadAt::Branch { name } => Some(format!("refs/heads/{name}")),
        HeadAt::Detached { .. } => None,
    };
    let checked_out_now = branch_ref(&from.head);
    let checked_out_then = branch_ref(&to.head);
    // the names checked out neither now nor then are moved as they are
    let names: BTreeSet<&String> = to.refs.keys().chain(from.refs.keys()).collect();
    for name in names {
        if Some(name) != checked_out_now.as_ref() && Some(name) != checked_out_then.as_ref() {
            set_ref(dir, name, from.refs.get(name), to.refs.get(name))?;
        }
    }
    match (&to.head, &checked_out_then) {
        (head, Some(name)) if *head == from.head => {
            if let (Some(id), true) = (to.refs.get(name), to.refs.get(name) != from.refs.get(name)) {
                let how = if how == Move::Soft { "--soft" } else { "--keep" };
                git(dir, &["reset", "-q", how, id])?;
            }
        }
        (HeadAt::Branch { name: short }, Some(name)) => {
            set_ref(dir, name, from.refs.get(name), to.refs.get(name))?;
            git(dir, &["switch", "-q", short])?;
        }
        (HeadAt::Detached { id }, _) if to.head != from.head => {
            git(dir, &["switch", "-q", "--detach", id])?;
        }
        _ => {}
    }
    // the branch checked out before, now that it no longer is
    if let Some(name) = checked_out_now.filter(|_| to.head != from.head) {
        set_ref(dir, &name, from.refs.get(&name), to.refs.get(&name))?;
    }
    Ok(())
}

fn set_ref(dir: &Path, name: &str, now: Option<&String>, then: Option<&String>) -> Result<(), Error> {
    match (now, then) {
        (now, Some(id)) if now != Some(id) => git(dir, &["update-ref", name, id]).map(drop),
        (Some(_), None) => git(dir, &["update-ref", "-d", name]).map(drop),
        _ => Ok(()),
    }
}
