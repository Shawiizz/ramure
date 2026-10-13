//! The git command, for what changes a repository or reaches a remote: it brings the
//! user's own configuration, hooks and credentials with it.

use crate::{Error, Identity};
use std::path::Path;
use std::process::{Command, Output};

/// Runs `git args` in `dir` and returns what it printed; its error message when it fails.
pub(crate) fn git(dir: &Path, args: &[&str]) -> Result<Vec<u8>, Error> {
    git_as(dir, args, None)
}

/// Like [`git`], the commits it makes signed by `identity` rather than the configured one.
pub(crate) fn git_as(dir: &Path, args: &[&str], identity: Option<&Identity>) -> Result<Vec<u8>, Error> {
    let output = run(Some(dir), args, identity)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(Error::Command(message(&output)))
    }
}

/// Like [`git`], for commands whose failure is an answer (a missing upstream, say).
pub(crate) fn git_answer(dir: &Path, args: &[&str]) -> Result<Option<Vec<u8>>, Error> {
    answer(Some(dir), args)
}

/// Like [`git_answer`], outside any repository.
pub(crate) fn git_global(args: &[&str]) -> Result<Option<Vec<u8>>, Error> {
    answer(None, args)
}

fn answer(dir: Option<&Path>, args: &[&str]) -> Result<Option<Vec<u8>>, Error> {
    let output = run(dir, args, None)?;
    Ok(output.status.success().then_some(output.stdout))
}

fn run(dir: Option<&Path>, args: &[&str], identity: Option<&Identity>) -> Result<Output, Error> {
    let mut command = Command::new("git");
    command
        .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        // never wait for an answer on a terminal nobody sees, nor in an editor: a message
        // git would ask for is the one it proposes
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true");
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    if let Some(identity) = identity {
        for role in ["AUTHOR", "COMMITTER"] {
            command
                .env(format!("GIT_{role}_NAME"), &identity.name)
                .env(format!("GIT_{role}_EMAIL"), &identity.email);
        }
    }
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
            .join("\n")
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
