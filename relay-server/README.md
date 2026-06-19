# LiveCode Relay Server

A minimal WebSocket relay that makes the LiveCode editor sync code between
browsers in real time.

## Quick Start

```bash
cd relay-server
npm install
npm start
```

Server starts on port **8787** (or `$PORT`). You'll see:
`livecode relay listening on :8787`

## Local Tunnel (for testing with others)

Use cloudflared to expose it:

```bash
cloudflared tunnel --url http://localhost:8787
```

It prints a URL like `https://something.trycloudflare.com`. Copy that,
open `index.html`, change the `DEFAULT_RELAY` at the top to that URL:

```js
const DEFAULT_RELAY = "wss://something.trycloudflare.com";
```

Now share the page URL with anyone — they'll see your code changes live.

## Deploy (for permanent hosting)

### Render (free tier, easiest)
1. Push this repo to GitHub.
2. On [render.com](https://render.com): New → Web Service → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. You get a URL like `https://livecode-relay.onrender.com`.
   Set `DEFAULT_RELAY` to `wss://livecode-relay.onrender.com`.

### Railway / Fly.io
Same idea — point them at `relay-server/`, `npm install` + `npm start`.

### Glitch
Import this repo, hit run. Use the project's public URL with `wss://`.

## How it works

- Rooms are kept in memory (no database).
- When someone joins, they get the current code in that room.
- Every edit is broadcast to all other peers in the same room.
- Empty rooms are cleaned up after 5 minutes.
