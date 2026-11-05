"use strict";

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const WebSocket = require("ws");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const STATIC_ROOT = __dirname;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"
};

// Simple radio-region filter prevents unrelated traffic from changing Amazon route assets.
const AREA = Object.freeze({
  minLat: Number(process.env.AREA_MIN_LAT || -6.0), maxLat: Number(process.env.AREA_MAX_LAT || -1.0),
  minLng: Number(process.env.AREA_MIN_LNG || -66.5), maxLng: Number(process.env.AREA_MAX_LNG || -59.0)
});

const clients = new Set();
const aliases = parseAliases(process.env.BOAT_ALIASES || "");

function parseAliases(raw) {
  const result = new Map();
  raw.split(",").forEach((entry) => {
    const [externalId, boatId] = entry.split("=").map((value) => value?.trim());
    if (externalId && boatId) result.set(externalId.toUpperCase(), boatId);
  });
  return result;
}

function resolveBoatId(packet) {
  const raw = String(packet.boatId || packet.id || packet.mmsi || packet.callsign || "");
  const normalized = raw.trim().toUpperCase();
  return aliases.get(normalized) || packet.boatId || packet.id || null;
}

function validPacket(packet) {
  const lat = Number(packet.lat);
  const lng = Number(packet.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 && lat >= AREA.minLat && lat <= AREA.maxLat &&
    lng >= AREA.minLng && lng <= AREA.maxLng;
}

function broadcast(rawPacket) {
  const packet = { ...rawPacket, timestamp: Math.floor(Date.now() / 1000) };
  const boatId = resolveBoatId(packet);
  if (!boatId || !validPacket(packet)) return;

  const normalized = {
    boatId,
    lat: Number(packet.lat),
    lng: Number(packet.lng),
    speed: Number.isFinite(Number(packet.speed)) ? Number(packet.speed) : 0,
    heading: Number.isFinite(Number(packet.heading)) ? Number(packet.heading) : 0,
    source: packet.source || "radio",
    quality: packet.quality ?? packet.rssi ?? packet.status ?? "ativo",
    timestamp: packet.timestamp
  };

  const payload = JSON.stringify(normalized);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        request.destroy();
        reject(new Error("Payload too large"));
      }
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
  });
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, clients: clients.size }));
    return;
  }

  if ((request.url === "/ingest/ais" || request.url === "/ingest/radio") && request.method === "POST") {
    try {
      const packet = await readJson(request);
      if (Array.isArray(packet)) packet.forEach((item) => ingestAis(item));
      else ingestAis(packet.source === "aprs" || packet.callsign ? packet : { ...packet, source: packet.source || "radio" });
      response.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ accepted: true }));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Invalid JSON" }));
    }
    return;
  }

  const requestPath = request.url === "/" ? "/index.html" : decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const filePath = path.resolve(STATIC_ROOT, `.${requestPath}`);
  if (!filePath.startsWith(STATIC_ROOT + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    response.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  });
});

const wsServer = new WebSocket.Server({ server, path: "/ws" });
wsServer.on("connection", (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: "connected", timestamp: Math.floor(Date.now() / 1000) }));
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

function ingestAis(packet) {
  const lat = packet.lat ?? packet.latitude ?? packet.LAT ?? packet.LATITUDE;
  const lng = packet.lng ?? packet.lon ?? packet.longitude ?? packet.LON ?? packet.LONGITUDE;
  const mmsi = packet.mmsi ?? packet.MMSI ?? packet.id;
  broadcast({
    id: mmsi ? String(mmsi) : packet.boatId,
    boatId: packet.boatId,
    lat,
    lng,
    speed: packet.speed ?? packet.sog ?? packet.SOG ?? 0,
    heading: packet.heading ?? packet.course ?? packet.cog ?? packet.COG ?? 0,
    source: packet.source || "ais",
    quality: packet.status ?? packet.rssi ?? "AIS"
  });
}

// APRS TCP uses 4-character north/south and 5-character east/west coordinate fragments.
function parseAprsLine(line) {
  if (line.startsWith("#")) return;
  const position = line.match(/([0-9]{4}\.[0-9]{2})([NS]).*?([0-9]{5}\.[0-9]{2})([EW])/);
  if (!position) return;
  const callsign = line.match(/^([A-Z0-9-]+)/)?.[1];
  const latRaw = Number(position[1]);
  const lngRaw = Number(position[3]);
  const lat = Math.floor(latRaw / 100) + (latRaw % 100) / 60;
  const lng = Math.floor(lngRaw / 100) + (lngRaw % 100) / 60;
  const courseSpeed = line.match(/([0-9]{3})\/([0-9]{3})/);
  broadcast({
    callsign,
    lat: position[2] === "S" ? -lat : lat,
    lng: position[4] === "W" ? -lng : lng,
    heading: courseSpeed ? Number(courseSpeed[1]) : 0,
    speed: courseSpeed ? Number(courseSpeed[2]) * 0.539957 : 0,
    source: "aprs",
    quality: "APRS-IS"
  });
}

