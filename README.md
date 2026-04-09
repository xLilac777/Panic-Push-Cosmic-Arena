# Panic Push: Cosmic Arena

A browser-based multiplayer arena party game built with Phaser 3, Node.js, Express, and Socket.IO.

## Run Locally

```bash
npm install
npm start
```

Open <http://localhost:3000> in two or more browser tabs.

On this Windows machine, PowerShell may require:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' start
```

## Controls

- Move: WASD or arrow keys
- Dash: Space
- Push blast: Left click, J, or K

## Project Structure

```text
server/
  constants.js   Shared server configuration and starter tuning values
  roomStore.js   Room, lobby, player, and bot state skeleton
  gameLoop.js    Authoritative match loop skeleton and snapshots
  index.js       Express static server and Socket.IO wiring
public/
  index.html
  style.css
  src/
    audio.js
    ui.js
    game.js
    main.js
```

## Gameplay Constants

Starter tuning values live in `server/constants.js`, including room size, tick rates, arena size, movement feel, push/dash cooldowns, hazard timing, bot behavior, and player colors.

## Future Improvements

- Replace placeholder procedural art with finalized sprites and tiles.
- Add real sound files to the audio hook names.
- Add server-side reconnect support.
- Add spectator mode and round history.

## Pixel Engine Helper

The project now includes a helper script for Pixel Engine animation jobs:

```bash
npm run pixelengine:animate -- --image public/assets/characters/player-variant-01.png --prompt "floating idle, 6 frames" --out output/pixelengine/player-idle.webp
```

The script reads the API key from `PIXEL_ENGINE_API_KEY`.
Do not store the key in source files.
