# Ramure

A free and open source Git client: the history as a graph of branches, the branches and
tags at hand, the commit you pick in detail.

- Repositories in tabs, and workspaces that reopen several of them at once.
- Profiles: the name and email Ramure signs commits with, switched from the title bar
  (the git configuration stays as it is).
- The working tree: stage, unstage, commit (and push at once); diffs of any file or commit.
- Stashes, drawn in the history on the commit they were made on: stash, pop, apply, delete.
- Branches created and switched to; fetch, pull and push.

## Stack

- `crates/ramure-git`: reads repositories with [gitoxide](https://github.com/GitoxideLabs/gitoxide)
  (pure Rust): HEAD, branches, tags, the history newest first with every commit before its
  parents, and the graph's lanes.
- `apps/ramure-desktop`: the desktop application, [Tauri v2](https://tauri.app).
- `frontend`: the interface, Angular (standalone components, signals, no zone.js), pnpm.
- `design`: the logo and the design rules.

## Developing

Rust (pinned by `rust-toolchain.toml`), Node 24 and pnpm 10.

```sh
cd frontend && pnpm install
cd ../apps/ramure-desktop && ../../frontend/node_modules/.bin/tauri dev
```

The interface is served on port 4400. Checks:

```sh
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd frontend && pnpm exec prettier --check src && pnpm test --watch=false
```

## Licence

GPL-3.0-or-later.
