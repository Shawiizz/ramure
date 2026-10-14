//! Files as they are, kept in git's object database to be put back: changes thrown away
//! come back with Undo, and go again with Redo.

use crate::cli::{git, git_fed};
use crate::Error;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// A file as it was: its bytes in the working tree, its entries in the index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub path: String,
    /// The blob holding its bytes, unfiltered; none when there was no such file.
    pub blob: Option<String>,
    /// Its index entries as `git ls-files --stage` writes them: none when git did not
    /// follow it, one for each side in a conflict.
    pub index: Vec<String>,
}

/// Saves the files `paths` as they are now, in the order of their paths.
pub fn save_files(dir: &Path, paths: &[String]) -> Result<Vec<SavedFile>, Error> {
    let mut saved: BTreeMap<&str, SavedFile> = paths
        .iter()
        .map(|path| (path.as_str(), SavedFile { path: path.clone(), blob: None, index: Vec::new() }))
        .collect();
    // the paths go in on git's input: thousands of them would not fit on its command line
    let present: Vec<&str> = saved.keys().copied().filter(|p| dir.join(p).is_file()).collect();
    if !present.is_empty() {
        let list: String = present.iter().flat_map(|p| [p, "\n"]).collect();
        let out = git_fed(dir, &["hash-object", "-w", "--no-filters", "--stdin-paths"], list.as_bytes())?;
        for (path, blob) in present.iter().zip(String::from_utf8_lossy(&out).lines()) {
            if let Some(file) = saved.get_mut(path) {
                file.blob = Some(blob.to_owned());
            }
        }
    }
    let out = git(dir, &["ls-files", "--stage", "-z"])?;
    for entry in out.split(|&b| b == 0).map(String::from_utf8_lossy) {
        let Some((_, path)) = entry.split_once('\t') else { continue };
        if let Some(file) = saved.get_mut(path) {
            file.index.push(entry.into_owned());
        }
    }
    Ok(saved.into_values().collect())
}

/// Puts the files back as `to` has them, from `from`, which must be how they are now: files
/// changed since by other means are left alone.
pub fn restore_files(dir: &Path, to: &[SavedFile], from: &[SavedFile]) -> Result<(), Error> {
    let paths: Vec<String> = from.iter().map(|f| f.path.clone()).collect();
    if save_files(dir, &paths)? != from {
        return Err(Error::Command(
            "The files changed since: there is nothing to undo or redo safely.".into(),
        ));
    }
    let listed: Vec<u8> = paths.iter().flat_map(|p| p.bytes().chain([0])).collect();
    git_fed(dir, &["update-index", "--force-remove", "-z", "--stdin"], &listed)?;
    let entries: Vec<u8> = to.iter().flat_map(|f| &f.index).flat_map(|e| e.bytes().chain([0])).collect();
    if !entries.is_empty() {
        git_fed(dir, &["update-index", "-z", "--index-info"], &entries)?;
    }
    for file in to {
        let full = dir.join(&file.path);
        match &file.blob {
            Some(blob) => {
                let bytes = git(dir, &["cat-file", "blob", blob])?;
                if let Some(parent) = full.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| io(&full, e))?;
                }
                std::fs::write(&full, bytes).map_err(|e| io(&full, e))?;
            }
            None if full.is_file() => std::fs::remove_file(&full).map_err(|e| io(&full, e))?,
            None => {}
        }
    }
    Ok(())
}

fn io(path: &Path, e: std::io::Error) -> Error {
    Error::Command(format!("{}: {e}", path.display()))
}
