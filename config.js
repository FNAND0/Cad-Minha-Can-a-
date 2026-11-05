"use strict";

// Google Maps recebe uma chave de navegador pública; restrinja-a por domínio HTTP no Google Cloud.
const RioRadarConfig = Object.freeze({
  googleMapsApiKey: "AIzaSyBWAlAkYpeqU4H5lylamtoWg0TtSKU9YBQ",
  radioWebSocketUrl: `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`,
  radioReconnectDelayMs: 5000,
  radioSignalTimeoutMs: 60000,
  radioMaxReconnectDelayMs: 30000
});
