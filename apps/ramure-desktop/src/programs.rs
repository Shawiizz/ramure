//! Where the programs Ramure starts are: on the `PATH`, or brought by Git for Windows.

use std::path::PathBuf;

/// The first folder of the `PATH` holding `program`.
pub fn on_path(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|dir| dir.join(program)).find(|file| file.is_file())
}

/// The folder Git for Windows is installed in, from the git on the `PATH`
/// (`…\Git\cmd\git.exe` or `…\Git\bin\git.exe`).
fn git_root() -> Option<PathBuf> {
    Some(on_path("git.exe")?.parent()?.parent()?.to_path_buf())
}

/// Git for Windows' bash.
pub fn git_bash() -> Option<PathBuf> {
    Some(git_root()?.join("bin").join("bash.exe")).filter(|bash| bash.is_file())
}

/// One of the tools git runs (`ssh`, `ssh-keygen`): Git for Windows' own first, as git
/// itself uses them, else the one on the `PATH`.
pub fn git_tool(name: &str) -> PathBuf {
    let exe = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    git_root()
        .map(|root| root.join("usr").join("bin").join(&exe))
        .filter(|tool| tool.is_file())
        .or_else(|| on_path(&exe))
        .unwrap_or_else(|| PathBuf::from(exe))
}
