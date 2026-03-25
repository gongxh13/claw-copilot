# Claw Copilot

<p align="center">
  <strong>Run-aware observability for OpenClaw</strong><br/>
  Follow sessions, runs, subagents, tool activity, timeline events, and artifacts from one dashboard.
</p>

<p align="center">
  <img alt="OpenClaw" src="https://img.shields.io/badge/OpenClaw-%3E%3D2026.3.12-111827?style=for-the-badge&logo=github" />
  <img alt="npm publish" src="https://img.shields.io/badge/release-GitHub%20Release%20%E2%86%92%20npm-1d4ed8?style=for-the-badge" />
  <img alt="Local SQLite" src="https://img.shields.io/badge/storage-local%20sqlite-0f766e?style=for-the-badge" />
  <img alt="Run aware" src="https://img.shields.io/badge/navigation-session%20%E2%86%92%20run%20%E2%86%92%20event-7c3aed?style=for-the-badge" />
  <img alt="Subagent jumps" src="https://img.shields.io/badge/subagents-precise%20jump%20targets-f59e0b?style=for-the-badge" />
</p>

Claw Copilot turns raw agent execution into something you can actually follow. Instead of digging through scattered logs, you get a focused dashboard for understanding what ran, when it ran, which subagent it triggered, what tools fired, and what artifacts came out.

## ✨ Why It Stands Out

- 🧭 **Run-aware navigation**: inspect OpenClaw at the right level - `session -> run -> event`
- 🔗 **Subagent-aware routing**: jump from a parent agent to the exact child session and run it triggered
- 🧹 **Cleaner A2A visibility**: reduces duplicated `sessions_send` noise when richer subagent context exists
- 📡 **Live execution view**: stream updates over SSE while runs are still happening
- 💾 **Local-first history**: persist sessions and runs in SQLite so refreshes and restarts do not wipe context
- 🌐 **Tailscale-first access**: open Claw Copilot safely from your phone or laptop without exposing localhost to the public internet

## 🚀 At A Glance

```mermaid
flowchart LR
    A[OpenClaw session] --> B[Run rail]
    B --> C[Timeline]
    B --> D[Artifacts]
    C --> E[Tool activity]
    C --> F[Model replies]
    C --> G[Subagent jump]
    G --> H[Child session / child run]
```

## 🌟 Core Highlights

### 🧭 Run-aware navigation

Claw Copilot is built around runs, not just chat transcripts.

- Session list with run counts and live status
- Dedicated run rail for each session
- Direct path routing:
  - `/claw-copilot/session/:sessionId`
  - `/claw-copilot/session/:sessionId/run/:runId`

### 🤖 Subagent visibility that actually helps

OpenClaw agent-to-agent flows can get noisy fast. Claw Copilot makes them readable.

- Detects subagent launches from `sessions_send`
- Preserves parent -> child linkage
- Supports precise jump targets for child runs
- Hides redundant `sessions_send` timeline noise when a richer subagent event already exists

### 📜 Timeline + artifacts in one workflow

- Model prompts and replies
- Tool activity and results
- Artifact capture and final reply visibility
- Live updates while runs are still executing

### 🛡️ Safe local-first storage

- Stores data in local SQLite
- Keeps session/run history across dashboard reloads
- Marks clearly abandoned running runs as interrupted

## ⚡ Quick Start

### Why Tailscale?

Claw Copilot is meant to be useful across devices, not just on the machine running OpenClaw.

- Tailscale gives you a private tailnet URL instead of asking you to expose `127.0.0.1` to the internet
- It works well for phone + laptop access on the same tailnet
- The plugin already knows how to guide setup and expose only the Claw Copilot path

### 1. Install into OpenClaw from npm

```bash
openclaw plugins install @gongxh13/claw-copilot
openclaw gateway restart
```

### 2. Enable remote access through Tailscale

```bash
openclaw claw-copilot remote enable
```

This command will:

- help install Tailscale if needed
- start Tailscale login if the machine is not connected yet
- expose Claw Copilot to your tailnet
- print the tailnet URL you can open from your phone or laptop
- print QR codes for login and mobile access when available

### 3. Open Claw Copilot from your phone or computer

1. Install Tailscale on the device you want to use
2. Sign into the same tailnet
3. Open the `Claw Copilot URL` printed by `openclaw claw-copilot remote enable`

Once OpenClaw starts running tasks, Claw Copilot begins capturing sessions and runs automatically.

## 👀 What You Get

### 📚 Sessions view

- Live session status
- Session labels and metadata
- Pagination for large histories

### 🏃 Runs view

- Per-session run list
- Run input preview
- Task / tool / artifact counts

### 🔍 Detail view

- Timeline of execution events
- Artifact panel
- Control actions for stop / pause / redirect

## 🔗 Routing

Claw Copilot supports direct linking into dashboard state.

- Session route: `/claw-copilot/session/:sessionId`
- Run route: `/claw-copilot/session/:sessionId/run/:runId`

This makes it easier to:

- refresh the page without losing context
- share a specific execution view
- jump from a parent agent to the exact child run it triggered

## 📱 Remote Access

Claw Copilot is designed to be accessed over Tailscale.

Useful commands:

```bash
openclaw claw-copilot remote status
openclaw claw-copilot remote enable
openclaw claw-copilot remote disable
```

The recommended flow is:

1. Run `openclaw claw-copilot remote enable`
2. Scan the printed QR code or open the login URL if Tailscale needs sign-in
3. Install Tailscale on your phone and join the same tailnet
4. Open the printed Claw Copilot URL

## 🧪 Development

### Run tests

```bash
npm test
```

### Type-check + dashboard checks

```bash
npm run check
```

### Rebuild after changes

```bash
npm run build
```

If you are developing against a local OpenClaw install, rebuild and reinstall or reload the plugin after changes.

### Local development install

```bash
openclaw plugins install /path/to/claw-copilot --link
openclaw gateway restart
openclaw claw-copilot remote enable
```

After that, use the printed tailnet URL from any device on the same tailnet instead of relying on localhost addresses.

## 📋 Requirements

- OpenClaw `>= 2026.3.12`
- A Node.js environment capable of building the dashboard and plugin

## ⚙️ Configuration

`openclaw.plugin.json` exposes a few plugin settings:

- `basePath`: dashboard mount path, default `/claw-copilot`
- `dashboardTitle`: dashboard title shown in the UI
- `imVerbosity`: plugin verbosity level

## 📦 Releases

This repository is set up so that publishing a GitHub Release can publish the package to npm automatically.

Recommended maintainer flow:

1. bump `package.json` version
2. push the version commit
3. create a GitHub Release with a matching tag like `v0.1.0`
4. GitHub Actions runs tests, builds the package, and publishes to npm

The release tag must match the version in `package.json`.

## 🦞 Current Focus

Claw Copilot is already useful for real OpenClaw debugging and observability workflows, especially when you need to inspect multi-run, multi-agent behavior.

The current focus is simple: make agent execution easier to understand, easier to navigate, and easier to act on.
