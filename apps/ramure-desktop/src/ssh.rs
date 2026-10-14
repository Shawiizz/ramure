//! The ssh key git signs in to remotes with: chosen, made, shown, tried.

use crate::programs::git_tool;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

/// The user's own folder.
fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// A program of git's run with no window, its output gathered.
#[cfg(windows)]
fn quiet(program: PathBuf) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn quiet(program: PathBuf) -> Command {
    Command::new(program)
}

/// The private key every git command, and the terminals opened from now on, sign in with;
/// none leaves ssh to its own configuration.
#[tauri::command]
pub fn set_ssh_key(key: Option<String>) {
    ramure_git::set_ssh_key(key.filter(|k| !k.trim().is_empty()).map(PathBuf::from));
}

/// A public key, and the file it is in.
#[derive(Serialize)]
pub struct PublicKey {
    path: String,
    text: String,
}

/// The public half of the private key `key` (its `.pub`), else of ssh's own first key.
#[tauri::command(async)]
pub fn ssh_public_key(key: Option<String>) -> Option<PublicKey> {
    let candidates = match key.filter(|k| !k.trim().is_empty()) {
        Some(key) => vec![PathBuf::from(format!("{key}.pub"))],
        None => {
            let dir = home()?.join(".ssh");
            ["id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"].map(|name| dir.join(name)).to_vec()
        }
    };
    let path = candidates.into_iter().find(|file| file.is_file())?;
    let text = std::fs::read_to_string(&path).ok()?.trim().to_owned();
    Some(PublicKey { path: path.to_string_lossy().into_owned(), text })
}

/// A new ed25519 key for `email`, with no passphrase, in `~/.ssh` under a name of its
/// own; answers the private key's path.
#[tauri::command(async)]
pub fn ssh_generate(email: String) -> Result<String, String> {
    let dir = home().ok_or("The user's folder cannot be found.")?.join(".ssh");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let file = (0..)
        .map(|n| dir.join(if n == 0 { "ramure_ed25519".to_owned() } else { format!("ramure_ed25519_{n}") }))
        .find(|file| !file.exists() && !PathBuf::from(format!("{}.pub", file.display())).exists())
        .expect("a free name is found");
    let output = quiet(git_tool("ssh-keygen"))
        .args(["-q", "-t", "ed25519", "-C", &email, "-N", "", "-f"])
        .arg(&file)
        .output()
        .map_err(|e| format!("ssh-keygen could not run: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(file.to_string_lossy().into_owned())
}

/// What the ssh server of `host` answers the key chosen (ssh's own keys without one):
/// GitHub and GitLab greet the account it opens.
#[tauri::command(async)]
pub fn ssh_test(host: String) -> Result<String, String> {
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return Err(format!("{host} is not a host name"));
    }
    let mut command = quiet(git_tool("ssh"));
    command.args([
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
    ]);
    // the chosen key alone: ssh's configuration would offer its own keys besides
    if let Some(key) = ramure_git::ssh_key() {
        command.args(["-F", "none", "-i"]).arg(key).args(["-o", "IdentitiesOnly=yes"]);
    }
    let output =
        command.arg(format!("git@{host}")).output().map_err(|e| format!("ssh could not run: {e}"))?;
    // a server granting no shell ends with a failure, after its greeting
    let said = [output.stderr, output.stdout].concat();
    Ok(String::from_utf8_lossy(&said).trim().to_owned())
}

/// A GPG secret key: its long id and who it is for.
#[derive(Serialize)]
pub struct GpgKey {
    id: String,
    user: String,
}

/// The GPG secret keys `program` (`gpg` when empty) holds; none when it cannot run.
#[tauri::command(async)]
pub fn gpg_keys(program: String) -> Vec<GpgKey> {
    let program = if program.trim().is_empty() { git_tool("gpg") } else { PathBuf::from(program.trim()) };
    let Ok(output) =
        quiet(program).args(["--list-secret-keys", "--with-colons", "--keyid-format=long"]).output()
    else {
        return Vec::new();
    };
    let mut keys: Vec<GpgKey> = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let fields: Vec<&str> = line.split(':').collect();
        match fields.first() {
            Some(&"sec") => {
                keys.push(GpgKey { id: fields.get(4).unwrap_or(&"").to_string(), user: String::new() })
            }
            Some(&"uid") => {
                if let Some(key) = keys.last_mut().filter(|k| k.user.is_empty()) {
                    key.user = fields.get(9).unwrap_or(&"").to_string();
                }
            }
            _ => {}
        }
    }
    keys
}
