# Crew Copilot

Run-aware observability dashboard plugin for OpenClaw.

This package is an in-progress implementation of the ClawCopilot design in this repository. It focuses on:

- persistent session, run, event, and artifact tracking
- a lightweight dashboard entry point and a separate `dashboard/` app workspace
- plugin-friendly local development and npm distribution

## Project layout

- `plugin/`: OpenClaw native plugin runtime, hooks, storage, and HTTP routes
- `dashboard/`: future standalone React/Vite PWA workspace
- `tests/`: unit tests for plugin runtime behavior

## Development

```bash
npm install
npm test
npm run build
```

## Local install in OpenClaw

```bash
openclaw plugins install -l /path/to/crew-copilot
openclaw plugins enable crew-copilot
openclaw gateway restart
```
