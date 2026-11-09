# dev-hush

A conversation-presentation toggle for [Pi](https://pi.dev). Keep assistant prose visible while hiding thinking and tool activity. An animated ASCII sailboat replaces the working indicator while the agent runs.

This extension changes presentation only. Input, tool execution, model context, session storage and export data stay intact. `/export` and `/share` use the complete stock transcript.

## Install

Clone directly into Pi's global extension directory:

```sh
mkdir -p ~/.pi/agent/extensions
git clone https://github.com/taekwondodev/dev-hush.git ~/.pi/agent/extensions/dev-hush
```

Restart Pi. It discovers the directory's `index.ts` automatically. No npm publication, package-gallery registration, `pi install`, or `--extension` flag is needed. If `PI_CODING_AGENT_DIR` is set, use its `extensions/dev-hush` directory instead. Do not keep another copy enabled elsewhere.

This checkout may already be installed on the maintainer's machine. Do not clone over an existing directory.

## Use

- `/hush` toggles the presentation filter.
- `Ctrl+Alt+C` is the existing keyboard shortcut, retained for muscle memory.
- The preference is off by default and is stored in `<agent-dir>/dev-hush`, outside this repository.
- Assistant replies remain visible, including streaming and intermediate reports.
- Quota/usage-limit and provider-connectivity diagnostics remain visible. Ordinary tool failures and other automatic diagnostics are hidden while the filter is active. Disable it to inspect full details.
- With [dev](https://github.com/taekwondodev/dev), failed agent children get a compact red notice with their IDs, not raw logs.

This is a personal UI extension, not a sandbox or a safety filter. Hiding output does not stop execution. Review and approval dialogs remain visible.

## Update

```sh
git -C ~/.pi/agent/extensions/dev-hush pull --ff-only
```

Restart Pi after updating. The extension patches Pi's presentation components, so a full restart is required when switching from the old local name; `/reload` alone does not remove prototype wrappers. Keep only the `dev-hush` directory enabled.

Pi supplies the runtime modules; no `npm install` is needed.

## Verification

Checked against Pi 1.5.0. It uses Pi UI APIs and exported presentation components; future Pi changes may require adapter updates. Each adapter reports a diagnostic if its required API is unavailable.

The existing check targets Pi's official installer layout and an installed checkout at `<agent-dir>/extensions/dev-hush`:

```sh
cd ~/.pi/agent/extensions/dev-hush
node check.mjs
```

See [EXPECTED-BEHAVIOR.md](EXPECTED-BEHAVIOR.md) for the detailed presentation contract.

## Attribution

Adapted from [Firstmate](https://github.com/kunchenguid/firstmate)'s Calm implementation, including source at commit `a09090d13ef24ce3cf71d171ade119896d6db301`. Original copyright (c) 2026 Kun Chen. The original notices and [MIT license](LICENSE) are retained.
