//! Part of a file's changes staged, unstaged or thrown away: a hunk, or lines picked in it.
//! git's own diff of the file is cut down to the lines picked and applied with `git apply`.

use crate::cli::git;
use crate::Error;
use serde::Deserialize;
use std::path::Path;

/// What becomes of the lines picked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Part {
    /// From the working tree to the index.
    Stage,
    /// Out of the index, kept in the working tree.
    Unstage,
    /// Out of the working tree, back to what the index holds.
    Discard,
}

/// A changed line: a removed one by its number in the old version, an added one by its
/// number in the new.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct Picked {
    pub old: Option<u32>,
    pub new: Option<u32>,
}

/// Stages, unstages or throws away the lines `picked` of the file `path`.
pub fn apply_lines(dir: &Path, path: &str, part: Part, picked: &[Picked]) -> Result<(), Error> {
    let mut diff = file_patch(dir, path, part)?;
    // a file git does not follow has no diff until git is told of it
    if diff.is_empty() && part == Part::Stage {
        git(dir, &["add", "--intent-to-add", "--", path])?;
        diff = file_patch(dir, path, part)?;
    }
    let reverse = part != Part::Stage;
    let patch =
        cut(&diff, picked, reverse).ok_or_else(|| Error::Command("None of these lines changed.".into()))?;
    let git_dir = git(dir, &["rev-parse", "--absolute-git-dir"])?;
    let file = Path::new(String::from_utf8_lossy(&git_dir).trim()).join("ramure-part.patch");
    std::fs::write(&file, &patch).map_err(|e| Error::Command(format!("{}: {e}", file.display())))?;
    let name = file.to_string_lossy();
    let mut args = vec!["apply", "--recount", "--whitespace=nowarn"];
    if part != Part::Discard {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    args.push(&name);
    let applied = git(dir, &args).map(drop);
    let _ = std::fs::remove_file(&file);
    applied
}

/// git's diff of `path` where `part` takes its lines from: the index against HEAD to
/// unstage, the working tree against the index otherwise.
fn file_patch(dir: &Path, path: &str, part: Part) -> Result<Vec<u8>, Error> {
    let mut args = vec!["diff", "--no-ext-diff", "--no-color", "--no-renames", "-U3"];
    if part == Part::Unstage {
        args.push("--cached");
    }
    args.extend(["--", path]);
    git(dir, &args)
}

/// The diff cut down to the lines `picked`, None when it has none of them. A line not
/// picked is left as it is where the patch applies: context there if it is there, gone if
/// not. Forward, that keeps a removed line and drops an added one; reversed, the opposite.
fn cut(diff: &[u8], picked: &[Picked], reverse: bool) -> Option<Vec<u8>> {
    let lines: Vec<&[u8]> = diff.split_inclusive(|&b| b == b'\n').collect();
    let first = lines.iter().position(|l| l.starts_with(b"@@"))?;
    let mut hunks = Vec::new();
    let mut hunk = Vec::new();
    let mut hunk_picked = false;
    let mut every = true;
    let (mut old, mut new) = (0, 0);
    // a "\ No newline at end of file" goes with the line before it
    let mut kept = false;
    for line in &lines[first..] {
        let (chosen, there) = match line.first() {
            Some(b'@') => {
                if hunk_picked {
                    hunks.append(&mut hunk);
                }
                hunk.clear();
                hunk_picked = false;
                (old, new) = starts(line);
                hunk.extend_from_slice(line);
                continue;
            }
            Some(b' ') => {
                old += 1;
                new += 1;
                (true, true)
            }
            Some(b'-') => {
                old += 1;
                (picked.contains(&Picked { old: Some(old - 1), new: None }), !reverse)
            }
            Some(b'+') => {
                new += 1;
                (picked.contains(&Picked { old: None, new: Some(new - 1) }), reverse)
            }
            Some(b'\\') => {
                if kept {
                    hunk.extend_from_slice(line);
                }
                continue;
            }
            _ => continue,
        };
        kept = chosen || there;
        if line[0] == b' ' || chosen {
            hunk.extend_from_slice(line);
        } else if there {
            hunk.push(b' ');
            hunk.extend_from_slice(&line[1..]);
        }
        if line[0] != b' ' {
            hunk_picked |= chosen;
            every &= chosen;
        }
    }
    if hunk_picked {
        hunks.append(&mut hunk);
    }
    if hunks.is_empty() {
        return None;
    }
    let mut patch = header(&lines[..first], every);
    patch.append(&mut hunks);
    Some(patch)
}

/// The diff's header, made to change the file in place when only part of a file created or
/// deleted is picked: that part neither creates nor deletes it.
fn header(lines: &[&[u8]], whole: bool) -> Vec<u8> {
    if whole {
        return lines.concat();
    }
    let path = |prefix: &[u8], from: &[u8], to: &[u8]| {
        let line = lines.iter().find(|l| l.starts_with(prefix) && !l.ends_with(b"/dev/null\n"))?;
        let rest = String::from_utf8_lossy(&line[prefix.len()..]).into_owned();
        Some(rest.replacen(std::str::from_utf8(from).ok()?, std::str::from_utf8(to).ok()?, 1).into_bytes())
    };
    let mut out = Vec::new();
    for line in lines {
        if line.starts_with(b"new file mode") || line.starts_with(b"deleted file mode") {
            continue;
        }
        if *line == b"--- /dev/null\n" {
            out.extend_from_slice(b"--- ");
            out.extend(path(b"+++ ", b"b/", b"a/").unwrap_or_default());
        } else if *line == b"+++ /dev/null\n" {
            out.extend_from_slice(b"+++ ");
            out.extend(path(b"--- ", b"a/", b"b/").unwrap_or_default());
        } else {
            out.extend_from_slice(line);
        }
    }
    out
}

/// The first old and new line numbers of a `@@ -12,3 +14,4 @@` header.
fn starts(header: &[u8]) -> (u32, u32) {
    let text = String::from_utf8_lossy(header);
    let number = |sign: char| {
        text.split_whitespace()
            .find_map(|part| part.strip_prefix(sign))
            .and_then(|range| range.split(',').next()?.parse().ok())
            .unwrap_or(0)
    };
    (number('-'), number('+'))
}
