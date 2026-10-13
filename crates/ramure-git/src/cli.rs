//! The git command, for what changes a repository or reaches a remote: it brings the
//! user's own configuration, hooks and credentials with it.

use crate::Error;
use std::path::Path;
use std::process::{Command, Output};

/// Runs `git args` in `dir` and returns what it printed; its error message when it fails.
pub(crate) fn git(dir: &Path, args: &[&str]) -> Result<Vec<u8>, Error> {
    let output = run(dir, args)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(Error::Command(message(&output)))
    }
}

/// Like [`git`], for commands whose failure is an answer (a missing upstream, say).
pub(crate) fn git_answer(dir: &Path, args: &[&str]) -> Result<Option<Vec<u8>>, Error> {
    let output = run(dir, args)?;
    Ok(output.status.success().then_some(output.stdout))
}

fn run(dir: &Path, args: &[&str]) -> Result<Output, Error> {
    let mut command = Command::new("git");
    command
        .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        .current_dir(dir)
        // never wait for an answer on a terminal nobody sees
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.output().map_err(|e| Error::Command(format!("git could not run: {e}")))
}

/// What git said went wrong, without its hints on how to read the manual.
fn message(output: &Output) -> String {
    let said = |bytes: &[u8]| {
        String::from_utf8_lossy(bytes)
            .lines()
            .filter(|line| !line.starts_with("hint:"))
            .collect::<Vec<_>>()
            .join(
                "
",
            )
            .trim()
            .to_owned()
    };
    let text = said(&output.stderr);
    if text.is_empty() {
        said(&output.stdout)
    } else {
        text
    }
}
