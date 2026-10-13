//! The git command, for what changes a repository or reaches a remote: it brings the
//! user's own configuration, hooks and credentials with it.

use crate::{Error, Identity};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::RwLock;

/// Runs `git args` in `dir` and returns what it printed; its error message when it fails.
pub(crate) fn git(dir: &Path, args: &[&str]) -> Result<Vec<u8>, Error> {
    git_as(dir, args, None)
}

/// Like [`git`], the commits it makes signed by `identity` rather than the configured one.
pub(crate) fn git_as(dir: &Path, args: &[&str], identity: Option<&Identity>) -> Result<Vec<u8>, Error> {
    git_with(dir, args, identity, &[])
}

/// Like [`git_as`], with variables of its own in its environment.
pub(crate) fn git_with(
    dir: &Path,
    args: &[&str],
    identity: Option<&Identity>,
    env: &[(&str, &str)],
) -> Result<Vec<u8>, Error> {
    let output = run(Some(dir), args, identity, env)?;
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
    let output = run(dir, args, None, &[])?;
    Ok(output.status.success().then_some(output.stdout))
}

fn run(
    dir: Option<&Path>,
    args: &[&str],
    identity: Option<&Identity>,
    env: &[(&str, &str)],
) -> Result<Output, Error> {
    command(dir, args, identity, env).output().map_err(|e| Error::Command(format!("git could not run: {e}")))
}

/// The private key git's ssh signs in with, as the settings choose; ssh's own without one.
static SSH_KEY: RwLock<Option<PathBuf>> = RwLock::new(None);

/// The private key every git command from now on signs in to ssh remotes with; `None`
/// leaves ssh to its own configuration.
pub fn set_ssh_key(key: Option<PathBuf>) {
    *SSH_KEY.write().unwrap_or_else(|e| e.into_inner()) = key;
}

/// The private key chosen in the settings, if any.
pub fn ssh_key() -> Option<PathBuf> {
    SSH_KEY.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// The ssh command git runs with the chosen key, as the shell git starts it in reads it;
/// none without a key chosen.
pub fn ssh_command() -> Option<String> {
    let key = ssh_key()?;
    let key = key.to_string_lossy().replace('\\', "/").replace('\'', "'\\''");
    // a host met for the first time is trusted: nobody sees the question ssh would ask
    Some(format!("ssh -i '{key}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"))
}

/// git with `args`, as every command of Ramure runs it: no question asked on a terminal,
/// signed by `identity`, through the chosen ssh key, with `env` besides.
pub(crate) fn command(
    dir: Option<&Path>,
    args: &[&str],
    identity: Option<&Identity>,
    env: &[(&str, &str)],
) -> Command {
    let mut command = Command::new("git");
    command.args(["-c", "core.quotepath=false", "-c", "color.ui=false"]);
    // the profile's signature; git passes it on to the git it runs itself (a rebase's amends)
    for (key, value) in identity.and_then(|i| i.signing.as_ref()).map(|s| s.config()).into_iter().flatten() {
        command.arg("-c").arg(format!("{key}={value}"));
    }
    command
        .args(args)
        // never wait for an answer on a terminal nobody sees, nor in an editor: a message
        // git would ask for is the one it proposes
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true");
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    command.envs(env.iter().copied());
    if let Some(identity) = identity {
        for role in ["AUTHOR", "COMMITTER"] {
            command
                .env(format!("GIT_{role}_NAME"), &identity.name)
                .env(format!("GIT_{role}_EMAIL"), &identity.email);
        }
    }
    if let Some(ssh) = ssh_command() {
        command.env("GIT_SSH_COMMAND", ssh);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
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
