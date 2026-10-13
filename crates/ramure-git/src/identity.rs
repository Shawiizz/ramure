//! Who signs the commits Ramure makes, and which git does the work.

use crate::cli::git_global;
use crate::Error;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub name: String,
    pub email: String,
    /// How the commits and tags it makes are signed; as git is configured without.
    #[serde(default)]
    pub signing: Option<Signing>,
}

/// A profile's signature: the kind of key, the key, and what it signs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Signing {
    pub format: SigningFormat,
    /// A GPG key's id, or an ssh key's file.
    pub key: String,
    /// The program signing: `ssh-keygen` or `gpg` when empty.
    #[serde(default)]
    pub program: String,
    pub commits: bool,
    pub tags: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SigningFormat {
    Ssh,
    Openpgp,
}

impl Signing {
    /// The configuration git signs with, as `-c` gives it; the program always named, as an
    /// empty one set elsewhere would leave git with none.
    pub(crate) fn config(&self) -> [(&'static str, String); 5] {
        let (format, program_key, default_program) = match self.format {
            SigningFormat::Ssh => ("ssh", "gpg.ssh.program", "ssh-keygen"),
            SigningFormat::Openpgp => ("openpgp", "gpg.program", "gpg"),
        };
        let program = if self.program.trim().is_empty() { default_program } else { self.program.trim() };
        [
            ("gpg.format", format.to_owned()),
            (program_key, program.to_owned()),
            ("user.signingkey", self.key.clone()),
            ("commit.gpgsign", self.commits.to_string()),
            ("tag.gpgsign", self.tags.to_string()),
        ]
    }
}

/// The git command's version, as it gives it (`git version 2.46.2.windows.1`).
pub fn git_version() -> Result<String, Error> {
    let out = git_global(&["--version"])?.unwrap_or_default();
    Ok(String::from_utf8_lossy(&out).trim().to_owned())
}

/// The identity git uses outside any repository (`user.name`, `user.email`); empty where
/// it is not set.
pub fn global_identity() -> Result<Identity, Error> {
    let get = |key: &str| -> Result<String, Error> {
        let value = git_global(&["config", "--global", "--get", key])?.unwrap_or_default();
        Ok(String::from_utf8_lossy(&value).trim().to_owned())
    };
    Ok(Identity { name: get("user.name")?, email: get("user.email")?, signing: None })
}

/// The values `keys` have outside any repository: the user's own, else the system's (Git
/// for Windows sets `core.autocrlf` there); those set nowhere are left out.
pub fn global_config(keys: &[String]) -> Result<BTreeMap<String, String>, Error> {
    let mut values = BTreeMap::new();
    for key in keys {
        let user = git_global(&["config", "--global", "--get", key])?;
        let value = match user {
            Some(value) => Some(value),
            None => git_global(&["config", "--system", "--get", key])?,
        };
        if let Some(value) = value {
            values.insert(key.clone(), String::from_utf8_lossy(&value).trim().to_owned());
        }
    }
    Ok(values)
}

/// Sets `key` in the global configuration, or unsets it with `None`.
pub fn set_global_config(key: &str, value: Option<&str>) -> Result<(), Error> {
    let done = match value {
        Some(value) => git_global(&["config", "--global", key, value])?,
        // unsetting what is not set is no failure
        None => git_global(&["config", "--global", "--unset", key])?.or(Some(Vec::new())),
    };
    done.map(drop).ok_or_else(|| Error::Command(format!("{key} could not be set")))
}

/// Makes `identity` the one git uses outside Ramure.
pub fn set_global_identity(identity: &Identity) -> Result<(), Error> {
    set_global_config("user.name", Some(&identity.name))?;
    set_global_config("user.email", Some(&identity.email))
}
