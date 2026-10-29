/* EasyStride — app wiring: map init, waypoint flow, routing pipeline,
 * address entry, detour suggestions and control handlers. Loaded last. */
;(function () {
  "use strict";
  const ES = window.EasyStride;
  const { api, analysis, ui, geo, state, config, $, setStatus } = ES;

  /* ---------- map ---------- */
  const map = L.map("map", { zoomControl: true }).setView(config.center, config.zoom);
  // "Clean map": Kartverket's grey-tone map in Norway, on top of a greyed-out
  // OpenStreetMap for everywhere else (Kartverket tiles are transparent
  // outside Norway, so OSM shows through). Both are key-free; CARTO's
  // basemaps, used before, now serve "API key required" tiles.
  const clean = L.layerGroup([
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "tiles-muted", attribution: "&copy; OpenStreetMap contributors" }),
    L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png", {
      maxZoom: 19, maxNativeZoom: 18, attribution: "&copy; Kartverket" }),
  ]).addTo(map);
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    subdomains: "abc", maxZoom: 17, attribution: "&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap (CC-BY-SA)" });
  L.control.layers({ "Clean map": clean, "Topographic (contours)": topo }, null, { position: "topright" }).addTo(map);

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
    $("homeGo").style.display = h ? "" : "none";
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

  // Drop a waypoint at the device's current GPS position to start planning here.
  function waypointHere() {
    if (state.busy) return;
    if (!navigator.geolocation) { setStatus("Location isn't available on this device.", true); return; }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const w = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        hideTripBanner();
        collapseSheet();
        map.setView([w.lat, w.lng], 16);
        addWaypoint(w);
      },
      (err) => { setStatus("Couldn't get your location: " + err.message, true); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
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
      if (state.routes.length) ui.resetResults(); // a new point makes the old analysis stale
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
  // effective detour budget: unlimited when "avoid at almost any cost" is on
  function detourBudget() { return state.avoidAll ? Infinity : state.detour; }

  // Stair ways (OSM highway=steps) covering all candidate geometries, with a
  // small containment cache so repeat runs in the same area skip Overpass.
  let stairCache = null; // { s, w, n, e, ways, at }
  async function stairWaysFor(geoms) {
    let s = 90, w = 180, n = -90, e = -180;
    geoms.forEach((g) => g.forEach((p) => {
      s = Math.min(s, p.lat); n = Math.max(n, p.lat);
      w = Math.min(w, p.lng); e = Math.max(e, p.lng);
    }));
    const pad = 0.002; // ~200 m
    s -= pad; w -= pad; n += pad; e += pad;
    const c = stairCache;
    if (c && s >= c.s && w >= c.w && n <= c.n && e <= c.e && Date.now() - c.at < 10 * 60 * 1000) return c.ways;
    try {
      setStatus("Checking for stairs on the way…");
      const ways = await api.fetchStairs(s, w, n, e);
      stairCache = { s, w, n, e, ways, at: Date.now() };
      return ways;
    } catch (err) { return []; } // Overpass unavailable: analyse without stair data
  }

  // Build & elevation-tag every geometry returned by the router. All
  // candidates are resampled at ONE spacing and read from ONE elevation
  // source, so their grades are smoothed alike and stay comparable (longer
  // routes used to be sampled coarser, which made them look gentler).
  // `closed` marks a loop, whose profile wraps around at the start/finish.
  // Quiet mode (background suggestion scoring) skips the stairs lookup to
  // keep Overpass traffic down.
  async function buildRoutes(geoms, quiet, closed) {
    const stairWays = quiet ? [] : await stairWaysFor(geoms);
    const want = geoms.every(api.inNorway) ? "dtm" : "dem";
    const longest = Math.max(...geoms.map(geo.pathLength));
    const spacing = Math.max(config.sampleSpacing[want], longest / config.maxRoutePoints[want]);
    const ptsList = geoms.map((g) => geo.resample(g, spacing, Infinity));
    if (!quiet) setStatus(geoms.length > 1 ? `Reading elevation for ${geoms.length} routes…` : "Reading elevation…");
    const { source, elevs } = await api.fetchElevations(ptsList);
    return ptsList.map((pts, i) => {
      const step = pts.length > 1 ? pts[1].s - pts[0].s : spacing;
      return {
        pts,
        elev: analysis.cleanProfile(elevs[i], step, source, closed),
        stairs: analysis.stairsAlong(geoms[i], pts, stairWays),
        meta: { source, closed: !!closed },
      };
    });
  }

  // Extra A→B candidates: route through a via point pushed sideways from the
  // midpoint, one per side. This finds real detours (the far side of a hill,
  // the other bank of a stream) even when the router itself offers no
  // alternatives — which it often doesn't on the foot network.
  async function viaCandidates(a, b, have, quiet) {
    const d = geo.haversine(a, b);
    if (d < 500) return []; // too short for a detour to matter
    const br = geo.bearing(a, b);
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    // "avoid at almost any cost" searches wider: a second, farther via per side
    const fracs = state.avoidAll ? [0.18, 0.35] : [0.18];
    const out = [];
    for (const f of fracs) {
      for (const side of [90, -90]) {
        try {
          if (!quiet) setStatus("Looking for gentler detours…");
          const via = geo.offset(mid, br + side, d * f);
          const g = (await api.osrmRoute([a, via, b], false))[0];
          if (!have.concat(out).some((h) => geo.sameGeometry(h, g))) out.push(g);
        } catch (e) { /* no walkable path on that side — skip it */ }
      }
    }
    return out;
  }

  // All candidate geometries for one A→B pair: the router's alternatives plus
  // via-point detours, minus anything too long to ever fit the detour budget.
  async function abGeometries(a, b, quiet) {
    let geoms = await api.osrmRoute([a, b], true);
    geoms = geoms.concat(await viaCandidates(a, b, geoms, quiet));
    const budget = detourBudget();
    if (isFinite(budget)) {
      const lens = geoms.map(geo.pathLength);
      const cap = Math.min(...lens) * (1 + budget + 0.10);
      geoms = geoms.filter((g, i) => i === 0 || lens[i] <= cap); // keep the primary regardless
    }
    return geoms;
  }

  // When the router is down or rate-limiting we can still score the straight
  // line between the points, but that's not the walk (it may cross a lake or
  // a hillside), so the result is flagged and the user is told — never
  // presented as a normal "Done".
  const STRAIGHT_MSG = "Routing service unreachable — this is a straight-line estimate between your points, not the walking path, so the knee advice may be wrong. Try again in a moment.";
  function markStraight(built) { built.forEach((b) => { b.meta.straight = true; }); return built; }

  // route a single A→B pair and return its gentlest-within-detour option
  async function routePair(a, b) {
    let geoms, straight = false;
    try { geoms = await abGeometries(a, b); }
    catch (e) { geoms = [[a, b]]; straight = true; }
    let built = await buildRoutes(geoms);
    if (straight) built = markStraight(built);
    const routes = built.map((x) => analysis.analyse(x.pts, x.elev, state.thr, x.stairs, x.meta));
    return routes[analysis.pickWithinDetour(routes, detourBudget())];
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
        const straightCmp = state.routes.some((r) => r.meta.straight);
        setStatus(straightCmp ? STRAIGHT_MSG : "Done. Solid = shown trip, dashed = the other. Green/blue is easy on the knees; red is steep downhill.", straightCmp);
        return;
      }

      const wpts = state.mode === "loop" ? state.waypoints.concat([state.waypoints[0]]) : state.waypoints;
      setStatus("Finding walking route…");
      let geoms, straight = false;
      try {
        geoms = state.mode === "ab" && wpts.length === 2
          ? await abGeometries(wpts[0], wpts[1])          // alternatives + via detours
          : await api.osrmRoute(wpts, false);             // fixed via points: one geometry
      } catch (routeErr) {
        geoms = [wpts.slice()];
        straight = true;
      }
      let built = await buildRoutes(geoms, false, state.mode === "loop");
      if (straight) built = markStraight(built);
      state.searchedBudget = detourBudget();

      if (state.mode === "loop") {
        const b0 = built[0];
        const f = analysis.analyse(b0.pts, b0.elev, state.thr, b0.stairs, b0.meta);
        const r = analysis.reversed(f, state.thr);
        state.routes = [f, r];
        state.recommended = r.kneeLoad < f.kneeLoad ? 1 : 0;
      } else {
        state.routes = built.map((b) => analysis.analyse(b.pts, b.elev, state.thr, b.stairs, b.meta));
        state.recommended = analysis.pickWithinDetour(state.routes, detourBudget());
      }
      state.selected = state.recommended;
      ui.render();
      if (state.mode === "loop") ui.showModal(ui.loopSummary());
      else expandSheet(); // surface the stats on mobile
      setStatus(straight ? STRAIGHT_MSG : "Done. Green/blue is easy on the knees; red is the steep downhill to avoid.", straight);
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
      // the gentler route round a loop IS the recommended direction — never
      // flip to the harsher one here (the direction buttons preview that)
      if (state.selected !== state.recommended) {
        state.selected = state.recommended;
        ui.render();
        setStatus("Back on the recommended direction — the gentler way round.");
      } else {
        setStatus("You're already on the gentler direction. Tap “Other direction” below to preview the loop the other way round.");
      }
      return;
    }
    if (state.routes.length === 1) {
      setStatus(state.waypoints.length > 2
        ? "With stops along the way the route has to pass through each of them, so there's just this one. Remove the middle stops to let me look for gentler alternatives."
        : "Only one distinct walking route here — I also tried detours to either side and found nothing different within your budget. Widen the acceptable detour (or tick “avoid … at almost any cost”), then tap “Route & analyse” again to search further.");
      return;
    }
    const best = analysis.pickWithinDetour(state.routes, detourBudget());
    state.recommended = state.selected = best;
    ui.render();
    const shortest = Math.min(...state.routes.map((r) => r.dist));
    const extra = Math.round(state.routes[best].dist - shortest);
    setStatus(state.avoidAll
      ? `Gentlest route selected — detour cap off${extra > 5 ? ` (+${ui.fmtM(extra)})` : ``}.`
      : `Gentlest route within +${Math.round(state.detour * 100)}% detour selected${extra > 5 ? ` (+${ui.fmtM(extra)})` : ``}.`);
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
    store.setThreshold(pct);
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
      // the map follows the recommendation, so the card, badge and map agree
      state.recommended = state.selected = analysis.pickWithinDetour(state.routes, detourBudget());
      ui.render();
      // candidates longer than the old budget were never fetched
      if (detourBudget() > state.searchedBudget) {
        setStatus("Wider detour allowed — tap “Route & analyse” again to search for longer, gentler options.");
      }
    }
  };

  $("avoidAll").onchange = (e) => {
    state.avoidAll = e.target.checked;
    store.setAvoid(state.avoidAll);
    if (state.routes.length && state.mode === "ab") {
      state.recommended = state.selected = analysis.pickWithinDetour(state.routes, detourBudget());
      ui.render();
    }
    setStatus(state.avoidAll
      ? "Detour cap off — I'll pick the gentlest option however long. Re-run “Route & analyse” to also search wider for detours."
      : `Detour cap back on at +${Math.round(state.detour * 100)}%.`);
  };

  // Re-score existing routes after a threshold change (no new network calls).
  // The limit now changes which route/direction is gentlest, so the map
  // follows the new recommendation rather than keeping a stale pick.
  function rescore() {
    if (!state.routes.length) return;
    const again = (rt) => analysis.analyse(rt.pts, rt.elev, state.thr, rt.stairs, rt.meta);
    if (state.mode === "compare") {
      state.routes = state.routes.map(again);
      state.recommended = state.routes[0].kneeLoad <= state.routes[1].kneeLoad ? 0 : 1;
      ui.renderCompare();
      return;
    }
    state.routes = state.routes.map(again);
    state.recommended = state.mode === "loop"
      ? (state.routes[1].kneeLoad < state.routes[0].kneeLoad ? 1 : 0)
      : analysis.pickWithinDetour(state.routes, detourBudget());
    state.selected = state.recommended;
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
  // "v4" invalidates caches scored before the terrain-model / walked-distance
  // / threshold-aware scoring fixes (those numbers were wrong)
  function tripSig(t) { return "v4|" + (t.waypoints || []).map((p) => p.lat.toFixed(4) + "," + p.lng.toFixed(4)).join(";"); }

  async function tripMetrics(t) {
    if (!t.waypoints || !t.waypoints.length) return null;
    let wpts = t.waypoints.slice();
    if (t.mode !== "ab") wpts = wpts.concat([wpts[0]]);
    // no straight-line fallback here: a rating measured off a straight line
    // would be cached as if it were the walk — on failure, keep the curated
    // rating and measure again next visit
    const geoms = await api.osrmRoute(wpts, t.mode === "ab");
    const built = await buildRoutes(geoms, true, t.mode !== "ab");
    let best, dirSaved = 0;
    if (t.mode === "ab") {
      const routes = built.map((x) => analysis.analyse(x.pts, x.elev, REF_THR, null, x.meta));
      best = routes[analysis.pickWithinDetour(routes, 0.25)];
    } else {
      const b0 = built[0];
      const f = analysis.analyse(b0.pts, b0.elev, REF_THR, null, b0.meta);
      const r = analysis.reversed(f, REF_THR);
      best = r.kneeLoad < f.kneeLoad ? r : f;
      const worse = best === r ? f : r;
      dirSaved = Math.max(0, Math.round(worse.steepDown - best.steepDown));
    }
    return { steepDown: best.steepDown, dist: best.dist, time: best.time, dirSaved, sig: tripSig(t) };
  }

  async function analyzeSuggestions() {
    if ($("suggestBlock").style.display === "none") return; // skip when away from Trondheim
    const metrics = store.getMetrics();
    for (const t of ES.trips.all) {
      const cached = metrics[t.id];
      if (cached && cached.sig === tripSig(t)) continue;     // already measured for these points
      // background work yields to the user: don't compete with (and get the
      // user's own request rate-limited by) a route they just asked for
      while (state.busy) await new Promise((res) => setTimeout(res, 500));
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
  $("locHere").onclick = waypointHere;
  $("floatLoc").onclick = waypointHere;
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
  // restore the steepness limit saved on a previous visit (else the HTML default)
  (function restoreThreshold() {
    const pct = store.getThreshold(parseInt($("thr").value, 10));
    $("thr").value = pct;
    state.thr = pct / 100;
    $("thrVal").textContent = pct + "%";
    describeThreshold(pct);
  })();
  // restore the "avoid at almost any cost" toggle
  state.avoidAll = store.getAvoid();
  $("avoidAll").checked = state.avoidAll;
  setMode("ab");
  ui.updateGoEnabled();
  analyzeSuggestions(); // refine ratings/colours from real data in the background
})();
