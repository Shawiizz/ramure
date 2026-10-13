//! Who signs the commits Ramure makes, and which git does the work.

use crate::cli::git_global;
use crate::Error;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub name: String,
    pub email: String,
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
    Ok(Identity { name: get("user.name")?, email: get("user.email")? })
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