function connectAprsIs() {
  const host = process.env.APRS_IS_HOST;
  if (!host) return;
  const port = Number(process.env.APRS_IS_PORT || 14580);
  const filter = process.env.APRS_IS_FILTER || `r ${-3.1190} ${-60.0217} 150`;
  const callsign = process.env.APRS_IS_CALLSIGN || "N0CALL";
  const passcode = process.env.APRS_IS_PASSCODE || "-1";
  let retryTimer;
  let client;

  const connect = () => {
    client = net.createConnection({ host, port }, () => {
      client.write(`# Rio Radar APRS client\r\n`);
      client.write(`user ${callsign} pass ${passcode} vers RioRadar 1.0 filter ${filter}\r\n`);
    });
    let buffer = "";
    client.setEncoding("utf8");
    client.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(parseAprsLine);
    });
    client.on("close", () => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, Number(process.env.APRS_IS_RETRY_MS || 10000));
    });
    client.on("error", () => client.destroy());
  };
  connect();
}

function extractAisStreamPacket(message) {
  const metadata = message.MetaData || {};
  const report = message.Message?.PositionReport
    || message.Message?.StandardClassBPositionReport
    || message.Message?.ExtendedClassBPositionReport
    || message.Message?.LongRangeAISBroadcastMessage;
  if (!report) return null;

  const mmsi = metadata.MMSI;
  const lat = report.Latitude ?? report.lat;
  const lng = report.Longitude ?? report.lon;
  const speed = report.Sog ?? report.SOG ?? report.SpeedOverGround;
  const heading = report.Cog ?? report.COG ?? report.CourseOverGround ?? report.TrueHeading;
  if (!mmsi || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;

  return {
    boatId: String(mmsi), mmsi: String(mmsi),
    lat: Number(lat), lng: Number(lng),
    speed: Number.isFinite(Number(speed)) ? Number(speed) : 0,
    heading: Number.isFinite(Number(heading)) ? Number(heading) : 0,
    source: "ais", quality: `AISStream${metadata.Source ? ` / ${metadata.Source}` : ""}`,
    timestamp: metadata.time_stamp || Math.floor(Date.now() / 1000)
  };
}

function parseBoundingBoxes() {
  if (process.env.AISSTREAM_BOUNDING_BOXES) {
    try { return JSON.parse(process.env.AISSTREAM_BOUNDING_BOXES); }
    catch (error) { console.error("AISSTREAM_BOUNDING_BOXES inválido:", error.message); }
  }
  // Manaus/reach default. The first pair is south-west and north-east.
  return [[[-4.5, -62.5], [-2.5, -58.5]]];
}

function connectAisStream() {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) return;

  const url = "wss://stream.aisstream.io/v0/stream";
  let socket;
  let reconnectTimer;
  let reconnectDelay = 5000;

  const connect = () => {
    socket = new WebSocket(url);
    socket.on("open", () => {
      reconnectDelay = 5000;
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: parseBoundingBoxes(),
        FilterMessageTypes: [
          "PositionReport",
          "StandardClassBPositionReport",
          "ExtendedClassBPositionReport",
          "LongRangeAISBroadcastMessage"
        ]
      }));
      console.log("AISStream connected");
    });
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const packet = extractAisStreamPacket(message);
        if (packet) broadcast(packet);
      } catch (error) {
        console.warn("AISStream message ignored:", error.message);
      }
    });
    socket.on("error", () => socket.close());
    socket.on("close", () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
    });
  };
  connect();
}

async function pollAisHub() {
  const username = process.env.AISHUB_USERNAME;
  const apiKey = process.env.AISHUB_API_KEY;
  if (!username && !apiKey) return;
  const url = new URL("https://data.aishub.net/ws.php");
  url.searchParams.set("username", username || "");
  url.searchParams.set("format", "1");
  url.searchParams.set("output", "json");
  if (apiKey) url.searchParams.set("apikey", apiKey);
  url.searchParams.set("latmin", String(AREA.minLat));
  url.searchParams.set("latmax", String(AREA.maxLat));
  url.searchParams.set("lonmin", String(AREA.minLng));
  url.searchParams.set("lonmax", String(AREA.maxLng));

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`AISHub returned ${response.status}`);
    const data = await response.json();
    const records = Array.isArray(data) ? data : data[1] || data.ships || [];
    records.forEach((record) => ingestAis(record));
  } catch (error) {
    console.error("AISHub polling failed:", error.message);
  }
}

server.listen(PORT, HOST, () => {
  console.log(`Rio Radar server: http://${HOST}:${PORT}`);
  connectAisStream();
  connectAprsIs();
  if (process.env.AISHUB_USERNAME || process.env.AISHUB_API_KEY) {
    pollAisHub();
    setInterval(pollAisHub, Number(process.env.AISHUB_POLL_MS || 15000)).unref();
  }
});
