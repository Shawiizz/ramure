//! Where HEAD has been.

mod common;

use common::{commit, git, git_at, repository};
use ramure_git::{reflog, RefLogEntry};

#[test]
fn heads_moves_are_listed_the_last_first() {
    let dir = repository();
    let d = dir.path();
    assert!(reflog(d).unwrap().is_empty());
    commit(d, "First", 1);
    commit(d, "Second", 2);
    git_at(d, &["reset", "-q", "--hard", "HEAD~1"], 3);
    git(d, &["switch", "-q", "-c", "feature"]);

    let entries = reflog(d).unwrap();
    let moves: Vec<_> = entries.iter().map(|e| (e.action.as_str(), e.message.as_str())).collect();
    assert_eq!(
        moves,
        [
            ("checkout", "moving from main to feature"),
            ("reset", "moving to HEAD~1"),
            ("commit", "Second"),
            ("commit (initial)", "First"),
        ]
    );
    let RefLogEntry { id, time, .. } = &entries[2];
    assert_eq!(*time, 1_700_000_002);
    assert_eq!(id.len(), 40);
    assert_ne!(*id, entries[1].id);
}
