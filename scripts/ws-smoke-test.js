"use strict";

const http = require("http");
const WebSocket = require("ws");

const host = process.env.RIO_RADAR_HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8080);
const socket = new WebSocket(`ws://${host}:${port}/ws`);
const timeout = setTimeout(() => {
  console.error("Falha: timeout aguardando pacote WebSocket");
  socket.close();
  process.exit(1);
}, 5000);

socket.on("open", () => {
  const payload = JSON.stringify({
    mmsi: "710000001",
    lat: -3.21,
    lng: -60.43,
    speed: 8.2,
    heading: 125,
    source: "ais",
    quality: "Smoke test"
  });

  const request = http.request({
    hostname: host,
    port,
    path: "/ingest/ais",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    }
  }, (response) => {
    if (response.statusCode !== 202) {
      console.error(`Falha HTTP: status ${response.statusCode}`);
      process.exit(1);
    }
    response.resume();
  });

  request.on("error", (error) => {
    clearTimeout(timeout);
    console.error(`Falha HTTP: ${error.message}`);
    socket.close();
    process.exit(1);
  });
  request.end(payload);
});

socket.on("message", (data) => {
  const packet = JSON.parse(data.toString());
  if (packet.boatId !== "710000001") return;

  clearTimeout(timeout);
  console.log(`OK: ${packet.source} ${packet.lat},${packet.lng}`);
  socket.close();
  setTimeout(() => process.exit(0), 50);
});

socket.on("error", (error) => {
  clearTimeout(timeout);
  console.error(`Falha WebSocket: ${error.message}`);
  process.exit(1);
});
