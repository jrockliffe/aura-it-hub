# AURA IT HUB

This repository is a standalone Node service for the AURA IT HUB shortcuts page.

## Features

- Aura-style glass UI with grid background and blurred orbs
- Add shortcuts with custom icon upload or external icon URL
- Automatic website icon fetch when no icon is supplied
- Drag-and-drop tile reordering with saved order
- Persistent JSON storage for shortcuts and uploaded icons

## Local Run

```bash
npm install
npm start
```

The service listens on port `3200` by default.

## Authentik SSO

Set these environment variables to protect the hub with Authentik:

- `AURA_HUB_AUTHENTIK_ENABLED=true`
- `AURA_HUB_AUTHENTIK_BASE_URL=https://auth.aurait.com.au`
- `AURA_HUB_AUTHENTIK_PROVIDER_SLUG=glow`
- `AURA_HUB_AUTHENTIK_CLIENT_ID=...`
- `AURA_HUB_AUTHENTIK_CLIENT_SECRET=...`
- `AURA_HUB_PUBLIC_BASE_URL=https://hub.aurait.com.au`
- `AURA_HUB_SESSION_SECRET=...`

The current systemd unit reads optional runtime overrides from `/etc/default/aura-it-hub`.

## Runtime Files

- `data/shortcuts.json`: saved shortcut data
- `uploads/icons/`: uploaded or fetched icon files
- Set `AURA_HUB_STORAGE_DIR` in production to keep runtime data outside the deploy folder.

## systemd

An example unit file is provided at `systemd/aura-it-hub.service`.
