# Cap or Fact

Catch the cap. Live with your circle.

A private party game on **Pear + Autopass**. Three players each write three statements (two true, one lie). Everyone else votes which one is the cap. Scores update live across paired app windows. One vault is one room.

This app started from [`hello-pear-electron`](https://github.com/holepunchto/hello-pear-electron). Game data lives in a Bare worker with Autopass. The renderer only draws a folded snapshot over IPC.

## What's implemented

Working today:

- Autopass vault opens in the worker on boot (separate from the updater store)
- JSON messages on the worker pipe (`ping` / `pong`, room actions, `state`, `invite`, `error`)
- Host creates a room and copies an invite
- Other windows join with that invite and get seats in join order
- Live player list across windows
- Display names
- Host **Start** when three players are named — freezes turn order, opens round 1 for seat 1
- Author sees "Your turn"; others see who is writing and the queue

Not built yet:

- Submitting the three statements
- Voting
- Reveal and scoreboard
- Later rounds and the winner / tie-break screen

## Requirements

- Node.js with `npm`
- Windows, macOS, or Linux

## Install

```sh
npm run install:all
```

On macOS:

```sh
npm run install:mac
```

## Run

One window (host):

```sh
npm start
```

That starts Electron with updates off. Click **Create**, copy the invite, set your name.

Second window (another player). Use a different storage folder so the two vaults do not clash:

```sh
npm start -- --storage "$TEMP/cap-or-fact-2"
```

On macOS / Linux:

```sh
npm start -- --storage /tmp/cap-or-fact-2
```

Paste the full invite, press **Join**, set a name. Repeat with `cap-or-fact-3` for the third player. When all three have names, the host can press **Start**.

### Fresh room

Old seats stay on disk under the storage folder. To wipe and start clean, close the app windows, then delete those folders (for example `%TEMP%\pear\Cap or Fact\app-storage` and `%TEMP%\cap-or-fact-2\app-storage` on Windows).

## Stack

| Layer   | Choice                                       |
| ------- | -------------------------------------------- |
| Desktop | Pear / Electron (`hello-pear-electron`)      |
| UI      | `renderer/` — HTML, CSS, plain DOM           |
| Logic   | Bare worker `workers/main.js`                |
| Data    | Autopass + Corestore                         |
| Sync    | `pass.on('update')` → fold → IPC snapshot    |
| IPC     | JSON `{ type, payload }` via `window.bridge` |

## Project layout

```text
cap-or-fact/
├── renderer/          # UI
├── workers/main.js    # Autopass, room fold, IPC
├── electron/          # stock from the template
├── package.json
└── README.md
```

## Scripts

```sh
npm start          # dev, updates off
npm run lint       # prettier + lunte
npm run format     # fix formatting
npm run package    # packaged app under out/
```

## Packaging and OTA

Packaging, signing, and peer-to-peer updates still follow the Pear Electron template. See [docs.pears.com](https://docs.pears.com), [`agent_docs/packaging.md`](agent_docs/packaging.md), and [`agent_docs/updates.md`](agent_docs/updates.md).

## AI use

Used AI to understand Pear/Autopass, shape Cap or Fact rules and turn flow.
