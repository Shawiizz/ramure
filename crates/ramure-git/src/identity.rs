//! Who signs the commits Ramure makes, and which git does the work.

use crate::cli::git_global;
use crate::Error;
use serde::{Deserialize, Serialize};

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
