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

  /* ---------- home (saved exact address, locally) ---------- */
  const store = ES.store;
  function shortLabel(label) { return label ? label.split(",").slice(0, 3).join(",").trim() : ""; }
  function applyHome(h) {
    $("homeGo").disabled = !h;
    $("homeLabel").textContent = h ? shortLabel(h.label) : "";
    if (h && h.label && !$("homeInput").value) $("homeInput").value = shortLabel(h.label);
  }
  async function saveHome() {
    const q = $("homeInput").value.trim();
    if (!q) { setStatus("Type your home address first, then tap Save.", true); return; }
    try {
      setStatus("Finding your home address…");
      const p = await api.geocode(q, currentViewbox());
      const home = { lat: p.lat, lng: p.lng, label: p.label, zoom: 16 };
      store.setHome(home);
      applyHome(home);
      map.setView([home.lat, home.lng], 16);
      setStatus(`Saved home: ${shortLabel(home.label)}`);
    } catch (err) { setStatus("Couldn't find that address: " + err.message, true); }
  }
  function goHome() {
    const h = store.getHome();
    if (!h) { setStatus("No home saved yet — type your address and tap Save.", true); return; }
    if (state.busy) return;
    map.setView([h.lat, h.lng], h.zoom || 16);
    hideTripBanner();
    collapseSheet();
    addWaypoint({ lat: h.lat, lng: h.lng });
  }

  /* ---------- locale: hide Trondheim-only lists when away ---------- */
  const TRD = { lat: 63.413, lng: 10.38 };
  function refreshLocale() {
    const c = map.getCenter();
    const near = geo.haversine({ lat: c.lat, lng: c.lng }, TRD) < 40000; // 40 km
    $("jumpsBlock").style.display = near ? "" : "none";
    $("suggestBlock").style.display = near ? "" : "none";
  }
  map.on("moveend", refreshLocale);

  /* ---------- mobile bottom-sheet ---------- */
  function isMobile() { return window.matchMedia("(max-width:820px)").matches; }
  function expandSheet() { if (isMobile()) $("sidebar").classList.add("expanded"); }
  function collapseSheet() { $("sidebar").classList.remove("expanded"); }

  // apply saved home (else Trondheim default) before first paint of controls
  (function initView() {
    const h = store.getHome();
    if (h) map.setView([h.lat, h.lng], h.zoom || 16);
    applyHome(h);
    refreshLocale();
  })();

  /* ---------- waypoint flow ---------- */
  // tap a waypoint marker to remove it (fixes accidental taps)
  ES.onWaypointClick = (i) => {
    if (state.busy) return;
    state.waypoints.splice(i, 1);
    hideTripBanner();
    ui.resetResults();
    ui.drawWaypoints();
    ui.updateGoEnabled();
    setStatus(state.waypoints.length ? "Removed that point. Tap the map to add another." : "Cleared. Tap the map to begin.");
  };

  function addWaypoint(w) {
    if (state.mode === "ab") {
      if (state.routes.length) { state.waypoints = []; ui.resetResults(); }
      state.waypoints.push(w);
      setStatus(state.waypoints.length < 2 ? "Now tap your destination." : "Ready — tap “Route & analyse”, or tap again to add a stop along the way.");
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
  }

  map.on("click", (e) => {
    if (state.busy) return;
    hideTripBanner();
    collapseSheet();
    addWaypoint({ lat: e.latlng.lat, lng: e.latlng.lng });
  });

  /* ---------- routing pipeline ---------- */
  // Build & elevation-tag every geometry returned by the router.
  async function buildRoutes(geoms, quiet) {
    const built = [];
    for (const geom of geoms) {
      const total = geom.reduce((a, _, i) => (i ? a + geo.haversine(geom[i - 1], geom[i]) : 0), 0);
      const pts = geo.resample(geom, Math.max(config.sampleSpacing, total / config.maxRoutePoints), config.maxRoutePoints);
      if (!quiet) setStatus("Reading elevation…");
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
        ui.showModal(ui.compareSummary());
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
      if (state.mode === "loop") ui.showModal(ui.loopSummary());
      else expandSheet(); // surface the stats on mobile
      setStatus("Done. Green/blue is easy on the knees; red is the steep downhill to avoid.");
    } catch (err) {
      console.error(err);
      setStatus("Could not complete: " + err.message + ". Try again or move your points slightly.", true);
    } finally {
      state.busy = false; ui.updateGoEnabled();
    }
  }

  // current map view as a Nominatim viewbox (west,north,east,south)
  function currentViewbox() {
    const b = map.getBounds();
    return `${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`;
  }

  /* ---------- location: go to any town/city (global) ---------- */
  async function goToTown() {
    const q = $("townInput").value;
    if (!q.trim()) { setStatus("Type a town or city to go to.", true); return; }
    try {
      setStatus("Finding place…");
      const place = await api.geocode(q); // global search, no bias
      map.setView([place.lat, place.lng], 13);
      $("townInput").value = place.label.split(",").slice(0, 2).join(",").trim();
      setStatus(`Centred on ${place.label.split(",")[0]}. Tap the map or type addresses to plan a walk.`);
    } catch (err) {
      setStatus("Couldn't find that place: " + err.message, true);
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
      const vb = currentViewbox();
      const [start, end] = await Promise.all([api.geocode(a, vb), api.geocode(b, vb)]);
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
      setStatus("The router returned only one walking route here — it found no sufficiently distinct alternative. Other paths you see may be nearly the same length or not in the foot network.");
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
  $("floatGo").onclick = run;
  $("suggest").onclick = suggest;
  $("modalClose").onclick = ui.hideModal;
  $("modalOk").onclick = ui.hideModal;
  $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") ui.hideModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") ui.hideModal(); });
  $("addrGo").onclick = routeFromAddresses;
  $("addrStart").addEventListener("keydown", (e) => { if (e.key === "Enter") routeFromAddresses(); });
  $("addrEnd").addEventListener("keydown", (e) => { if (e.key === "Enter") routeFromAddresses(); });

  $("clear").onclick = () => {
    state.waypoints = []; state.editingId = null; ES.layers.marker.clearLayers(); ui.resetResults();
    hideTripBanner();
    setStatus("Cleared. Pick your points on the map."); ui.updateGoEnabled();
  };

  document.querySelectorAll("#modeSeg button").forEach((b) => {
    b.onclick = () => {
      setMode(b.dataset.mode);
      hideTripBanner();
      state.editingId = null;
      state.waypoints = []; ES.layers.marker.clearLayers(); ui.resetResults();
      setStatus(state.mode === "ab" ? "Pick a start and a destination." : "Tap points around the lake (3+).");
      ui.updateGoEnabled();
    };
  });

  $("thr").oninput = (e) => {
    const pct = parseInt(e.target.value, 10);
    state.thr = pct / 100;
    $("thrVal").textContent = pct + "%";
    describeThreshold(pct);
    rescore();
  };

  // Explain the steepness limit in plain terms: degrees, a "1 m drop every N m"
  // ratio, a relatable label, and a little slope glyph that matches the angle.
  function describeThreshold(pct) {
    const deg = (Math.atan(pct / 100) * 180 / Math.PI).toFixed(1);
    const run = Math.round(100 / pct);
    let word;
    if (pct <= 4) word = "a gentle slope";
    else if (pct <= 7) word = "a noticeable hill";
    else if (pct <= 10) word = "a steep ramp";
    else if (pct <= 13) word = "a steep hill";
    else word = "very steep — stair-like";
    $("thrExplain").innerHTML =
      `That's <b>≈${deg}°</b> — about a <b>1&nbsp;m drop every ${run}&nbsp;m</b>, like ${word}. ` +
      `Downhill steeper than this turns <b style="color:var(--g-down3)">orange/red</b>; anything gentler stays green. ` +
      `<i>Set it lower if your knees are sensitive — then more of the route is flagged.</i>`;
    // slope glyph: rises left-to-right as the limit steepens
    const H = 24, x0 = 3, x1 = 37, base = H - 3;
    const rise = Math.min(base - 2, (x1 - x0) * (pct / 100) * 2.2); // gently exaggerated for visibility
    const top = base - rise;
    const col = pct <= 7 ? "var(--g-flat)" : pct <= 10 ? "var(--g-down1)" : pct <= 13 ? "var(--g-down2)" : "var(--g-down3)";
    $("thrSlope").innerHTML =
      `<polygon points="${x0},${base} ${x1},${base} ${x1},${top.toFixed(1)}" fill="${col}" fill-opacity="0.18"/>` +
      `<line x1="${x0}" y1="${base}" x2="${x1}" y2="${top.toFixed(1)}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
  }

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

  /* ---------- suggested trips (geocoded live for accuracy) ---------- */
  const TRONDHEIM_VB = "10.20,63.46,10.60,63.36"; // west,north,east,south

  // Loop waypoints traced around a geocoded lake. We size and centre the ring
  // from the lake's bounding box (so it follows the real shoreline) and place
  // points just OUTSIDE the water (k>1) so the foot router snaps them onto the
  // perimeter path rather than across the lake. Falls back to a fixed radius if
  // no bounding box is available.
  function loopRing(place, n) {
    const k = 1.08;
    let cLat, cLng, halfLat, halfLng;
    if (place.bbox) {
      cLat = (place.bbox.south + place.bbox.north) / 2;
      cLng = (place.bbox.west + place.bbox.east) / 2;
      halfLat = (place.bbox.north - place.bbox.south) / 2 * k;
      halfLng = (place.bbox.east - place.bbox.west) / 2 * k;
    } else {
      cLat = place.lat; cLng = place.lng;
      const r = 300;
      halfLat = r / 111320;
      halfLng = r / (111320 * Math.cos(cLat * Math.PI / 180));
    }
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      pts.push({ lat: cLat + halfLat * Math.cos(a), lng: cLng + halfLng * Math.sin(a) });
    }
    return pts;
  }

  function showTripBanner(name) {
    $("tripBannerName").textContent = name;
    $("tripBanner").hidden = false;
  }
  function hideTripBanner() { $("tripBanner").hidden = true; }

  async function loadTrip(t) {
    if (state.busy) return;
    state.busy = true; state.editingId = null; ui.updateGoEnabled();
    showTripBanner(t.name);
    try {
      setStatus(`Loading “${t.name}”…`);
      if (t.waypoints && t.waypoints.length) {
        setMode(t.mode || "loop");
        state.waypoints = t.waypoints.map((p) => ({ lat: p.lat, lng: p.lng }));
      } else if (t.mode === "loop") {
        const place = await api.geocode(t.query, TRONDHEIM_VB);
        setMode("loop");
        state.waypoints = loopRing(place, 6);
      } else {
        const [from, to] = await Promise.all([
          api.geocode(t.from, TRONDHEIM_VB),
          api.geocode(t.to, TRONDHEIM_VB),
        ]);
        setMode("ab");
        state.waypoints = [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }];
      }
    } catch (err) {
      state.busy = false; ui.updateGoEnabled();
      hideTripBanner();
      setStatus(`Couldn't locate “${t.name}”: ${err.message}`, true);
      return;
    }
    ui.resetResults();
    ui.drawWaypoints();
    map.fitBounds(state.waypoints.map((p) => [p.lat, p.lng]), { padding: [60, 60] });
    state.busy = false; ui.updateGoEnabled();
    setStatus(`Loaded “${t.name}”. ${t.guide}`);
    run();
  }

  /* ---------- data-driven ratings for suggested trips ----------
   * Route + analyse each suggested loop once (in the background), measure the
   * gentler direction's steep-downhill metres at a reference threshold, and
   * cache it. renderSuggestions then colours/sorts by the real numbers instead
   * of my hand-set guesses. */
  const REF_THR = 0.08;
  function tripSig(t) { return (t.waypoints || []).map((p) => p.lat.toFixed(4) + "," + p.lng.toFixed(4)).join(";"); }

  async function tripMetrics(t) {
    if (!t.waypoints || !t.waypoints.length) return null;
    let wpts = t.waypoints.slice();
    if (t.mode !== "ab") wpts = wpts.concat([wpts[0]]);
    let geoms;
    try { geoms = await api.osrmRoute(wpts, t.mode === "ab"); }
    catch (e) { geoms = [wpts]; }
    const built = await buildRoutes(geoms, true);
    let best;
    if (t.mode === "ab") {
      const routes = built.map((x) => analysis.analyse(x.pts, x.elev, REF_THR));
      best = routes[analysis.pickWithinDetour(routes, 0.25)];
    } else {
      const b0 = built[0];
      const f = analysis.analyse(b0.pts, b0.elev, REF_THR);
      const rv = analysis.reverseSeries(b0.pts, b0.elev);
      const r = analysis.analyse(rv.pts, rv.elev, REF_THR);
      best = r.kneeLoad < f.kneeLoad ? r : f;
    }
    return { steepDown: best.steepDown, dist: best.dist, time: best.time, sig: tripSig(t) };
  }

  async function analyzeSuggestions() {
    if ($("suggestBlock").style.display === "none") return; // skip when away from Trondheim
    const metrics = store.getMetrics();
    for (const t of ES.trips.all) {
      const cached = metrics[t.id];
      if (cached && cached.sig === tripSig(t)) continue;     // already measured for these points
      try {
        const m = await tripMetrics(t);
        if (m) { metrics[t.id] = m; store.setMetrics(metrics); ui.renderSuggestions(loadTrip, metrics); }
      } catch (e) { /* leave the static rating for this one */ }
    }
  }

  /* ---------- my trips (saved locally) ---------- */
  function renderSaved() {
    const trips = store.getTrips();
    $("tripsBlock").style.display = trips.length ? "" : "none";
    ui.renderSavedTrips(trips, { onEdit: editTrip, onDelete: deleteSaved });
  }

  // Edit: load the trip's points & mode onto the map so they can be adjusted,
  // then re-calculated and re-saved (updating the same entry).
  function editTrip(t) {
    if (state.busy) return;
    setMode(t.mode);
    state.editingId = t.id;
    state.waypoints = (t.waypoints || []).map((p) => ({ lat: p.lat, lng: p.lng }));
    hideTripBanner();
    ui.resetResults();
    ui.drawWaypoints();
    ui.updateGoEnabled();
    if (state.waypoints.length) map.fitBounds(state.waypoints.map((p) => [p.lat, p.lng]), { padding: [60, 60] });
    collapseSheet();
    setStatus(`Editing “${t.name}” — drag-free: tap to add points, tap a point to remove. Then Route & analyse and Save route.`);
  }

  function deleteSaved(t) {
    if (!window.confirm(`Delete saved trip “${t.name}”?`)) return;
    store.deleteTrip(t.id);
    if (state.editingId === t.id) state.editingId = null;
    renderSaved();
    setStatus(`Deleted “${t.name}”.`);
  }

  // Save the currently-analysed route into My trips (new, or update if editing).
  function saveCurrentRoute() {
    if (!state.routes.length) { setStatus("Calculate a route first, then save it.", true); return; }
    const existing = state.editingId ? store.getTrips().find((t) => t.id === state.editingId) : null;
    const def = existing ? existing.name : `My ${state.mode === "ab" ? "A→B" : state.mode} route`;
    const name = (window.prompt("Name this route:", def) || "").trim();
    if (!name) return;
    const sel = state.routes[state.selected] || state.routes[0];
    const trip = {
      id: state.editingId || ("t" + Date.now()),
      name,
      mode: state.mode,
      waypoints: state.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
      path: (sel.pts || []).map((p) => ({ lat: p.lat, lng: p.lng })),
      stats: { dist: sel.dist, steepDown: sel.steepDown, ascent: sel.ascent, descent: sel.descent, time: sel.time, maxDown: sel.maxDown },
      createdAt: Date.now(),
    };
    if (state.editingId) store.updateTrip(state.editingId, trip); else store.addTrip(trip);
    state.editingId = null;
    renderSaved();
    setStatus(`Saved “${name}” to My trips.`);
  }

  function clearAllTrips() {
    const n = store.getTrips().length;
    if (!n) { setStatus("No saved trips to clear."); return; }
    if (!window.confirm(`Delete all ${n} saved trip${n > 1 ? "s" : ""}? This can't be undone.`)) return;
    store.saveTrips([]);
    state.editingId = null;
    renderSaved();
    setStatus("Cleared all saved trips.");
  }

  /* ---------- location, home, collapsibles, sheet ---------- */
  $("townGo").onclick = goToTown;
  $("townInput").addEventListener("keydown", (e) => { if (e.key === "Enter") goToTown(); });
  $("homeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") saveHome(); });
  $("homeGo").onclick = goHome;
  $("homeSet").onclick = saveHome;
  $("saveRoute").onclick = saveCurrentRoute;
  $("clearTrips").onclick = clearAllTrips;
  $("tripBannerClose").onclick = hideTripBanner;
  $("sheetHandle").onclick = () => $("sidebar").classList.toggle("expanded");
  document.querySelectorAll(".collapse-head").forEach((h) => {
    h.onclick = () => h.closest(".collapsible").classList.toggle("collapsed");
  });

  /* ---------- boot ---------- */
  ui.renderSuggestions(loadTrip, store.getMetrics());
  renderSaved();
  describeThreshold(parseInt($("thr").value, 10));
  setMode("ab");
  ui.updateGoEnabled();
  analyzeSuggestions(); // refine ratings/colours from real data in the background
})();
