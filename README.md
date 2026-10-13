# Ramure

A free and open source Git client: the history as a graph of branches, the branches and
tags at hand, the commit you pick in detail.

- Repositories cloned (their progress as it comes) or made anew, with a README in a first
  commit when asked.
- An ssh key chosen, made or tried from the settings, its public half copied in a click.
- Commits and tags signed with the profile's ssh or GPG key; a commit's signature shown, and
  checked on a click.
- Repositories in tabs, moved by dragging, dragged out into a window of their own and back
  again, as in a browser; workspaces that reopen several of them at once.
- Profiles: the name and email Ramure signs commits with, switched from the title bar
  (the git configuration stays as it is).
- The working tree: stage, unstage, commit (and push at once); throw changes away, one file
  or all of them; ignore a file, its kind or its folder; stash one file. Changed files as
  paths or in their folders.
- A file on its own: its history, its blame, or the file itself edited.
- Diffs of any file, commit or stash: the file view or the changes (alone, inline or side by
  side), spaces at the ends of lines ignored or not, long lines wrapped or not, the bytes
  read in the encoding of your choice.
- Stashes, drawn in the history on the commit they were made on: stash, pop, apply, delete.
- Branches created and switched to; fetch, pull (merge, fast-forward only or rebase) and push.
- A commit's menu: check it out, branch or tag it (plain or annotated), cherry-pick or
  revert it, rebase or reset the current branch onto it, copy its id or its web link; a
  rebase, cherry-pick, revert or merge stopped on conflicts can be aborted or continued.
- Menus (right click or ⋯) for branches, remote branches, remotes and tags: merge, rebase,
  interactive rebase, rename, delete, push, set an upstream, hide from the history or solo;
  a local branch dropped on another merges or rebases them.
- A commit of the current branch rewritten after the fact: its message, author and dates;
  a branch that parted from its upstream force-pushed, once sure.
- A terminal in the repository under the history (Ctrl+`), its shell kept while hidden.
- Settings by subject: the editor's font, size and tabs; the terminal's shell (PowerShell,
  cmd, Git Bash, WSL) and look; fetching, pruning, a history read further back as it is
  scrolled; the global git configuration; the editor files open in.
- Undo and redo (Ctrl+Z, Ctrl+Y) of commits, merges, rebases, resets, branches and tags.
- A search through the commits (Ctrl+F); the history's columns shown, hidden and reordered;
  the panels resized, the sidebar's sections reordered and resized.

## Stack

- `crates/ramure-git`: reads repositories with [gitoxide](https://github.com/GitoxideLabs/gitoxide)
  (pure Rust): HEAD, branches, tags, the history newest first with every commit before its
  parents, and the graph's lanes.
- `apps/ramure-desktop`: the desktop application, [Tauri v2](https://tauri.app).
- `frontend`: the interface, Angular (standalone components, signals, no zone.js), pnpm;
  diffs in [Monaco](https://microsoft.github.io/monaco-editor/), VS Code's editor.
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

## Releasing

Set the version in `Cargo.toml` (`[workspace.package]`), commit, and push a tag of the same
version (`git tag 0.2.0 && git push origin 0.2.0`). The Release workflow builds the
installer, signs the update with the key kept in the repository's secrets, and attaches
both to a draft release: publishing the draft offers the update to every installed copy,
from the button in the status bar.
