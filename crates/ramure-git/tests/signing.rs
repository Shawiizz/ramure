//! Commits and tags signed with the profile's key, and their signatures read back.

mod common;

use common::{git, repository, write};
use ramure_git::{actions, signature, Identity, Signing, SigningFormat};
use std::path::Path;
use std::process::Command;

/// An ed25519 key made for the test, with no passphrase; its private file.
fn key(dir: &Path) -> String {
    let file = dir.join("key");
    let made = Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-C", "ada@example.com", "-f"])
        .arg(&file)
        .status()
        .expect("ssh-keygen runs");
    assert!(made.success());
    file.to_string_lossy().into_owned()
}

#[test]
fn a_profile_with_an_ssh_key_signs_its_commits_and_tags() {
    let keys = tempfile::tempdir().unwrap();
    let dir = repository();
    let d = dir.path();
    let signing = Signing {
        format: SigningFormat::Ssh,
        key: key(keys.path()),
        program: String::new(),
        commits: true,
        tags: true,
    };
    let ada = Identity { name: "Ada".into(), email: "ada@example.com".into(), signing: Some(signing) };

    write(d, "a.txt", "a\n");
    actions::stage(d, &["a.txt".into()]).unwrap();
    let id = actions::commit(d, "Signed", Some(&ada)).unwrap();
    let signed = signature(d, &id).unwrap().unwrap();
    assert_eq!(signed.kind, "ssh");

    actions::tag(d, "v1", &id, Some("A signed tag"), Some(&ada)).unwrap();
    let tag = Command::new("git").args(["cat-file", "tag", "v1"]).current_dir(d).output().unwrap();
    assert!(String::from_utf8_lossy(&tag.stdout).contains("BEGIN SSH SIGNATURE"));
}

#[test]
fn a_commit_made_without_a_signature_has_none() {
    let dir = repository();
    let d = dir.path();
    git(d, &["commit", "-q", "--allow-empty", "-m", "Plain"]);
    assert_eq!(signature(d, "HEAD").unwrap(), None);
}
