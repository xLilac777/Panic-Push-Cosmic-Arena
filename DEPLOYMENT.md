# Deployment

## Recommended architecture

- Frontend: Vercel
- Backend realtime server: Railway

The game client is static and can run well on Vercel.
The multiplayer backend uses Express + Socket.IO + in-memory room state, so it should run on Railway as a long-lived Node server.

## Railway backend

Deploy this repository to Railway as a Node service.

Environment variables:

- `PORT`
  Railway sets this automatically.
- `CLIENT_ORIGIN`
  Set this to your production Vercel URL plus any extra custom domains you want to allow.
  Comma-separated values are supported.
  Example:
  `https://panic-push-cosmic-arena.vercel.app`
- `ALLOW_VERCEL_PREVIEWS`
  Optional.
  Leave unset or set to `true` to allow preview deployments from `*.vercel.app`.
  Set to `false` only if you want strict origin locking.

Start command:

- `npm start`

Health check path:

- `/healthz`

Operational note:

- Keep Railway on a single replica for now.
- Match rooms are stored in memory, so restarts or horizontal scaling will split or reset live sessions.

## Vercel frontend

Deploy the same repository to Vercel.

Set this environment variable in the Vercel project:

- `PANIC_SERVER_URL`
  Example:
  `https://your-railway-backend.up.railway.app`

Vercel build command:

- `npm run build:web`

This build step:

- copies `phaser.min.js` into `public/vendor/phaser`
- copies `socket.io.min.js` into `public/vendor/socket.io`
- writes `public/runtime-config.js` with the Railway backend URL

Important:

- Vercel builds now fail if `PANIC_SERVER_URL` is missing.
- This prevents shipping a frontend that silently tries to connect to the wrong origin.

## Local development

Local dev still works with:

- `npm start`

If `PANIC_SERVER_URL` is empty, the frontend connects to the same origin.
