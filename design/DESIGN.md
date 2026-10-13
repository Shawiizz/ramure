# Ramure design

A ramure is the branches of a tree and the antlers of a stag. The logo draws antlers the
way a Git client draws history: two branches of colour leaving one commit, a white commit
at every fork.

## Logo

| File | Use |
|---|---|
| `design/logo.svg` (= `frontend/public/logo.svg`) | The mark, from 64 px |
| `apps/ramure-desktop/icons` | The application icon: the mark on a dark rounded tile |

Green `#5FD3A8` and amber `#F2B84B` branches, `#EEF1EC` commits, on `#0C0F0E`. On a light
background the commits turn to ink `#121614` and the branches darken (`#18966B`,
`#C9860B`).

## Rules

- **Colour belongs to the history.** The chrome is near-black and grey; the lane colours
  (`--r-lane-0` to `--r-lane-7`) mark branches only: the graph's lines and the branch
  labels. The accent green is the logo's left branch: the current branch, the primary
  action, the selection.
- **Commits are white dots**, branches coloured lines, as in the logo.
- **Text**: Geist for the interface, Geist Mono for ids, branch names and paths.
- **Tokens** live in `frontend/src/styles/tokens.css`; components use them, never raw
  colours.
