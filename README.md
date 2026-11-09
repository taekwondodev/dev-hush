https://github.com/user-attachments/assets/051dd9a3-8a47-4166-ba55-a0036985b586

<h1 align="center">dev-hush</h1>

<p align="center">Hush hides Pi's thinking and tool activity, so only the conversation stays on screen.</p>

## Install

### Prerequisites

- A terminal that supports the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/).

Clone directly into Pi's global extension directory:

```sh
mkdir -p ~/.pi/agent/extensions
git clone https://github.com/taekwondodev/dev-hush.git ~/.pi/agent/extensions/dev-hush
```

## Use

- `/hush` toggles the presentation filter.
- `Ctrl+Alt+C` is the existing keyboard shortcut, retained for muscle memory.

## Attribution

Adapted from [Firstmate](https://github.com/kunchenguid/firstmate)'s Calm implementation, including source at commit `a09090d13ef24ce3cf71d171ade119896d6db301`. Original copyright (c) 2026 Kun Chen. The original notices and [MIT license](LICENSE) are retained.

## Disclaimer

dev-hush is for personal use only. WALL-E and EVE are Disney/Pixar characters; this project is not affiliated with or endorsed by Disney or Pixar.
