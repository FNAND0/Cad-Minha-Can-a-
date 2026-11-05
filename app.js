"use strict";

(() => {
  const routeFeature = RioTelemetryData.route.features[0];
  const route = routeFeature.geometry.coordinates;
  const vessels = RioTelemetryData.vessels.features;
  const markerCache = new Map();
  const trailCache = new Map();
  const state = {
    map: null, selectedId: null, lastUpdate: 0, frame: 0, running: true,
    radioSocket: null, reconnectTimer: 0, reconnectDelayMs: RioRadarConfig.radioReconnectDelayMs,
    pendingPositions: new Map()
  };

  const refs = {
    loader: document.getElementById("mapLoader"), error: document.getElementById("mapError"),
    list: document.getElementById("vesselList"), count: document.getElementById("activeCount"),
    detail: document.getElementById("detailPanel"), sidebar: document.getElementById("sidebar"),
    clock: document.getElementById("clock")
  };

  // Box-Muller creates a bounded, natural-looking Gaussian signal for GPS noise.
  function gaussianNoise() {
    const u = Math.max(Math.random(), Number.EPSILON);
    const v = Math.max(Math.random(), Number.EPSILON);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Precalculate polyline distances once; interpolation never scans or mutates raw data.
  function haversine(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad;
    const dLon = (b[0] - a[0]) * rad;
    const lat1 = a[1] * rad;
    const lat2 = b[1] * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  const segments = [];
  let routeLengthKm = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const length = haversine(route[i], route[i + 1]);
    segments.push({ from: route[i], to: route[i + 1], start: routeLengthKm, length });
    routeLengthKm += length;
  }

  function nearestProgress(coordinates) {
    let closest = { distance: Infinity, progress: 0 };
    segments.forEach((segment) => {
      const dx = segment.to[0] - segment.from[0];
      const dy = segment.to[1] - segment.from[1];
      const lengthSquared = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((coordinates[0] - segment.from[0]) * dx + (coordinates[1] - segment.from[1]) * dy) / lengthSquared));
      const point = [segment.from[0] + dx * t, segment.from[1] + dy * t];
      const distance = (point[0] - coordinates[0]) ** 2 + (point[1] - coordinates[1]) ** 2;
      if (distance < closest.distance) closest = { distance, progress: (segment.start + segment.length * t) / routeLengthKm };
    });
    return closest.progress;
  }

  function interpolateProgress(progress) {
    const targetKm = Math.max(0, Math.min(routeLengthKm, progress * routeLengthKm));
    const segment = segments.find((item) => targetKm >= item.start && targetKm <= item.start + item.length) || segments[segments.length - 1];
    const local = segment.length ? (targetKm - segment.start) / segment.length : 0;
    return {
      coordinates: [
        segment.from[0] + (segment.to[0] - segment.from[0]) * local,
        segment.from[1] + (segment.to[1] - segment.from[1]) * local
      ],
      segment
    };
  }

  function bearingDegrees(from, to) {
    const radians = Math.PI / 180;
    const dx = (to[0] - from[0]) * Math.cos((from[1] + to[1]) * 0.5 * radians);
    const dy = to[1] - from[1];
    return (Math.atan2(dx, dy) / radians + 360) % 360;
  }

  const vesselStates = vessels.map((feature, index) => ({
    feature,
    progress: nearestProgress(feature.geometry.coordinates),
    phase: index * 1.37,
    source: "simulacao",
    lastRealPacketAt: 0,
    realStatus: false,
    originalStatus: feature.properties.status
  }));

  function nauticalIcon(status, selected = false, heading = 0) {
    const colors = {
      em_navegacao: "#39d98a",
      atracado: "#c69050",
      falha_sinal: "#f85149"
    };
    return {
      path: "M 0,-14 L 10,10 L 0,6 L -10,10 Z",
      fillColor: selected ? "#58a6ff" : (colors[status] || colors.em_navegacao),
      fillOpacity: 1,
      strokeColor: selected ? "#d3ebff" : "#07140e",
      strokeWeight: selected ? 1.5 : 1,
      rotation: heading,
      scale: 1,
      anchor: new google.maps.Point(0, 0)
    };
  }

  function createMap() {
    const darkStyles = [
      { elementType: "geometry", stylers: [{ color: "#0d1117" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#8b949e" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#0d1117" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#101a24" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#1c232b" }] },
      { featureType: "poi", stylers: [{ visibility: "off" }] },
      { featureType: "transit", stylers: [{ visibility: "off" }] }
    ];

    state.map = new google.maps.Map(document.getElementById("map"), {
      center: { lat: -6.35, lng: -59.0 },
      zoom: 5,
      minZoom: 6,
      maxZoom: 12,
      disableDefaultUI: true,
      gestureHandling: "greedy",
      keyboardShortcuts: false,
      styles: darkStyles
    });

    const latLngs = route.map((point) => ({ lat: point[1], lng: point[0] }));
    new google.maps.Polyline({
      path: latLngs,
      geodesic: true,
      strokeColor: "#58a6ff",
      strokeOpacity: 0.78,
      strokeWeight: 2,
      map: state.map
    });

    vesselStates.forEach((vessel) => {
      const properties = vessel.feature.properties;
      const marker = new google.maps.Marker({
        position: { lat: vessel.feature.geometry.coordinates[1], lng: vessel.feature.geometry.coordinates[0] },
        map: state.map,
        title: properties.nome,
        icon: nauticalIcon(properties.status, false, properties.rumo_graus)
      });
      marker.addListener("click", () => selectVessel(properties.id));
      markerCache.set(properties.id, marker);
    });

    const bounds = new google.maps.LatLngBounds(
      new google.maps.LatLng(-18.0, -74.0),
      new google.maps.LatLng(5.3, -44.0)
    );
    state.map.fitBounds(bounds, { top: 44, right: 42, bottom: 42, left: 42 });
    refs.loader.style.display = "none";
  }

  function updateVessel(vessel, elapsedSeconds, timestamp = performance.now()) {
    const properties = vessel.feature.properties;

    if (vessel.realStatus && timestamp - vessel.lastRealPacketAt >= RioRadarConfig.radioSignalTimeoutMs) {
      vessel.realStatus = false;
      properties.status = "falha_sinal";
      properties.origem_telemetria = "ais";
    }

    // Embarcações reais permanecem imóveis até receber outra posição válida.
    updateMarker(vessel, properties.rumo_graus);
  }

  function updateMarker(vessel, heading) {
    const marker = markerCache.get(vessel.feature.properties.id);
    if (!marker) return;
    const properties = vessel.feature.properties;
    marker.setPosition(new google.maps.LatLng(
      vessel.feature.geometry.coordinates[1],
      vessel.feature.geometry.coordinates[0]
    ));
    marker.setIcon(nauticalIcon(properties.status, state.selectedId === properties.id, heading));
  }

  function toDMS(value, axis) {
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    const minutesFull = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesFull);
    const seconds = (minutesFull - minutes) * 60;
    const suffix = axis === "lat" ? (value >= 0 ? "N" : "S") : (value >= 0 ? "E" : "W");
    return `${degrees}° ${minutes}' ${seconds.toFixed(2)}\" ${suffix}`;
  }

  function renderList() {
    const fragment = document.createDocumentFragment();
    vessels.forEach((feature) => {
      const properties = feature.properties;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vessel-item";
      button.dataset.id = properties.id;
      button.setAttribute("role", "listitem");
      button.innerHTML = `<span class="status-beacon" data-status="${properties.status}"></span>
        <span class="vessel-copy"><strong>${properties.nome}</strong><span>${properties.id}</span></span>
        <span class="vessel-speed"><strong>${properties.velocidade_nos.toFixed(1)}</strong> nós</span>`;
      button.addEventListener("click", () => selectVessel(properties.id), { passive: true });
      fragment.appendChild(button);
    });
    refs.list.replaceChildren(fragment);
    refs.count.value = String(vessels.length);
    refs.count.textContent = String(vessels.length);
  }

  function transmissionLabel(properties) {
    if (properties.status === "sem_posicao") return "AIS / SEM POSIÇÃO";
    if (properties.status === "falha_sinal") return "SEM SINAL";
    if (properties.origem_telemetria && properties.origem_telemetria !== "simulacao") {
      return `${String(properties.origem_telemetria).toUpperCase()} / ${properties.qualidade_sinal || "ATIVO"}`;
    }
    return "SEM POSIÇÃO REAL";
  }

  function selectVessel(id) {
    state.selectedId = id;
    const feature = vessels.find((item) => item.properties.id === id);
    if (!feature) return;
    const properties = feature.properties;
    const [longitude, latitude] = feature.geometry.coordinates;

    refs.list.querySelectorAll(".vessel-item").forEach((item) => item.classList.toggle("selected", item.dataset.id === id));
    refs.detail.innerHTML = `<div class="detail-header"><div><span>EMBARCAÇÃO SELECIONADA</span><strong>${properties.nome}</strong></div><span>${properties.id}</span></div>
      <div class="detail-grid">
        <div class="detail-cell"><span>Velocidade</span><strong>${properties.velocidade_nos.toFixed(1)} kn</strong></div>
        <div class="detail-cell"><span>Próxima parada</span><strong>${properties.proxima_parada}</strong></div>
        <div class="detail-cell"><span>Latitude</span><strong>${toDMS(latitude, "lat")}</strong></div>
        <div class="detail-cell"><span>Longitude</span><strong>${toDMS(longitude, "lon")}</strong></div>
        <div class="detail-cell"><span>Rumo</span><strong>${Math.round(properties.rumo_graus)}°</strong></div>
        <div class="detail-cell"><span>Transmissão</span><strong>${transmissionLabel(properties)}</strong></div>
      </div>`;

    vesselStates.forEach((vessel) => updateMarker(vessel, vessel.feature.properties.rumo_graus));
    if (state.map) {
      state.map.panTo({ lat: latitude, lng: longitude });
      state.map.setZoom(10);
    }

    if (window.matchMedia("(max-width: 767px)").matches) refs.sidebar.classList.add("open");
  }

  function simulationLoop(timestamp) {
    if (!state.running) return;
    applyPendingPositionUpdates();
    const elapsedSeconds = state.lastUpdate ? Math.min(0.5, (timestamp - state.lastUpdate) / 1000) : 0.25;
    state.lastUpdate = timestamp;

    if (timestamp - state.lastFrame > 250) {
      vesselStates.forEach((vessel) => updateVessel(vessel, elapsedSeconds, timestamp));
      if (state.selectedId) updateDetailCoordinates(state.selectedId);
      state.lastFrame = timestamp;
    }
    state.frame = requestAnimationFrame(simulationLoop);
  }

  function updateDetailCoordinates(id) {
    const feature = vessels.find((item) => item.properties.id === id);
    if (!feature || !refs.detail.querySelector(".detail-grid")) return;
    const properties = feature.properties;
    const [longitude, latitude] = feature.geometry.coordinates;
    const cells = refs.detail.querySelectorAll(".detail-cell strong");
    if (cells.length === 6) {
      cells[0].textContent = `${properties.velocidade_nos.toFixed(1)} kn`;
      cells[2].textContent = toDMS(latitude, "lat");
      cells[3].textContent = toDMS(longitude, "lon");
      cells[4].textContent = `${Math.round(properties.rumo_graus)}°`;
      cells[5].textContent = transmissionLabel(properties);
      const detailGrid = refs.detail.querySelector(".detail-grid");
      if (properties.name && !detailGrid.querySelector('[data-field="vessel-name"]')) {
        const extra = document.createElement("div");
        extra.className = "detail-cell";
        extra.dataset.field = "vessel-name";
        extra.innerHTML = `<span>Nome AIS / IMO</span><strong>${properties.nome || "-"}${properties.imo ? ` / ${properties.imo}` : ""}</strong>`;
        detailGrid.appendChild(extra);
      }
    }
  }

  function handleVisibility() {
    if (document.hidden) {
      state.running = false;
      cancelAnimationFrame(state.frame);
      state.lastUpdate = 0;
    } else {
      state.running = true;
      state.lastFrame = 0;
      state.lastUpdate = 0;
      state.frame = requestAnimationFrame(simulationLoop);
      if (RioRadarConfig.radioWebSocketUrl && (!state.radioSocket || state.radioSocket.readyState > 1)) {
        connectRadioStream();
      }
    }
  }

  function bindUI() {
    document.getElementById("zoomIn").addEventListener("click", () => state.map?.setZoom(state.map.getZoom() + 1));
    document.getElementById("zoomOut").addEventListener("click", () => state.map?.setZoom(state.map.getZoom() - 1));
    document.getElementById("fitRoute").addEventListener("click", () => {
      if (!state.map) return;
      const bounds = new google.maps.LatLngBounds();
      route.forEach((point) => bounds.extend({ lat: point[1], lng: point[0] }));
      state.map.fitBounds(bounds, { top: 44, right: 42, bottom: 42, left: 42 });
    });
    document.getElementById("sidebarToggle").addEventListener("click", () => {
      refs.sidebar.classList.toggle("collapsed");
      document.getElementById("sidebarToggle").setAttribute("aria-expanded", String(!refs.sidebar.classList.contains("collapsed")));
      setTimeout(() => google.maps.event.trigger(state.map, "resize"), 200);
    });
    document.getElementById("mobileMenu").addEventListener("click", () => refs.sidebar.classList.add("open"));
    document.addEventListener("visibilitychange", handleVisibility);

    window.setInterval(() => {
      refs.clock.textContent = `${new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Manaus",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(new Date())} UTC-4`;
    }, 1000);
  }

  function normalizePacketTimestamp(value) {
    if (!Number.isFinite(value)) return Date.now();
    const numeric = Number(value);
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }

  function appendPositionTrail(vessel, latitude, longitude) {
    const boatId = vessel.feature.properties.id;
    let history = trailCache.get(boatId);
    if (!history) {
      history = [];
      trailCache.set(boatId, history);
    }
    const last = history[history.length - 1];
    if (!last || Math.abs(last.lat - latitude) > 0.00001 || Math.abs(last.lng - longitude) > 0.00001) {
      history.push({ lat: latitude, lng: longitude });
      if (history.length > 60) history.shift();
    }

    let trail = vessel.trail;
    if (!trail && state.map) {
      trail = new google.maps.Polyline({
        path: history.map((point) => ({ lat: point.lat, lng: point.lng })),
        geodesic: true,
        strokeColor: "#34c8d9",
        strokeOpacity: 0.62,
        strokeWeight: 2,
        map: state.map
      });
      vessel.trail = trail;
    } else if (trail) {
      trail.setPath(history.map((point) => ({ lat: point.lat, lng: point.lng })));
    }
  }

  function queuePositionUpdate(vessel, latitude, longitude, heading, packetTimestamp) {
    const marker = markerCache.get(vessel.feature.properties.id);
    const markerPosition = marker?.getPosition();
    const from = markerPosition
      ? { lat: markerPosition.lat(), lng: markerPosition.lng() }
      : { lat: vessel.feature.geometry.coordinates[1], lng: vessel.feature.geometry.coordinates[0] };

    state.pendingPositions.set(vessel.feature.properties.id, {
      vessel,
      from,
      to: { lat: latitude, lng: longitude },
      heading,
      packetTimestamp,
      startedAt: performance.now(),
      duration: 900
    });
    appendPositionTrail(vessel, latitude, longitude);
  }

  function applyPendingPositionUpdates() {
    const now = performance.now();
    state.pendingPositions.forEach((update, boatId) => {
      const progress = Math.min(1, (now - update.startedAt) / update.duration);
      const eased = 1 - ((1 - progress) ** 3);
      const latitude = update.from.lat + (update.to.lat - update.from.lat) * eased;
      const longitude = update.from.lng + (update.to.lng - update.from.lng) * eased;
      const marker = markerCache.get(boatId);

      if (marker) marker.setPosition(new google.maps.LatLng(latitude, longitude));
      update.vessel.feature.geometry.coordinates = [longitude, latitude];

      if (progress >= 1) {
        update.vessel.feature.geometry.coordinates = [update.to.lng, update.to.lat];
        state.pendingPositions.delete(boatId);
        updateMarker(update.vessel, update.heading);
      }
    });
  }

  function processRadioPacket(packet) {
    const boatId = String(packet.boatId || packet.id || "").trim();
    if (!boatId) return;
    let feature = vessels.find((item) => item.properties.id === boatId);
    if (packet.staticOnly && feature) {
      Object.assign(feature.properties, {
        nome: packet.name || feature.properties.nome,
        callSign: packet.callSign || null,
        imo: packet.imo || null,
        tipoAIS: packet.shipType || null,
        destino: packet.destination || null,
        draught: packet.draught || null,
        origem_telemetria: packet.source || "ais",
        timestamp_telemetria: normalizePacketTimestamp(Number(packet.timestamp)),
        qualidade_sinal: packet.quality || "AIS"
      });
      if (state.selectedId === boatId) updateDetailCoordinates(boatId);
      renderList();
      return;
    }

    if (packet.staticOnly && !feature) {
      feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [null, null] },
        properties: {
          id: boatId,
          nome: packet.name || packet.vesselName || `MMSI ${boatId}`,
          tipo: packet.shipType || "Tipo não informado",
          velocidade_nos: 0,
          rumo_graus: 0,
          status: "sem_posicao",
          proxima_parada: packet.destination || "Não informada",
          bateria_rastreador: 0,
          origem_telemetria: "ais",
          callSign: packet.callSign || null,
          imo: packet.imo || null,
          destino: packet.destination || null,
          draught: packet.draught || null
        }
      };
      vessels.push(feature);
      renderList();
      if (state.selectedId === boatId) updateDetailCoordinates(boatId);
      return;
    }

    const latitude = Number(packet.lat);
    const longitude = Number(packet.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;

    let vessel = vesselStates.find((item) => item.feature.properties.id === boatId);
    if (!feature) {
      feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [longitude, latitude] },
        properties: {
          id: boatId,
          nome: packet.name || packet.vesselName || `Embarcação ${boatId}`,
          tipo: String(packet.source || "radio").toUpperCase(),
          velocidade_nos: 0,
          rumo_graus: 0,
          status: "em_navegacao",
          proxima_parada: "Não informada",
          bateria_rastreador: 0,
          origem_telemetria: "ais"
        }
      };
      vessels.push(feature);
      vessel = {
        feature,
        progress: nearestProgress(feature.geometry.coordinates),
        phase: vesselStates.length * 1.37,
        source: "ais",
        lastRealPacketAt: 0,
        realStatus: false,
        originalStatus: "em_navegacao"
      };
      vesselStates.push(vessel);
      renderList();

      if (state.map) {
        const marker = new google.maps.Marker({
          position: { lat: latitude, lng: longitude },
          map: state.map,
          title: feature.properties.nome,
          icon: nauticalIcon("em_navegacao", false, 0)
        });
        marker.addListener("click", () => selectVessel(boatId));
        markerCache.set(boatId, marker);
      }
    } else if (!vessel && feature) {
      vessel = {
        feature,
        progress: nearestProgress([longitude, latitude]),
        phase: vesselStates.length * 1.37,
        source: "ais",
        lastRealPacketAt: 0,
        realStatus: false,
        originalStatus: "em_navegacao"
      };
      vesselStates.push(vessel);
      feature.geometry.coordinates = [longitude, latitude];
      feature.properties.status = "em_navegacao";
      if (state.map && !markerCache.has(boatId)) {
        const marker = new google.maps.Marker({
          position: { lat: latitude, lng: longitude },
          map: state.map,
          title: feature.properties.nome,
          icon: nauticalIcon("em_navegacao", false, 0)
        });
        marker.addListener("click", () => selectVessel(boatId));
        markerCache.set(boatId, marker);
      }
    }

    const speed = Number(packet.speed);
    const heading = Number(packet.heading);
    const packetTimestamp = normalizePacketTimestamp(Number(packet.timestamp));
    if (vessel.lastPacketTimestamp && packetTimestamp < vessel.lastPacketTimestamp) return;

    const allowedSources = new Set(["aprs", "lora", "ais", "checkpoint", "radio", "satellite"]);
    const source = allowedSources.has(String(packet.source || "").toLowerCase())
      ? String(packet.source).toLowerCase()
      : "radio";

    feature.geometry.coordinates = [longitude, latitude];
    feature.properties.velocidade_nos = Number.isFinite(speed) ? Math.max(0, speed) : feature.properties.velocidade_nos;
    feature.properties.rumo_graus = Number.isFinite(heading) ? (heading + 360) % 360 : feature.properties.rumo_graus;
    feature.properties.status = packet.status === "atracado" ? "atracado" : "em_navegacao";
    feature.properties.origem_telemetria = source;
    feature.properties.timestamp_telemetria = packetTimestamp;
    feature.properties.qualidade_sinal = packet.quality || packet.rssi || "recebido";
    feature.properties.messageType = packet.messageType || null;
    feature.properties.navigationalStatus = packet.navigationalStatus || null;
    feature.properties.rotationRate = packet.rotationRate ?? null;
    feature.properties.timestamp_telemetria = packetTimestamp;

    vessel.realStatus = true;
    vessel.source = source;
    vessel.lastRealPacketAt = performance.now();
    vessel.progress = nearestProgress([longitude, latitude]);
    vessel.lastPacketTimestamp = packetTimestamp;

    queuePositionUpdate(vessel, latitude, longitude, feature.properties.rumo_graus, packetTimestamp);
    if (state.selectedId === boatId) updateDetailCoordinates(boatId);
  }

  function connectRadioStream() {
    const url = RioRadarConfig.radioWebSocketUrl;
    if (!url || url === "") return;

    try {
      state.radioSocket = new WebSocket(url);
    } catch (error) {
      console.error("Não foi possível abrir o stream de rádio:", error);
      scheduleRadioReconnect();
      return;
    }

    state.radioSocket.addEventListener("message", (event) => {
      try {
        processRadioPacket(JSON.parse(event.data));
      } catch (error) {
        console.warn("Pacote de rádio inválido:", error);
      }
    });
    state.radioSocket.addEventListener("open", () => {
      state.reconnectDelayMs = RioRadarConfig.radioReconnectDelayMs;
    });
    state.radioSocket.addEventListener("close", () => {
      scheduleRadioReconnect();
    });
    state.radioSocket.addEventListener("error", () => {
      state.radioSocket?.close();
    });
  }

  function scheduleRadioReconnect() {
    if (document.hidden || state.reconnectTimer) return;
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = 0;
      connectRadioStream();
      state.reconnectDelayMs = Math.min(
        state.reconnectDelayMs * 2,
        RioRadarConfig.radioMaxReconnectDelayMs
      );
    }, state.reconnectDelayMs);
  }

  function loadGoogleMaps() {
    const apiKey = RioRadarConfig.googleMapsApiKey;
    if (!apiKey || apiKey === "SUA_API_KEY") {
      refs.loader.style.display = "none";
      refs.error.hidden = false;
      refs.error.querySelector("span").textContent = "Configure Google Maps em config.js com uma chave válida.";
      return;
    }

    window.initGoogleMaps = () => {
      try {
        createMap();
        state.frame = requestAnimationFrame(simulationLoop);
        connectRadioStream();
      } catch (error) {
        console.error("Falha ao inicializar Google Maps:", error);
        refs.loader.style.display = "none";
        refs.error.hidden = false;
      }
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initGoogleMaps&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      refs.loader.style.display = "none";
      refs.error.hidden = false;
      refs.error.querySelector("span").textContent = "Não foi possível carregar Google Maps. Verifique rede, chave e restrições de domínio.";
    };
    document.head.appendChild(script);

    window.setTimeout(() => {
      if (!state.map) {
        refs.loader.style.display = "none";
        refs.error.hidden = false;
      }
    }, 7000);
  }

  renderList();
  bindUI();
  state.lastFrame = 0;
  loadGoogleMaps();
})();
