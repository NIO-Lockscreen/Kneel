/* EasyStride — everything that touches the DOM / Leaflet layers:
 * colours, formatting, route drawing, elevation profile, stats, recommendation. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});
  const $ = ES.$;

  // ---- colours ----
  const _cssCache = {};
  function getCss(v) {
    return _cssCache[v] || (_cssCache[v] = getComputedStyle(document.documentElement).getPropertyValue(v).trim());
  }
  function gradeColor(g, thr) {
    if (g >= 0.02) return getCss("--g-up");        // uphill — fine
    if (g > -0.025) return getCss("--g-flat");     // flat — fine
    const down = -g;
    if (down < thr) return getCss("--g-flat");        // downhill gentler than your limit — fine
    if (down < thr * 1.5) return getCss("--g-down2"); // over your limit — watch it
    return getCss("--g-down3");                        // well over — sore
  }

  // ---- formatting ----
  function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 2) + " km" : Math.round(m) + " m"; }
  function fmtTime(s) { const m = Math.round(s / 60); return m >= 60 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : m + " min"; }

  // ---- map: coloured route + start/direction decorations ----
  function drawRoute(route) {
    const { route: routeLayer, deco: decoLayer } = ES.layers;
    routeLayer.clearLayers(); decoLayer.clearLayers();
    const p = route.pts;
    for (let i = 0; i < p.length - 1; i++) {
      L.polyline([[p[i].lat, p[i].lng], [p[i + 1].lat, p[i + 1].lng]],
        { color: gradeColor(route.grades[i], ES.state.thr), weight: 6, opacity: .95, lineCap: "round" }).addTo(routeLayer);
    }
    L.marker([p[0].lat, p[0].lng], { icon: L.divIcon({ className: "", html: '<div class="start-ico"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(decoLayer);
    const ai = Math.min(p.length - 2, Math.max(1, Math.round(p.length * 0.18)));
    // bearing is compass degrees (0=N); the ➤ glyph points east at 0°, so offset by −90°
    const ang = ES.geo.bearing(p[ai - 1], p[ai + 1]) - 90;
    L.marker([p[ai].lat, p[ai].lng], { icon: L.divIcon({ className: "",
      html: `<div class="arrow-ico" style="transform:rotate(${ang}deg)">➤</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(decoLayer);
  }

  // ---- elevation profile (SVG) ----
  function drawProfile(route) {
    const svg = $("prof"); svg.innerHTML = "";
    const W = 360, H = 130, padL = 4, padR = 4, padT = 10, padB = 14;
    const cum = route.cum, elev = route.elev;
    const minE = Math.min(...elev), maxE = Math.max(...elev), span = Math.max(6, maxE - minE);
    const total = cum[cum.length - 1] || 1;
    const X = (d) => padL + (d / total) * (W - padL - padR);
    const Y = (e) => padT + (1 - (e - minE) / span) * (H - padT - padB);
    const NS = "http://www.w3.org/2000/svg";
    let dpath = `M ${X(0)} ${H - padB}`;
    for (let i = 0; i < cum.length; i++) dpath += ` L ${X(cum[i]).toFixed(1)} ${Y(elev[i]).toFixed(1)}`;
    dpath += ` L ${X(total)} ${H - padB} Z`;
    const area = document.createElementNS(NS, "path");
    area.setAttribute("d", dpath); area.setAttribute("fill", "rgba(47,111,126,.10)"); svg.appendChild(area);
    for (let i = 0; i < cum.length - 1; i++) {
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", X(cum[i])); ln.setAttribute("y1", Y(elev[i]));
      ln.setAttribute("x2", X(cum[i + 1])); ln.setAttribute("y2", Y(elev[i + 1]));
      ln.setAttribute("stroke", gradeColor(route.grades[i], ES.state.thr));
      ln.setAttribute("stroke-width", "3"); ln.setAttribute("stroke-linecap", "round"); svg.appendChild(ln);
    }
    const label = (x, y, anchor, txt) => {
      const t = document.createElementNS(NS, "text"); t.setAttribute("class", "axis");
      t.setAttribute("x", x); t.setAttribute("y", y); if (anchor) t.setAttribute("text-anchor", anchor);
      t.textContent = txt; svg.appendChild(t);
    };
    label(padL + 1, H - 3, null, "start");
    label(W - padR - 1, H - 3, "end", fmtM(total));
    label(padL + 1, padT + 2, null, Math.round(maxE) + " m");
    label(padL + 1, H - padB - 1, null, Math.round(minE) + " m");
    $("profile").classList.add("show");
  }

  function fillStats(route) {
    $("stats").classList.add("show");
    $("sSteep").textContent = Math.round(route.steepDown) + " m";
    $("sDist").textContent = fmtM(route.dist);
    $("sUp").textContent = Math.round(route.ascent) + " m";
    $("sDown").textContent = Math.round(route.descent) + " m";
    $("sTime").textContent = fmtTime(route.time);
    $("sMax").textContent = (route.maxDown * 100).toFixed(0) + "%";
  }

  function showReco() {
    const reco = $("reco"), verdict = $("verdict"), delta = $("delta");
    const sw = $("switch"); sw.innerHTML = ""; sw.style.display = "none";
    const routes = ES.state.routes, best = ES.state.recommended;

    if (ES.state.mode === "loop") {
      const chosen = routes[best], other = routes[best === 0 ? 1 : 0];
      const saved = Math.round(other.steepDown - chosen.steepDown);
      verdict.innerHTML = saved > 3
        ? `Follow the <span class="arrow">➤</span> <b>recommended direction</b> around the loop.`
        : `This loop is gentle <b>either direction</b>.`;
      delta.innerHTML =
        `Recommended direction · steep downhill <b>${Math.round(chosen.steepDown)} m</b><br>` +
        `Reverse direction · steep downhill <b>${Math.round(other.steepDown)} m</b>` +
        (saved > 3 ? `<br>→ the recommended way takes the steep side <b>uphill</b>, saving <b>${saved} m</b> of jarring descent. Same loop and same points — just follow the arrow.` : ``);
      reco.classList.add("show");
    } else {
      const chosen = routes[best];
      const shortest = Math.min(...routes.map((r) => r.dist));
      const extra = Math.round(chosen.dist - shortest);
      verdict.innerHTML = routes.length > 1
        ? `Gentlest of ${routes.length} routes selected${extra > 5 ? ` (+${fmtM(extra)} detour)` : ``}.`
        : `Route analysed.`;
      delta.innerHTML = `Steep downhill on this route: <b>${Math.round(chosen.steepDown)} m</b> of trail steeper than ${Math.round(ES.state.thr * 100)}%.`;
      reco.classList.add("show");
      if (routes.length > 1) {
        sw.style.display = "flex";
        routes.forEach((rt, i) => {
          const div = document.createElement("div");
          div.className = "opt" + (i === ES.state.selected ? " sel" : "");
          div.innerHTML = `<span>Route ${i + 1} · ${fmtM(rt.dist)}` +
            (i === best ? `<span class="best">gentlest</span>` : ``) + `</span>` +
            `<span class="m">${Math.round(rt.steepDown)} m steep ↓</span>`;
          div.onclick = () => { ES.state.selected = i; render(); };
          sw.appendChild(div);
        });
      }
    }
  }

  function drawWaypoints() {
    ES.layers.marker.clearLayers();
    const cmp = ["A1", "B1", "A2", "B2"];
    ES.state.waypoints.forEach((w, i) => {
      let html;
      if (ES.state.mode === "loop") html = `<div class="num-ico">${i + 1}</div>`;
      else if (ES.state.mode === "compare") html = `<div class="num-ico${i >= 2 ? " t2" : ""}">${cmp[i] || i + 1}</div>`;
      else html = `<div class="num-ico">${i < 26 ? String.fromCharCode(65 + i) : i + 1}</div>`;
      const m = L.marker([w.lat, w.lng], { icon: L.divIcon({ className: "", html, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000, title: "Tap to remove this point" }).addTo(ES.layers.marker);
      m.on("click", (e) => { L.DomEvent.stop(e); if (ES.onWaypointClick) ES.onWaypointClick(i); });
    });
  }

  function render() {
    const route = ES.state.routes[ES.state.selected];
    drawRoute(route); drawProfile(route); fillStats(route); showReco();
    drawWaypoints();
  }

  // ---- compare mode: two independent A→B trips ----
  function drawCompare() {
    const { route: routeLayer, deco: decoLayer } = ES.layers;
    routeLayer.clearLayers(); decoLayer.clearLayers();
    const routes = ES.state.routes, focus = ES.state.selected;
    // the other trip first, underneath, as a faded dashed line
    routes.forEach((rt, idx) => {
      if (idx === focus) return;
      L.polyline(rt.pts.map((p) => [p.lat, p.lng]),
        { color: "#7a8a80", weight: 4, opacity: .55, dashArray: "4 6", lineCap: "round" }).addTo(routeLayer);
    });
    // focused trip on top, grade-coloured
    const p = routes[focus].pts, grades = routes[focus].grades;
    for (let i = 0; i < p.length - 1; i++) {
      L.polyline([[p[i].lat, p[i].lng], [p[i + 1].lat, p[i + 1].lng]],
        { color: gradeColor(grades[i], ES.state.thr), weight: 6, opacity: .95, lineCap: "round" }).addTo(routeLayer);
    }
    L.marker([p[0].lat, p[0].lng], { icon: L.divIcon({ className: "", html: '<div class="start-ico"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(decoLayer);
  }

  function cmpRow(label, fmt, a, b, lowerKey) {
    const aw = lowerKey && a[lowerKey] < b[lowerKey];
    const bw = lowerKey && b[lowerKey] < a[lowerKey];
    return `<tr><td>${label}</td>` +
      `<td class="num${aw ? " win" : ""}">${fmt(a)}</td>` +
      `<td class="num${bw ? " win" : ""}">${fmt(b)}</td></tr>`;
  }

  function showCompareReco() {
    const routes = ES.state.routes;
    if (routes.length < 2) return;
    const a = routes[0], b = routes[1];
    const gentler = a.kneeLoad <= b.kneeLoad ? 0 : 1;
    const dSteep = Math.round(Math.abs(a.steepDown - b.steepDown));
    const verdict = dSteep > 5
      ? `Trip ${gentler + 1} is gentler on the knees — <b>${dSteep} m</b> less steep downhill.`
      : `Both trips are similarly gentle on the knees.`;
    const body = $("compareBody");
    body.innerHTML =
      `<div class="cmp-verdict">${verdict}</div>` +
      `<table class="cmp-table"><thead><tr><th></th><th>Trip 1</th><th>Trip 2</th></tr></thead><tbody>` +
      cmpRow("Steep downhill", (r) => Math.round(r.steepDown) + " m", a, b, "steepDown") +
      cmpRow("Distance", (r) => fmtM(r.dist), a, b, null) +
      cmpRow("Total climb ↑", (r) => Math.round(r.ascent) + " m", a, b, null) +
      cmpRow("Total descent ↓", (r) => Math.round(r.descent) + " m", a, b, "descent") +
      cmpRow("Est. time", (r) => fmtTime(r.time), a, b, null) +
      cmpRow("Max down grade", (r) => (r.maxDown * 100).toFixed(0) + "%", a, b, "maxDown") +
      `</tbody></table>` +
      `<div class="cmp-focus">` +
      `<button class="btn${ES.state.selected === 0 ? " on" : ""}" data-focus="0">Show Trip 1</button>` +
      `<button class="btn${ES.state.selected === 1 ? " on" : ""}" data-focus="1">Show Trip 2</button>` +
      `</div>` +
      `<div class="hint" style="margin-top:8px">Solid coloured line = shown trip · dashed grey = the other.</div>`;
    body.querySelectorAll(".cmp-focus button").forEach((btn) => {
      btn.onclick = () => { ES.state.selected = parseInt(btn.dataset.focus, 10); renderCompare(); };
    });
    $("compare").classList.add("show");
  }

  function renderCompare() {
    drawCompare();
    drawProfile(ES.state.routes[ES.state.selected]);
    drawWaypoints();
    showCompareReco();
  }

  // ---- suggested trips list ----
  function ratingColor(r) { return getCss(r === "friendly" ? "--g-flat" : r === "moderate" ? "--g-down1" : "--g-down3"); }
  function ratingLabel(r) { return r === "friendly" ? "Knee-friendly" : r === "moderate" ? "Moderate" : "Avoid ↓"; }
  // Derive the rating from measured steep-downhill metres when we have them, so
  // colour/label/order always agree with the analysis; fall back to the static
  // hint until the metric has been computed.
  function tripRating(t, metrics) {
    const m = metrics && metrics[t.id];
    if (m && typeof m.steepDown === "number") {
      return m.steepDown < 50 ? "friendly" : m.steepDown < 150 ? "moderate" : "avoid";
    }
    return t.rating || "moderate";
  }
  function renderSuggestions(onSelect, metrics) {
    const wrap = $("suggestions");
    if (!wrap || !ES.trips) return;
    metrics = metrics || {};
    const list = ES.trips.all.slice().sort((a, b) => {
      const ma = metrics[a.id], mb = metrics[b.id];
      if (ma && mb) return ma.steepDown - mb.steepDown;   // least steep downhill first
      if (ma) return -1; if (mb) return 1;
      return ES.trips.RANK[a.rating] - ES.trips.RANK[b.rating];
    });
    wrap.innerHTML = "";
    list.forEach((t) => {
      const m = metrics[t.id];
      const rating = tripRating(t, metrics);
      const col = ratingColor(rating);
      const distLabel = m ? fmtM(m.dist) : t.dist;
      const steepLabel = m ? `${Math.round(m.steepDown)} m steep ↓` : (t.mode === "loop" ? "loop" : "A→B");
      const div = document.createElement("div");
      div.className = "trip trip-" + rating;
      div.style.setProperty("--trip", col);
      div.innerHTML =
        `<div class="trip-head"><span class="trip-name">${t.name}</span>` +
        `<span class="trip-badge" style="background:${col}">${ratingLabel(rating)}</span></div>` +
        `<div class="trip-meta">${t.area} · ${distLabel} · ${steepLabel}</div>` +
        `<div class="trip-guide">${t.guide}</div>`;
      div.onclick = () => onSelect(t);
      wrap.appendChild(div);
    });
  }

  // ---- saved trips list ----
  function renderSavedTrips(trips, handlers) {
    const wrap = $("savedTrips");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!trips.length) {
      wrap.innerHTML = `<div class="hint">No saved trips yet. Plan a route, then tap <b>Save route ★</b>.</div>`;
      return;
    }
    trips.forEach((t) => {
      const st = t.stats || {};
      const bits = [t.mode === "loop" ? "loop" : t.mode === "compare" ? "compare" : "A→B"];
      if (st.dist != null) bits.push(fmtM(st.dist));
      if (st.time != null) bits.push(fmtTime(st.time));
      const div = document.createElement("div");
      div.className = "saved";
      div.innerHTML =
        `<div class="saved-main">` +
        `<div class="saved-name">${t.name}</div>` +
        `<div class="saved-meta">${bits.join(" · ")}</div></div>` +
        `<div class="saved-acts">` +
        `<button class="btn" data-act="edit">Edit</button>` +
        `<button class="btn ghost" data-act="del" aria-label="Delete">✕</button></div>`;
      div.querySelector('[data-act="edit"]').onclick = () => handlers.onEdit(t);
      div.querySelector('[data-act="del"]').onclick = () => handlers.onDelete(t);
      wrap.appendChild(div);
    });
  }

  function resetResults() {
    ES.state.routes = []; ES.state.selected = 0; ES.state.recommended = 0;
    ES.layers.route.clearLayers(); ES.layers.deco.clearLayers();
    $("reco").classList.remove("show");
    $("compare").classList.remove("show");
    $("stats").classList.remove("show");
    $("profile").classList.remove("show");
    $("switch").style.display = "none";
  }

  function updateGoEnabled() {
    const n = ES.state.waypoints.length;
    const ready = ES.state.mode === "compare" ? n >= 4 : ES.state.mode === "ab" ? n >= 2 : n >= 3;
    $("go").disabled = !ready || ES.state.busy;
    const sg = $("suggest"); if (sg) sg.disabled = ES.state.busy || !ES.state.routes.length;
    const sr = $("saveRoute"); if (sr) sr.disabled = ES.state.busy || !ES.state.routes.length;
    const fg = $("floatGo");
    if (fg) fg.classList.toggle("show", ready && !ES.state.busy && !ES.state.routes.length);
  }

  // ---- results modal ----
  function showModal(html) { $("modalBody").innerHTML = html; $("modal").hidden = false; }
  function hideModal() { $("modal").hidden = true; }

  function loopSummary() {
    const routes = ES.state.routes, best = ES.state.recommended;
    const chosen = routes[best], other = routes[best === 0 ? 1 : 0];
    const saved = Math.round(other.steepDown - chosen.steepDown);
    const gentleEither = saved <= 3;
    const title = gentleEither ? "This loop is gentle either direction" : "Recommended walking direction";
    const lead = gentleEither
      ? `It's about the same both ways here, so walk it whichever direction you prefer — your points and the path don't change.`
      : `The <b>recommended direction</b> (shown by the arrow on the map) is gentler than the reverse — about <b>${saved} m</b> less steep downhill, because it takes the steep side <b>uphill</b>. You still walk the same loop through the same numbered points; only the direction of travel changes.`;
    const rows =
      `<tr><td>Steep downhill · recommended</td><td class="num win">${Math.round(chosen.steepDown)} m</td></tr>` +
      `<tr><td>Steep downhill · reverse</td><td class="num">${Math.round(other.steepDown)} m</td></tr>` +
      `<tr><td>Distance</td><td class="num">${fmtM(chosen.dist)}</td></tr>` +
      `<tr><td>Est. time</td><td class="num">${fmtTime(chosen.time)}</td></tr>` +
      `<tr><td>Total descent ↓</td><td class="num">${Math.round(chosen.descent)} m</td></tr>` +
      `<tr><td>Max down grade</td><td class="num">${(chosen.maxDown * 100).toFixed(0)}%</td></tr>`;
    return `<div class="modal-title">${title}</div><div class="modal-lead">${lead}</div>` +
      `<table class="cmp-table"><tbody>${rows}</tbody></table>`;
  }

  function compareSummary() {
    const [a, b] = ES.state.routes;
    const gentler = a.kneeLoad <= b.kneeLoad ? 0 : 1;
    const faster = a.time <= b.time ? 0 : 1;
    const dSteep = Math.round(Math.abs(a.steepDown - b.steepDown));
    const dMin = Math.round(Math.abs(a.time - b.time) / 60);
    let lead;
    if (gentler === faster) {
      lead = `<b>Trip ${gentler + 1}</b> wins on both counts — it's gentler on the knees${dSteep > 5 ? ` (${dSteep} m less steep downhill)` : ``} and the quicker walk${dMin >= 1 ? ` by ${dMin} min` : ``}.`;
    } else if (dSteep <= 5) {
      lead = `The two are about equally kind to the knees, so go with <b>Trip ${faster + 1}</b> — it's faster${dMin >= 1 ? ` by ${dMin} min` : ``}.`;
    } else {
      lead = `<b>Trip ${faster + 1}</b> is faster${dMin >= 1 ? ` by ${dMin} min` : ``}, but <b>Trip ${gentler + 1}</b> is gentler on the knees — ${dSteep} m less steep downhill. For sore knees, take Trip ${gentler + 1}.`;
    }
    const cell = (lower, val) => `<td class="num${lower ? " win" : ""}">${val}</td>`;
    const rows =
      `<tr><td>Steep downhill</td>${cell(a.steepDown < b.steepDown, Math.round(a.steepDown) + " m")}${cell(b.steepDown < a.steepDown, Math.round(b.steepDown) + " m")}</tr>` +
      `<tr><td>Distance</td>${cell(false, fmtM(a.dist))}${cell(false, fmtM(b.dist))}</tr>` +
      `<tr><td>Est. time</td>${cell(a.time < b.time, fmtTime(a.time))}${cell(b.time < a.time, fmtTime(b.time))}</tr>` +
      `<tr><td>Total descent ↓</td>${cell(a.descent < b.descent, Math.round(a.descent) + " m")}${cell(b.descent < a.descent, Math.round(b.descent) + " m")}</tr>`;
    return `<div class="modal-title">EasyStride recommends Trip ${gentler + 1}</div>` +
      `<div class="modal-lead">${lead}</div>` +
      `<table class="cmp-table"><thead><tr><th></th><th>Trip 1</th><th>Trip 2</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  ES.ui = { gradeColor, fmtM, fmtTime, drawRoute, drawProfile, fillStats, showReco, drawWaypoints, render, renderCompare, renderSuggestions, renderSavedTrips, resetResults, updateGoEnabled, showModal, hideModal, loopSummary, compareSummary };
})();
