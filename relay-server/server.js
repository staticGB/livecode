// LiveCode relay server
// WebSocket relay for syncing code across collaborators in real time.
// Persists room code to disk (data/rooms/<roomId>.json) so it survives restarts.
//
// Run locally:   node server.js
// Tunnel:        cloudflared tunnel --url http://localhost:8787
// Deploy:        Render / Railway / Fly.io / any Node.js host

const { WebSocketServer } = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8787;
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Persist room code to a JSON file. Each room gets its own file:
 *   data/rooms/<roomId>.json  ->  { code: "..." }
 */
const PERSIST_DIR = path.join(DATA_DIR, "rooms");
if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });

function roomPath(roomId) {
  // Sanitize room id to avoid path traversal
  const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(PERSIST_DIR, safe + ".json");
}

function loadRoomCode(roomId) {
  try {
    const p = roomPath(roomId);
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      return data.code || null;
    }
  } catch (e) {
    console.error("Failed to load room data:", e.message);
  }
  return null;
}

function saveRoomCode(roomId, code) {
  try {
    const p = roomPath(roomId);
    fs.writeFileSync(p, JSON.stringify({ code: code }), "utf8");
  } catch (e) {
    console.error("Failed to save room data:", e.message);
  }
}

// room id -> { code: string, clients: Set<ws> }
const rooms = new Map();

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = { code: loadRoomCode(roomId), clients: new Set() };
    rooms.set(roomId, room);
  }
  return room;
}

function broadcast(room, data, exceptWs) {
  const msg = JSON.stringify(data);
  for (const client of room.clients) {
    if (client !== exceptWs && client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
}

function sendPeerCount(room) {
  broadcast(room, { type: "peers", count: room.clients.size }, null);
}

// Plain HTTP server so health checks don't fail
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("livecode relay ok\n");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  let joinedRoom = null;
  let roomId = null;

  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch { return; }

    if (msg.type === "join") {
      roomId = String(msg.room || "default").slice(0, 300);
      joinedRoom = getRoom(roomId);
      joinedRoom.clients.add(ws);

      // Tell the newcomer the current code in the room
      ws.send(JSON.stringify({
        type: "init",
        code: joinedRoom.code,
      }));
      sendPeerCount(joinedRoom);
      return;
    }

    if (msg.type === "update" && joinedRoom) {
      joinedRoom.code = msg.data ? msg.data.code : msg.code;
      var code = joinedRoom.code;
      // Persist to disk so code survives restarts
      saveRoomCode(roomId, code);
      broadcast(joinedRoom, { type: "update", code: code }, ws);
      return;
    }

    if (msg.type === "chat" && joinedRoom) {
      broadcast(joinedRoom, { type: "chat", data: msg.data }, ws);
      return;
    }

    // Relay all other messages (draw, clear, etc.) to everyone in the room
    if (msg.type !== "join" && msg.type !== "update" && msg.type !== "chat" && joinedRoom) {
      broadcast(joinedRoom, { type: msg.type, data: msg.data, sender: msg.sender }, ws);
      return;
    }
  });

  ws.on("close", () => {
    if (joinedRoom) {
      joinedRoom.clients.delete(ws);
      sendPeerCount(joinedRoom);
      // Clean up empty rooms after 5 min
      if (joinedRoom.clients.size === 0) {
        const idRef = roomId;
        setTimeout(() => {
          const r = rooms.get(idRef);
          if (r && r.clients.size === 0) rooms.delete(idRef);
        }, 5 * 60 * 1000);
      }
    }
  });
});

// Heartbeat to drop dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log(`livecode relay listening on :${PORT}`);
});
