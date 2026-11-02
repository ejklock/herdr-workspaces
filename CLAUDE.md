# herdr-workspaces

Herdr desktop app mods and layouts: one window, several workspaces. Read `docs/constitution.md` first.

## Docs index

- `docs/constitution.md`: product, scope, data model, non-negotiables.
- `docs/adr/index.md`: decisions expensive to reverse.
- `docs/issues/index.md`: the work, with its cheap decisions inline.

Records are authored with the `living-docs` CLI (`new`, `set`, `supersede`); run `living-docs check` after any change under `docs/`.

## Hard rules

- Never edit Herdr's shipped mods or layouts in `~/.config/herdr-app`; work on clones kept in this repository.
- Never quit or restart the owner's Herdr windows or herdr-core sessions (`default` and each workspace's core, listed by `hc machine ls`); test against scratch sessions and a scratch `HERDR_APP_HOME`.
- `hc` and `herdr-app` run outside the Claude sandbox.
