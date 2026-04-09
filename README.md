# Panic Push: Cosmic Arena

A browser-based multiplayer arena party game built with Phaser 3, Node.js, Express, and Socket.IO.

Panic Push: Cosmic Arena is a fast top-down arena prototype where players dash, shove, and outlast each other on a shrinking sci-fi platform. The project is focused on responsive arcade gameplay, readable multiplayer presentation, and a polished browser-friendly loop from lobby to round finish.

## Highlights

- 2-8 player room system with room codes
- Host-controlled lobby flow with ready checks and bot support
- Server-authoritative movement, push, dash, eliminations, and round state
- Countdown start, overtime / final shrink, and round-over flow
- Pixel-art arena presentation with custom UI, SFX hooks, and generated announcer voice cues
- Local browser-friendly setup for quick testing in multiple tabs

## Run Locally

```bash
npm install
npm start
```

Open <http://localhost:3000> in two or more browser tabs.

For local multiplayer testing:

1. Open the game in at least two browser tabs
2. Create a room in one tab
3. Join from another tab with the room code, or add bots
4. Ready up and start the match

On Windows PowerShell, you may need:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' start
```

## Core Gameplay

- Short rounds with a countdown start
- Push and dash-based combat
- Arena shrink pressure over time
- 30-second main phase followed by a 10-second final shrink
- Last player alive wins
- Round-over screen with win/lose feedback and return-to-lobby flow

## Controls

- Move: WASD or arrow keys
- Dash: Space
- Push blast: Left click, J, or K

## Tech Stack

- Frontend: Phaser 3
- Backend: Node.js + Express + Socket.IO
- Language: JavaScript

## Project Structure

```text
server/
  constants.js   Shared gameplay and server tuning values
  roomStore.js   Room, lobby, player, and bot state management
  gameLoop.js    Authoritative match loop, shrink logic, and snapshots
  index.js       Express server and Socket.IO wiring
public/
  index.html
  style.css
  src/
    audio.js      Audio hooks, voice cues, lobby/music handling
    ui.js         Shared browser UI helpers
    game.js       Phaser renderer and in-match presentation
    main.js       Menu, lobby, HUD, and client Socket.IO logic
  assets/
    arena/
    backgrounds/
    bots/
    characters/
    effects/
    ui/
scripts/
  generate-openai-audio-assets.mjs
  pixelengine-animate.mjs
```

## Gameplay Constants

Main tuning values live in `server/constants.js`, including:

- room size limits
- tick and snapshot rates
- arena size
- round timing
- shrink behavior
- movement and dash feel
- push range / force / cooldown
- bot behavior tuning
- player color variants

This is the first place to edit if you want to rebalance the game.

## Audio and Asset Notes

- Voice cues are stored under `public/assets/audio/voice`
- Arena, player, bot, effect, and UI assets are stored under `public/assets`
- The repo includes helper scripts for OpenAI voice generation and Pixel Engine animation jobs
- API keys are read from environment variables and should not be committed to source

## Project Status

This repository is currently in a polished prototype / vertical-slice state:

- the full loop from menu -> lobby -> match -> round over works
- bots are playable for solo testing
- the project is suitable for continued polish, asset iteration, and showcase work
- there is still room for more animation, VFX, audio mixing, and hardening

## Future Improvements

- Expand character animation coverage and state-driven sprite transitions
- Improve VFX layering and combat feedback
- Add stronger reconnect and session recovery
- Add server-side reconnect support.
- Add spectator mode and round history.
- Add more arenas, visual themes, and content depth

## Pixel Engine Helper

The project now includes a helper script for Pixel Engine animation jobs:

```bash
npm run pixelengine:animate -- --image public/assets/characters/player-variant-01.png --prompt "floating idle, 6 frames" --out output/pixelengine/player-idle.webp
```

The script reads the API key from `PIXEL_ENGINE_API_KEY`.
Do not store the key in source files.
