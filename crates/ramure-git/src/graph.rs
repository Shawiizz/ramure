//! The commit graph: each commit gets a lane (a column), and each row tells which lines
//! cross it, so the history draws as branches that split and join.
//!
//! Commits come newest first, every commit before its parents. A lane waits for one
//! commit: the next commit of its branch. A commit takes the lane waiting for it (or a free
//! one) and its first parent continues that lane, so a branch keeps its column; its other
//! parents (a merge) join a lane already waiting for them, or open one. Lanes waiting for
//! the same commit join in it.

use serde::Serialize;

/// What crosses one row of the graph, a commit in the middle of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    /// The commit's lane.
    pub lane: usize,
    /// Lanes running through the whole row, past the commit.
    pub through: Vec<usize>,
    /// Lanes that end in the commit: its children above, in these lanes.
    pub into: Vec<usize>,
    /// Lanes the commit's parents continue in, below it.
    pub out: Vec<usize>,
    /// Lanes in use at the row, to size it.
    pub width: usize,
}

/// Lays out commits given newest first, each as its id and its parents' ids.
pub fn layout<Id: PartialEq + Clone>(commits: &[(Id, Vec<Id>)]) -> Vec<Row> {
    let mut lanes: Vec<Option<Id>> = Vec::new();
    let mut rows = Vec::with_capacity(commits.len());
    for (id, parents) in commits {
        let before = lanes.clone();
        let waiting = |lanes: &[Option<Id>], id: &Id| -> Vec<usize> {
            lanes.iter().enumerate().filter(|(_, l)| l.as_ref() == Some(id)).map(|(i, _)| i).collect()
        };
        let into = waiting(&before, id);
        let lane = match into.first() {
            Some(&lane) => lane,
            None => free_lane(&mut lanes),
        };
        for &l in &into {
            lanes[l] = None;
        }

        let mut out = Vec::with_capacity(parents.len());
        for (i, parent) in parents.iter().enumerate() {
            let target = if i == 0 {
                lane
            } else {
                match waiting(&lanes, parent).first() {
                    Some(&l) => l,
                    None => free_lane(&mut lanes),
                }
            };
            lanes[target] = Some(parent.clone());
            if !out.contains(&target) {
                out.push(target);
            }
        }

        let through = before
            .iter()
            .enumerate()
            .filter(|(i, l)| l.is_some() && !into.contains(i) && lanes.get(*i) == Some(*l))
            .map(|(i, _)| i)
            .collect();
        let width = before.len().max(lanes.len()).max(lane + 1);
        while lanes.last().is_some_and(Option::is_none) {
            lanes.pop();
        }
        rows.push(Row { lane, through, into, out, width });
    }
    rows
}

/// The first lane waiting for nothing, or a new one.
fn free_lane<Id>(lanes: &mut Vec<Option<Id>>) -> usize {
    match lanes.iter().position(Option::is_none) {
        Some(lane) => lane,
        None => {
            lanes.push(None);
            lanes.len() - 1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(id: &'static str, parents: &[&'static str]) -> (&'static str, Vec<&'static str>) {
        (id, parents.to_vec())
    }

    #[test]
    fn a_straight_history_stays_in_one_lane() {
        let rows = layout(&[c("c", &["b"]), c("b", &["a"]), c("a", &[])]);
        assert!(rows.iter().all(|r| r.lane == 0 && r.through.is_empty()));
        assert_eq!(rows[0].into, Vec::<usize>::new());
        assert_eq!(rows[1].into, vec![0]);
        assert_eq!(rows[2].out, Vec::<usize>::new());
    }

    #[test]
    fn a_merged_branch_opens_a_lane_and_joins_back_where_it_started() {
        // m merges f into main; f branched from a; b is main's own commit
        let rows = layout(&[c("m", &["b", "f"]), c("f", &["a"]), c("b", &["a"]), c("a", &[])]);
        assert_eq!((rows[0].lane, rows[0].out.clone()), (0, vec![0, 1]));
        assert_eq!((rows[1].lane, rows[1].through.clone()), (1, vec![0]));
        assert_eq!((rows[2].lane, rows[2].through.clone(), rows[2].out.clone()), (0, vec![1], vec![0]));
        // both lanes wait for a: they join in it
        assert_eq!((rows[3].lane, rows[3].into.clone()), (0, vec![0, 1]));
        assert_eq!(rows[3].width, 2);
    }

    #[test]
    fn two_branch_tips_take_two_lanes() {
        let rows = layout(&[c("x", &["a"]), c("y", &["a"]), c("a", &[])]);
        assert_eq!(rows[0].lane, 0);
        assert_eq!((rows[1].lane, rows[1].through.clone()), (1, vec![0]));
        assert_eq!(rows[1].out, vec![1]);
        assert_eq!(rows[2].into, vec![0, 1]);
    }

    #[test]
    fn a_freed_lane_is_taken_again() {
        // x and y end, then z starts a new branch: it reuses lane 1
        let rows = layout(&[
            c("m", &["b", "f"]),
            c("f", &["a"]),
            c("b", &["a"]),
            c("a", &["r"]),
            c("z", &["r"]),
            c("r", &[]),
        ]);
        assert_eq!(rows[4].lane, 1);
        assert_eq!(rows[5].into, vec![0, 1]);
    }
}
