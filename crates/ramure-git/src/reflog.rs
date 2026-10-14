//! Where HEAD has been: each commit it pointed to, and what moved it there. What a reset or
//! a rebase seems to have lost is found again here.

use crate::cli::git_answer;
use crate::Error;
use serde::Serialize;
use std::path::Path;

/// The entries read at most: older ones are rarely looked for.
const MAX_ENTRIES: &str = "-n500";

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefLogEntry {
    /// The commit HEAD pointed to.
    pub id: String,
    /// What moved it: `commit`, `checkout`, `reset`, `rebase (finish)`…
    pub action: String,
    /// What git says of it: `moving from main to feature`, a commit's summary…
    pub message: String,
    /// When, in seconds since the epoch.
    pub time: i64,
}

/// HEAD's moves, the last first; none in a repository without commits.
pub fn reflog(dir: &Path) -> Result<Vec<RefLogEntry>, Error> {
    let format = "--format=%H%x1f%gd%x1f%gs%x1e";
    let Some(out) = git_answer(dir, &["reflog", "show", "--date=unix", MAX_ENTRIES, format, "HEAD"])? else {
        return Ok(Vec::new());
    };
    let text = String::from_utf8_lossy(&out);
    let mut entries = Vec::new();
    for record in text.split('\u{1e}').map(str::trim).filter(|r| !r.is_empty()) {
        let [id, selector, subject] = record.split('\u{1f}').collect::<Vec<_>>()[..] else {
            return Err(Error::Command(format!("Unexpected reflog entry: {record}")));
        };
        // `HEAD@{1697012345}`, the date asked for in place of the place in the list
        let time = selector
            .split_once('{')
            .and_then(|(_, rest)| rest.trim_end_matches('}').parse().ok())
            .unwrap_or_default();
        let (action, message) = subject.split_once(": ").unwrap_or((subject, ""));
        entries.push(RefLogEntry {
            id: id.to_owned(),
            action: action.to_owned(),
            message: message.to_owned(),
            time,
        });
    }
    Ok(entries)
}
