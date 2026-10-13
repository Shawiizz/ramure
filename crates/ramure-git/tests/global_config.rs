//! The global git configuration, read and written: in a file of this test's own, never the
//! user's (a test binary of its own, so no other test sees the variable), with keys no
//! system configuration sets.

use ramure_git::{global_config, global_identity, set_global_config, set_global_identity, Identity};

#[test]
fn the_global_configuration_is_read_set_and_unset() {
    let home = tempfile::tempdir().unwrap();
    let file = home.path().join(".gitconfig");
    std::env::set_var("GIT_CONFIG_GLOBAL", &file);

    let keys = vec!["ramure.one".to_owned(), "ramure.two".to_owned()];
    assert!(global_config(&keys).unwrap().is_empty());

    set_global_config("ramure.one", Some("true")).unwrap();
    set_global_config("ramure.two", Some("main")).unwrap();
    let values = global_config(&keys).unwrap();
    assert_eq!(values["ramure.one"], "true");
    assert_eq!(values["ramure.two"], "main");

    set_global_config("ramure.two", None).unwrap();
    set_global_config("ramure.two", None).unwrap();
    assert!(!global_config(&keys).unwrap().contains_key("ramure.two"));

    let ada = Identity { name: "Ada".to_owned(), email: "ada@example.com".to_owned() };
    set_global_identity(&ada).unwrap();
    assert_eq!(global_identity().unwrap(), ada);
    assert!(std::fs::read_to_string(&file).unwrap().contains("one = true"));
}
