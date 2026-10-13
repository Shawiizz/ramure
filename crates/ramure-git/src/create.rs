//! Repositories coming to be: cloned from a remote, or made anew in an empty folder.

use crate::cli::{command, git, git_as};
use crate::{Error, Identity};
use std::io::Read;
use std::path::Path;
use std::process::Stdio;

/// Clones `url` into the folder `into`, which git makes; `progress` hears each line git
/// tells of it ("Receiving objects: 42% (420/1000)") as it comes.
pub fn clone(url: &str, into: &Path, mut progress: impl FnMut(&str)) -> Result<(), Error> {
    let into = into.to_string_lossy();
    let mut child = command(None, &["clone", "--progress", "--", url, &into], None, &[])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::Command(format!("git could not run: {e}")))?;
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let mut said = Vec::new();
    let mut line = Vec::new();
    let mut buffer = [0u8; 4096];
    // progress comes in lines ended by a carriage return, each over the one before
    while let Ok(read @ 1..) = stderr.read(&mut buffer) {
        for &byte in &buffer[..read] {
            if byte != b'\r' && byte != b'\n' {
                line.push(byte);
                continue;
            }
            let text = String::from_utf8_lossy(&line).trim().to_owned();
            line.clear();
            if !text.is_empty() {
                progress(&text);
                said.push(text);
            }
        }
    }
    let status = child.wait().map_err(|e| Error::Command(format!("git could not run: {e}")))?;
    if status.success() {
        return Ok(());
    }
    let failure: Vec<&str> = said
        .iter()
        .map(String::as_str)
        .filter(|l| l.starts_with("fatal:") || l.starts_with("error:"))
        .collect();
    let message =
        if failure.is_empty() { said.last().map_or("", String::as_str) } else { &failure.join("\n") };
    Err(Error::Command(message.to_owned()))
}

/// A new repository in the folder `dir`, made when missing; with `readme`, a README of that
/// title in a first commit signed by `identity`.
pub fn init(dir: &Path, readme: Option<&str>, identity: Option<&Identity>) -> Result<(), Error> {
    std::fs::create_dir_all(dir).map_err(|e| Error::Command(format!("{}: {e}", dir.display())))?;
    git(dir, &["init", "-q"])?;
    let Some(title) = readme else { return Ok(()) };
    let file = dir.join("README.md");
    std::fs::write(&file, format!("# {title}\n"))
        .map_err(|e| Error::Command(format!("{}: {e}", file.display())))?;
    git(dir, &["add", "README.md"])?;
    git_as(dir, &["commit", "-q", "-m", "First commit"], identity).map(drop)
}
