//! Who signs the commits Ramure makes.

use crate::cli::git_global;
use crate::Error;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    pub name: String,
    pub email: String,
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
