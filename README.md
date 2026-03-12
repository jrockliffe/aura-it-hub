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

## Runtime Files

- `data/shortcuts.json`: saved shortcut data
- `uploads/icons/`: uploaded or fetched icon files
- Set `AURA_HUB_STORAGE_DIR` in production to keep runtime data outside the deploy folder.

## systemd

An example unit file is provided at `systemd/aura-it-hub.service`.
