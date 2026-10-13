//! A repository as Ramure shows it: where HEAD is, its branches and tags, and its history
//! with the graph to draw it.

use crate::graph::{layout, Row};
use crate::status::{status, Status};
use crate::Error;
use gix::bstr::ByteSlice;
use gix::ObjectId;
use serde::Serialize;
use std::collections::{BinaryHeap, HashMap};
use std::path::{Path, PathBuf};

pub struct Repository {
    repo: gix::Repository,
}

/// Everything the main view shows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub name: String,
    pub path: PathBuf,
    pub head: Head,
    pub branches: Vec<Branch>,
    pub remote_branches: Vec<Branch>,
    pub tags: Vec<Branch>,
    pub commits: Vec<Commit>,
    pub graph: Vec<Row>,
    /// The working tree; empty for a repository without one.
    pub status: Status,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Head {
    /// On a branch.
    Branch { name: String },
    /// On a commit, no branch.
    Detached { id: String },
    /// On a branch with no commit yet (a new repository).
    Unborn { name: String },
}

/// A branch or a tag: its short name and the commit it points at.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub target: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub id: String,
    pub parents: Vec<String>,
    pub summary: String,
    /// The message after its summary, empty when there is none.
    pub body: String,
    pub author: String,
    pub email: String,
    /// Seconds since 1970.
    pub time: i64,
}

impl Repository {
    /// The repository holding `path` (the folder itself or any folder inside it).
    pub fn open(path: &Path) -> Result<Self, Error> {
        let repo = gix::discover(path)
            .map_err(|e| Error::NotARepository { path: path.to_owned(), reason: e.to_string() })?;
        Ok(Self { repo })
    }

    /// The repository's state, with its `limit` most recent commits.
    pub fn snapshot(&self, limit: usize) -> Result<Snapshot, Error> {
        let path = self.repo.workdir().unwrap_or_else(|| self.repo.git_dir()).to_owned();
        let name =
            path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned());
        let refs = self.repo.references().map_err(Error::git)?;
        let branches = collect(refs.local_branches().map_err(Error::git)?)?;
        let mut remote_branches = collect(refs.remote_branches().map_err(Error::git)?)?;
        // `origin/HEAD` only names the remote's default branch, listed already
        remote_branches.retain(|b| !b.name.ends_with("/HEAD"));
        let tags = collect(refs.tags().map_err(Error::git)?)?;

        let head_id = self.repo.head_id().ok().map(|id| id.detach());
        let tips: Vec<ObjectId> = head_id
            .into_iter()
            .chain(
                branches
                    .iter()
                    .chain(&remote_branches)
                    .chain(&tags)
                    .filter_map(|b| ObjectId::from_hex(b.target.as_bytes()).ok()),
            )
            .collect();
        let commits = self.history(&tips, limit)?;
        let status = if self.repo.workdir().is_some() { status(&path)? } else { Status::default() };
        let graph = layout(&commits.iter().map(|c| (c.id.clone(), c.parents.clone())).collect::<Vec<_>>());
        Ok(Snapshot {
            name,
            path,
            head: self.head(head_id)?,
            branches,
            remote_branches,
            tags,
            commits,
            graph,
            status,
        })
    }

    fn head(&self, head_id: Option<ObjectId>) -> Result<Head, Error> {
        let name = self.repo.head_name().map_err(Error::git)?.map(|n| n.shorten().to_string());
        Ok(match (name, head_id) {
            (Some(name), Some(_)) => Head::Branch { name },
            (Some(name), None) => Head::Unborn { name },
            (None, Some(id)) => Head::Detached { id: id.to_string() },
            (None, None) => Head::Unborn { name: String::new() },
        })
    }

    /// The commits reachable from `tips`, newest first, every commit before its parents.
    fn history(&self, tips: &[ObjectId], limit: usize) -> Result<Vec<Commit>, Error> {
        if tips.is_empty() {
            return Ok(Vec::new());
        }
        let walk = self
            .repo
            .rev_walk(tips.iter().copied())
            .sorting(gix::revision::walk::Sorting::ByCommitTime(Default::default()))
            .all()
            .map_err(Error::git)?;
        let mut commits = Vec::new();
        for info in walk.take(limit) {
            let info = info.map_err(Error::git)?;
            let commit = info.object().map_err(Error::git)?;
            let author = commit.author().map_err(Error::git)?;
            let message = commit.message().map_err(Error::git)?;
            commits.push(Commit {
                id: info.id.to_string(),
                parents: info.parent_ids().map(|p| p.to_string()).collect(),
                summary: message.summary().to_str_lossy().into_owned(),
                body: message.body.map(|b| b.to_str_lossy().trim().to_owned()).unwrap_or_default(),
                author: author.name.to_str_lossy().into_owned(),
                email: author.email.to_str_lossy().into_owned(),
                time: author.time().map_err(Error::git)?.seconds,
            });
        }
        Ok(children_first(commits))
    }
}

/// Branches or tags, by name, with the commit each points at.
fn collect<'r, E: std::fmt::Display>(
    refs: impl Iterator<Item = Result<gix::Reference<'r>, E>>,
) -> Result<Vec<Branch>, Error> {
    let mut out = Vec::new();
    for reference in refs {
        let mut reference = reference.map_err(Error::git)?;
        let name = reference.name().shorten().to_string();
        let Ok(target) = reference.peel_to_id() else {
            continue;
        };
        out.push(Branch { name, target: target.to_string() });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Orders commits newest first while keeping every commit before its parents (commit
/// dates can lie: a rebase or a wrong clock puts a parent after its child).
fn children_first(commits: Vec<Commit>) -> Vec<Commit> {
    let index: HashMap<&str, usize> = commits.iter().enumerate().map(|(i, c)| (c.id.as_str(), i)).collect();
    let mut children = vec![0usize; commits.len()];
    for commit in &commits {
        for parent in &commit.parents {
            if let Some(&p) = index.get(parent.as_str()) {
                children[p] += 1;
            }
        }
    }
    // ready: no child left to place; newest first, then the walk's order
    let mut ready: BinaryHeap<(i64, std::cmp::Reverse<usize>)> = (0..commits.len())
        .filter(|&i| children[i] == 0)
        .map(|i| (commits[i].time, std::cmp::Reverse(i)))
        .collect();
    let mut order = Vec::with_capacity(commits.len());
    while let Some((_, std::cmp::Reverse(i))) = ready.pop() {
        order.push(i);
        for parent in &commits[i].parents {
            if let Some(&p) = index.get(parent.as_str()) {
                children[p] -= 1;
                if children[p] == 0 {
                    ready.push((commits[p].time, std::cmp::Reverse(p)));
                }
            }
        }
    }
    let mut slots: Vec<Option<Commit>> = commits.into_iter().map(Some).collect();
    order.into_iter().filter_map(|i| slots[i].take()).collect()
}
