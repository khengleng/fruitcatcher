const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size
  });
});

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomCode = "";

  for (let i = 0; i < 6; i += 1) {
    roomCode += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return roomCode;
}

function makeUniqueRoomCode() {
  let roomCode = generateRoomCode();

  while (rooms.has(roomCode)) {
    roomCode = generateRoomCode();
  }

  return roomCode;
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function cleanupRoom(roomCode, ws) {
  if (!roomCode) {
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  if (ws === room.tv) {
    send(room.controller, {
      type: "room_closed",
      roomCode
    });
    rooms.delete(roomCode);
    return;
  }

  if (ws === room.controller) {
    room.controller = null;
    send(room.tv, {
      type: "controller_disconnected",
      roomCode
    });
  }
}

wss.on("connection", (ws) => {
  ws.meta = {
    roomCode: null,
    role: null
  };

  send(ws, {
    type: "connected"
  });

  ws.on("message", (rawMessage) => {
    let data;

    try {
      data = JSON.parse(rawMessage.toString());
    } catch (_error) {
      send(ws, {
        type: "error",
        message: "Invalid JSON payload"
      });
      return;
    }

    if (data.type === "create_room") {
      const roomCode = makeUniqueRoomCode();
      rooms.set(roomCode, {
        tv: ws,
        controller: null
      });

      ws.meta.roomCode = roomCode;
      ws.meta.role = "tv";

      send(ws, {
        type: "room_created",
        roomCode
      });
      return;
    }

    if (data.type === "join_room") {
      const roomCode = String(data.roomCode || "").trim().toUpperCase();
      const room = rooms.get(roomCode);

      if (!room) {
        send(ws, {
          type: "join_error",
          message: "Room not found"
        });
        return;
      }

      if (room.controller && room.controller !== ws) {
        send(ws, {
          type: "join_error",
          message: "Room already has a controller"
        });
        return;
      }

      room.controller = ws;
      ws.meta.roomCode = roomCode;
      ws.meta.role = "controller";

      send(ws, {
        type: "joined_room",
        roomCode
      });

      send(room.tv, {
        type: "controller_joined",
        roomCode
      });
      return;
    }

    if (data.type === "control") {
      const roomCode = String(data.roomCode || ws.meta.roomCode || "").trim().toUpperCase();
      const room = rooms.get(roomCode);

      if (!room || ws !== room.controller) {
        send(ws, {
          type: "error",
          message: "You are not joined to an active room"
        });
        return;
      }

      send(room.tv, {
        type: "control",
        roomCode,
        action: data.action,
        gamma: data.gamma
      });
    }
  });

  ws.on("close", () => {
    cleanupRoom(ws.meta.roomCode, ws);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gateway listening on port ${PORT}`);
});
