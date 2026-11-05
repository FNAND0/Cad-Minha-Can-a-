"use strict";

(() => {
  const routeFeature = RioTelemetryData.route.features[0];
  const route = routeFeature.geometry.coordinates;
  const vessels = RioTelemetryData.vessels.features;
  const markerCache = new Map();
  const state = { map: null, selectedId: null, lastUpdate: 0, frame: 0, running: true };

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
    phase: index * 1.37
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
      center: { lat: -3.7, lng: -62.1 },
      zoom: 7,
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

    const bounds = new google.maps.LatLngBounds();
    latLngs.forEach((point) => bounds.extend(point));
    state.map.fitBounds(bounds, { top: 44, right: 42, bottom: 42, left: 42 });
    refs.loader.style.display = "none";
  }

  function updateVessel(vessel, elapsedSeconds) {
    const properties = vessel.feature.properties;
    if (properties.status === "atracado" || properties.status === "falha_sinal") {
      updateMarker(vessel, properties.rumo_graus);
      return;
    }

    // The simulation clock is accelerated, while elapsed-time integration keeps motion stable.
    const baseSpeedKmH = properties.velocidade_nos * 1.852;
    const currentTimeNoise = gaussianNoise() * 0.45 + gaussianNoise() * 0.1;
    properties.velocidade_nos = Math.max(0, properties.velocidade_nos + currentTimeNoise * 0.025);

    vessel.progress += (baseSpeedKmH / routeLengthKm / 3600) * elapsedSeconds * 180;
    if (vessel.progress > 1.02) vessel.progress -= 1.02;

    const interpolation = interpolateProgress(vessel.progress);
    const t = Math.max(0, Math.min(1, ((vessel.progress * routeLengthKm - interpolation.segment.start) / interpolation.segment.length) || 0));
    const heading = bearingDegrees(interpolation.segment.from, interpolation.segment.to);
    properties.rumo_graus = Math.round((heading + gaussianNoise() * 1.2 + 360) % 360);

    // Subtle coordinate noise simulates non-differential GPS while preserving route shape.
    const gpsNoise = 0.000025 * gaussianNoise();
    const crossNoise = 0.000025 * gaussianNoise();
    const longitude = interpolation.coordinates[0] + gpsNoise;
    const latitude = interpolation.coordinates[1] + crossNoise;
    vessel.feature.geometry.coordinates = [longitude, latitude];
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
        <div class="detail-cell"><span>Transmissão</span><strong>${properties.status === "falha_sinal" ? "SEM SINAL" : `BATERIA ${properties.bateria_rastreador}%`}</strong></div>
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
    const elapsedSeconds = state.lastUpdate ? Math.min(0.5, (timestamp - state.lastUpdate) / 1000) : 0.25;
    state.lastUpdate = timestamp;

    if (timestamp - state.lastFrame > 250) {
      vesselStates.forEach((vessel) => updateVessel(vessel, elapsedSeconds));
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

  function processRadioPacket(packet) {
    const boatId = String(packet.boatId || packet.id || "");
    const feature = vessels.find((item) => item.properties.id === boatId);
    if (!feature || !Number.isFinite(packet.lat) || !Number.isFinite(packet.lng)) return;

    feature.geometry.coordinates = [Number(packet.lng), Number(packet.lat)];
    feature.properties.velocidade_nos = Number.isFinite(packet.speed) ? Number(packet.speed) : feature.properties.velocidade_nos;
    feature.properties.rumo_graus = Number.isFinite(packet.heading) ? Number(packet.heading) : feature.properties.rumo_graus;
    feature.properties.status = "em_navegacao";

    const vessel = vesselStates.find((item) => item.feature.properties.id === boatId);
    if (vessel) vessel.progress = nearestProgress(feature.geometry.coordinates);
    if (markerCache.has(boatId)) updateMarker(vessel || { feature }, feature.properties.rumo_graus);
    if (state.selectedId === boatId) updateDetailCoordinates(boatId);
  }

  function connectRadioStream() {
    const url = RioRadarConfig.radioWebSocketUrl;
    if (!url || url === "") return;

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      console.error("Não foi possível abrir o stream de rádio:", error);
      return;
    }

    socket.addEventListener("message", (event) => {
      try {
        processRadioPacket(JSON.parse(event.data));
      } catch (error) {
        console.warn("Pacote de rádio inválido:", error);
      }
    });
    socket.addEventListener("close", () => {
      if (!document.hidden) window.setTimeout(connectRadioStream, RioRadarConfig.radioReconnectDelayMs);
    });
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
