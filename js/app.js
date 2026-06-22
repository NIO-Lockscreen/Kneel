/* EasyStride — app wiring: map init, waypoint flow, routing pipeline,
 * address entry, detour suggestions and control handlers. Loaded last. */
;(function () {
  "use strict";
  const ES = window.EasyStride;
  const { api, analysis, ui, geo, state, config, $, setStatus } = ES;

  /* ---------- map ---------- */
  const map = L.map("map", { zoomControl: true }).setView(config.center, config.zoom);
  const positron = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd", maxZoom: 19, attribution: "&copy; OpenStreetMap &copy; CARTO" }).addTo(map);
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    subdomains: "abc", maxZoom: 17, attribution: "&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap (CC-BY-SA)" });
  L.control.layers({ "Clean map": positron, "Topographic (contours)": topo }, null, { position: "topright" }).addTo(map);

  ES.map = map;
  ES.layers = {
    marker: L.layerGroup().addTo(map),
    route: L.layerGroup().addTo(map),
    deco: L.layerGroup().addTo(map),
  };

  /* ---------- MAP-LOAD FIX ----------
   * The map lives in a flexbox; if Leaflet measures the container before the
   * layout has settled it renders into a 0-size box and the tiles never show.
   * Recompute the size once the DOM is ready, after full load, on resize, and
   * whenever the container itself changes size. */
  function fixMapSize() { map.invalidateSize(false); }
  fixMapSize();
  setTimeout(fixMapSize, 0);
  setTimeout(fixMapSize, 250);
  window.addEventListener("load", fixMapSize);
  window.addEventListener("resize", fixMapSize);
  if (window.ResizeObserver) new ResizeObserver(fixMapSize).observe($("map"));

  /* ---------- waypoint flow ---------- */
  map.on("click", (e) => {
    if (state.busy) return;
    const w = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (state.mode === "ab") {
      if (state.waypoints.length >= 2) { state.waypoints = []; ui.resetResults(); }
      state.waypoints.push(w);
      setStatus(state.waypoints.length < 2 ? "Now tap your destination." : "Ready — tap “Route & analyse”.");
    } else if (state.mode === "compare") {
      if (state.waypoints.length >= 4) { state.waypoints = []; ui.resetResults(); }
      state.waypoints.push(w);
      const msgs = ["Tap the destination of trip 1.", "Tap the start of trip 2.", "Tap the destination of trip 2.", "Ready — tap “Route & analyse”."];
      setStatus(msgs[state.waypoints.length - 1] || "Ready — tap “Route & analyse”.");
    } else {
      state.waypoints.push(w);
      setStatus(state.waypoints.length < 3 ? `Add ${3 - state.waypoints.length} more point(s) around the lake.` : "Ready — tap “Route & analyse” to close the loop.");
    }
    ui.drawWaypoints(); ui.updateGoEnabled();
  });

  /* ---------- routing pipeline ---------- */
  // Build & elevation-tag every geometry returned by the router.
  async function buildRoutes(geoms) {
    const built = [];
    for (const geom of geoms) {
      const total = geom.reduce((a, _, i) => (i ? a + geo.haversine(geom[i - 1], geom[i]) : 0), 0);
      const pts = geo.resample(geom, Math.max(config.sampleSpacing, total / config.maxRoutePoints), config.maxRoutePoints);
      setStatus("Reading elevation…");
      const elev = geo.smooth(await api.fetchElevation(pts), 2);
      built.push({ pts, elev });
    }
    return built;
  }

  // route a single A→B pair and return its gentlest-within-detour option
  async function routePair(a, b) {
    let geoms;
    try { geoms = await api.osrmRoute([a, b], true); }
    catch (e) { geoms = [[a, b]]; }
    const built = await buildRoutes(geoms);
    const routes = built.map((x) => analysis.analyse(x.pts, x.elev, state.thr));
    return routes[analysis.pickWithinDetour(routes, state.detour)];
  }

  async function run() {
    if (state.busy) return;
    state.busy = true; ui.updateGoEnabled(); ui.resetResults();
    try {
      if (state.mode === "compare") {
        setStatus("Finding the first walking route…");
        const a = await routePair(state.waypoints[0], state.waypoints[1]);
        setStatus("Finding the second walking route…");
        const b = await routePair(state.waypoints[2], state.waypoints[3]);
        state.routes = [a, b];
        state.recommended = a.kneeLoad <= b.kneeLoad ? 0 : 1;
        state.selected = state.recommended;
        ui.renderCompare();
        setStatus("Done. Solid = shown trip, dashed = the other. Green/blue is easy on the knees; red is steep downhill.");
        return;
      }

      const wpts = state.mode === "loop" ? state.waypoints.concat([state.waypoints[0]]) : state.waypoints;
      setStatus("Finding walking route…");
      let geoms;
      try {
        geoms = await api.osrmRoute(wpts, state.mode === "ab");
      } catch (routeErr) {
        setStatus("Routing service unreachable — using straight-line estimate.", true);
        geoms = [wpts.slice()];
      }
      const built = await buildRoutes(geoms);

      if (state.mode === "loop") {
        const f = analysis.analyse(built[0].pts, built[0].elev, state.thr);
        const rv = analysis.reverseSeries(built[0].pts, built[0].elev);
        const r = analysis.analyse(rv.pts, rv.elev, state.thr);
        state.routes = [f, r];
        state.recommended = r.kneeLoad < f.kneeLoad ? 1 : 0;
      } else {
        state.routes = built.map((b) => analysis.analyse(b.pts, b.elev, state.thr));
        state.recommended = analysis.pickWithinDetour(state.routes, state.detour);
      }
      state.selected = state.recommended;
      ui.render();
      setStatus("Done. Green/blue is easy on the knees; red is the steep downhill to avoid.");
    } catch (err) {
      console.error(err);
      setStatus("Could not complete: " + err.message + ". Try again or move your points slightly.", true);
    } finally {
      state.busy = false; ui.updateGoEnabled();
    }
  }

  /* ---------- address entry ---------- */
  async function routeFromAddresses() {
    const a = $("addrStart").value, b = $("addrEnd").value;
    if (!a.trim() || !b.trim()) { setStatus("Type both a start and a destination address.", true); return; }
    if (state.busy) return;
    state.busy = true; ui.updateGoEnabled();
    try {
      setStatus("Looking up addresses…");
      const [start, end] = await Promise.all([api.geocode(a), api.geocode(b)]);
      // switch to A→B and use the geocoded points as waypoints
      setMode("ab");
      state.waypoints = [{ lat: start.lat, lng: start.lng }, { lat: end.lat, lng: end.lng }];
      ui.drawWaypoints();
      map.fitBounds([[start.lat, start.lng], [end.lat, end.lng]], { padding: [60, 60] });
      $("addrStart").value = start.label.split(",")[0];
      $("addrEnd").value = end.label.split(",")[0];
    } catch (err) {
      setStatus("Address lookup failed: " + err.message, true);
      state.busy = false; ui.updateGoEnabled();
      return;
    }
    state.busy = false; ui.updateGoEnabled();
    run();
  }

  /* ---------- suggest a gentler route within the detour budget ---------- */
  function suggest() {
    if (!state.routes.length) return;
    if (state.mode === "compare") {
      state.selected = state.recommended;
      ui.renderCompare();
      setStatus(`Showing the gentler trip (Trip ${state.recommended + 1}).`);
      return;
    }
    if (state.mode === "loop") {
      state.selected = state.recommended = state.selected === 0 ? 1 : 0;
      ui.render();
      setStatus("Showing the other direction around the loop.");
      return;
    }
    if (state.routes.length === 1) {
      setStatus("Only one walking route exists between these points — try moving them or widening the detour.", true);
      return;
    }
    const best = analysis.pickWithinDetour(state.routes, state.detour);
    state.recommended = state.selected = best;
    ui.render();
    const shortest = Math.min(...state.routes.map((r) => r.dist));
    const extra = Math.round(state.routes[best].dist - shortest);
    setStatus(`Gentlest route within +${Math.round(state.detour * 100)}% detour selected${extra > 5 ? ` (+${ui.fmtM(extra)})` : ``}.`);
  }

  /* ---------- mode switching ---------- */
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll("#modeSeg button").forEach((x) => x.classList.toggle("on", x.dataset.mode === mode));
    $("addrBlock").style.display = mode === "ab" ? "" : "none";
    const hints = {
      ab: `<b>Tap a start, then a destination</b> on the map — or type addresses below. I'll find the walking route(s) and pick the one with the least steep descent.`,
      loop: `<b>Tap points around the lake</b> (3 or more, roughly on the path). I'll route the loop and tell you which <b>direction</b> spares the knees.`,
      compare: `<b>Tap 4 points</b>: start &amp; destination of trip 1, then start &amp; destination of trip 2. I'll route both and show which is gentler on the knees.`,
    };
    $("modeHint").innerHTML = hints[mode] || hints.ab;
  }

  /* ---------- controls ---------- */
  $("go").onclick = run;
  $("suggest").onclick = suggest;
  $("addrGo").onclick = routeFromAddresses;
  $("addrStart").addEventListener("keydown", (e) => { if (e.key === "Enter") routeFromAddresses(); });
  $("addrEnd").addEventListener("keydown", (e) => { if (e.key === "Enter") routeFromAddresses(); });

  $("clear").onclick = () => {
    state.waypoints = []; ES.layers.marker.clearLayers(); ui.resetResults();
    setStatus("Cleared. Pick your points on the map."); ui.updateGoEnabled();
  };

  document.querySelectorAll("#modeSeg button").forEach((b) => {
    b.onclick = () => {
      setMode(b.dataset.mode);
      state.waypoints = []; ES.layers.marker.clearLayers(); ui.resetResults();
      setStatus(state.mode === "ab" ? "Pick a start and a destination." : "Tap points around the lake (3+).");
      ui.updateGoEnabled();
    };
  });

  $("thr").oninput = (e) => {
    state.thr = parseInt(e.target.value, 10) / 100;
    $("thrVal").textContent = e.target.value + "%";
    rescore();
  };

  $("detour").oninput = (e) => {
    state.detour = parseInt(e.target.value, 10) / 100;
    $("detourVal").textContent = e.target.value + "%";
    if (state.routes.length && state.mode === "ab") {
      state.recommended = analysis.pickWithinDetour(state.routes, state.detour);
      if (state.selected >= state.routes.length) state.selected = state.recommended;
      ui.render();
    }
  };

  // Re-score existing routes after a threshold change (no new network calls).
  function rescore() {
    if (!state.routes.length) return;
    if (state.mode === "compare") {
      state.routes = state.routes.map((rt) => analysis.analyse(rt.pts, rt.elev, state.thr));
      state.recommended = state.routes[0].kneeLoad <= state.routes[1].kneeLoad ? 0 : 1;
      ui.renderCompare();
      return;
    }
    if (state.mode === "loop") {
      const a = state.routes[0], b = state.routes[1];
      const f = analysis.analyse(a.pts, a.elev, state.thr), r = analysis.analyse(b.pts, b.elev, state.thr);
      state.routes = [f, r]; state.recommended = r.kneeLoad < f.kneeLoad ? 1 : 0;
    } else {
      state.routes = state.routes.map((rt) => analysis.analyse(rt.pts, rt.elev, state.thr));
      state.recommended = analysis.pickWithinDetour(state.routes, state.detour);
    }
    if (state.selected >= state.routes.length) state.selected = state.recommended;
    ui.render();
  }

  document.querySelectorAll("#jumps .chip").forEach((c) => {
    c.onclick = () => map.setView([parseFloat(c.dataset.lat), parseFloat(c.dataset.lng)], parseInt(c.dataset.z, 10));
  });

  /* ---------- suggested trips ---------- */
  function loadTrip(t) {
    if (state.busy) return;
    setMode(t.mode);
    state.waypoints = t.points.map((p) => ({ lat: p.lat, lng: p.lng }));
    ui.resetResults();
    ui.drawWaypoints();
    map.fitBounds(t.points.map((p) => [p.lat, p.lng]), { padding: [50, 50] });
    ui.updateGoEnabled();
    setStatus(`Loaded “${t.name}”. ${t.guide}`);
    run();
  }

  /* ---------- boot ---------- */
  ui.renderSuggestions(loadTrip);
  setMode("ab");
  ui.updateGoEnabled();
})();
