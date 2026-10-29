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

  function pct(g) { return (g * 100).toFixed(0) + "%"; }

  // is segment i descending stairs? (drawn dashed red — the worst for knees).
  // Uses the scorer's own verdict so the map shows exactly what was counted.
  function isDownStairs(route, i) {
    return !!(route.downStairs && route.downStairs[i]);
  }

  // Loads within 15% (+2) of each other count as "about the same".
  function similarLoad(a, b) {
    return Math.max(a.kneeLoad, b.kneeLoad) <= Math.min(a.kneeLoad, b.kneeLoad) * 1.15 + 2;
  }

  // Why `chosen` (the lower knee load) beats `other`, in words that agree
  // with the steep-downhill numbers printed next to it. Knee load weighs HOW
  // steep each descent is, so occasionally the gentler pick has MORE metres
  // over the limit than the alternative — then say what actually decides it
  // instead of claiming a saving that isn't there.
  function whyGentler(chosen, other) {
    const saved = Math.round(other.steepDown - chosen.steepDown);
    if (saved > 3) return { saved, text: `saving <b>${saved} m</b> of steep descent` };
    if (saved < -3) {
      const worse = other.maxDown > chosen.maxDown + 0.01 ? ` (up to ${pct(other.maxDown)} vs ${pct(chosen.maxDown)})` : ``;
      return { saved, text: `the alternative has ${-saved} m less trail over your limit, but what it has is much steeper${worse}, which is harder on the knees` };
    }
    return { saved, text: `less of the descent is near or over your limit` };
  }

  // Does walking a loop one way round really matter? Yes when the knee load
  // clearly differs, or one way has clearly more steep downhill.
  function directionMatters(chosen, other) {
    return !similarLoad(chosen, other) || other.steepDown - chosen.steepDown > 10;
  }

  // When it doesn't, the two ways can still differ in kind — say so, so the
  // "either way" verdict doesn't sit next to very different numbers unexplained.
  function tradeOffNote(chosen, other) {
    const d = Math.round(chosen.steepDown - other.steepDown);
    if (d <= 10) return "";
    const peak = other.maxDown > chosen.maxDown + 0.01 ? ` (up to ${pct(other.maxDown)} vs ${pct(chosen.maxDown)})` : ``;
    return `It's a trade-off: the reverse has ${d} m less trail over your limit, but steeper descents${peak}.`;
  }

  // ---- map: coloured route + start/direction decorations ----
  function drawRoute(route) {
    const { route: routeLayer, deco: decoLayer } = ES.layers;
    routeLayer.clearLayers(); decoLayer.clearLayers();
    const p = route.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const stair = isDownStairs(route, i);
      L.polyline([[p[i].lat, p[i].lng], [p[i + 1].lat, p[i + 1].lng]],
        { color: stair ? getCss("--g-down3") : gradeColor(route.grades[i], ES.state.thr),
          weight: 6, opacity: .95, lineCap: "round", dashArray: stair ? "3 8" : null }).addTo(routeLayer);
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
      const stair = isDownStairs(route, i);
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", X(cum[i])); ln.setAttribute("y1", Y(elev[i]));
      ln.setAttribute("x2", X(cum[i + 1])); ln.setAttribute("y2", Y(elev[i + 1]));
      ln.setAttribute("stroke", stair ? getCss("--g-down3") : gradeColor(route.grades[i], ES.state.thr));
      if (stair) ln.setAttribute("stroke-dasharray", "3 4");
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
      const meaningful = directionMatters(chosen, other);
      const why = whyGentler(chosen, other);
      verdict.innerHTML = meaningful
        ? `Follow the <span class="arrow">➤</span> <b>recommended direction</b> around the loop.`
        : `This loop is about as gentle <b>either direction</b>.`;
      delta.innerHTML =
        `Recommended direction · steep downhill <b>${Math.round(chosen.steepDown)} m</b><br>` +
        `Reverse direction · steep downhill <b>${Math.round(other.steepDown)} m</b>` +
        (chosen.stairsDown > 5 ? `<br>Includes <b style="color:var(--g-down3)">~${Math.round(chosen.stairsDown)} m of descending stairs</b> (dashed red).` : ``) +
        (meaningful
          ? `<br>→ the recommended way takes the steeper side <b>uphill</b>: ${why.text}. Same loop and same points — just follow the arrow.`
          : (tradeOffNote(chosen, other) ? `<br>→ ${tradeOffNote(chosen, other)}` : ``)) +
        (ES.state.selected !== best
          ? `<br>⟲ The map is showing the <b>other direction</b> — colours and arrow are for walking it that way.`
          : ``);
      // direction switcher: preview the loop the other way round
      sw.style.display = "flex";
      [best, best === 0 ? 1 : 0].forEach((idx) => {
        const rt = routes[idx];
        const div = document.createElement("div");
        div.className = "opt" + (idx === ES.state.selected ? " sel" : "");
        div.innerHTML = `<span>${idx === best ? "Recommended direction ➤" : "Other direction ⟲"}` +
          (idx === best ? `<span class="best">gentlest</span>` : ``) + `</span>` +
          `<span class="m">${Math.round(rt.steepDown)} m steep ↓ · max ${pct(rt.maxDown)}</span>`;
        div.onclick = () => { ES.state.selected = idx; render(); };
        sw.appendChild(div);
      });
      reco.classList.add("show");
    } else {
      // the card describes the route ON THE MAP (and stats), which is the
      // recommendation unless the user tapped another option
      const sel = ES.state.selected, shown = routes[sel] || routes[best];
      const shortest = Math.min(...routes.map((r) => r.dist));
      const extra = Math.round(routes[best].dist - shortest);
      verdict.innerHTML = routes.length < 2 ? `Route analysed.`
        : sel === best ? `Gentlest of ${routes.length} routes selected${extra > 5 ? ` (+${fmtM(extra)} detour)` : ``}.`
        : `Showing Route ${sel + 1} — <b>Route ${best + 1}</b> is the gentlest within your detour.`;
      let tip = "";
      if (ES.state.mode === "ab" && ES.state.waypoints.length === 2) {
        // would the same walk be kinder the other way round?
        const rev = ES.analysis.reversed(shown, ES.state.thr);
        const savedRev = Math.round(shown.steepDown - rev.steepDown);
        if (rev.kneeLoad < shown.kneeLoad * 0.8 - 2 && savedRev > 5) {
          tip = `<br>💡 Walking this route <b>the other way (B → A)</b> would cut the steep downhill by <b>${savedRev} m</b> — the climbs and descents swap. Worth considering if you can start from the other end (e.g. bus one way).`;
        }
      }
      const stairNote = shown.stairsDown > 5
        ? ` Includes <b style="color:var(--g-down3)">~${Math.round(shown.stairsDown)} m of descending stairs</b> (dashed red) — the hardest thing for sore knees.`
        : ``;
      delta.innerHTML = `Steep downhill on this route: <b>${Math.round(shown.steepDown)} m</b> of trail steeper than ${Math.round(ES.state.thr * 100)}%.` + stairNote + tip;
      reco.classList.add("show");
      if (routes.length > 1) {
        sw.style.display = "flex";
        routes.forEach((rt, i) => {
          const div = document.createElement("div");
          const extraI = Math.round(rt.dist - shortest);
          div.className = "opt" + (i === ES.state.selected ? " sel" : "");
          div.innerHTML = `<span>Route ${i + 1} · ${fmtM(rt.dist)}${extraI > 5 ? ` (+${fmtM(extraI)})` : ``}` +
            (i === best ? `<span class="best">gentlest</span>` : ``) + `</span>` +
            `<span class="m">${Math.round(rt.steepDown)} m steep ↓ · max ${pct(rt.maxDown)}</span>`;
          div.onclick = () => { ES.state.selected = i; render(); };
          sw.appendChild(div);
        });
      }
    }
    if (routes.some(isStraight)) delta.innerHTML = STRAIGHT_WARN + delta.innerHTML;
  }

  // routes scored off a straight line because routing failed (see app.js)
  function isStraight(r) { return !!(r && r.meta && r.meta.straight); }
  const STRAIGHT_WARN = `<b style="color:var(--g-down3)">⚠ Straight-line estimate — the routing service didn't answer, so this isn't the real walking path. Try again in a moment.</b><br>`;

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
    // focused trip on top, grade-coloured (descending stairs dashed red)
    const rt = routes[focus], p = rt.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const stair = isDownStairs(rt, i);
      L.polyline([[p[i].lat, p[i].lng], [p[i + 1].lat, p[i + 1].lng]],
        { color: stair ? getCss("--g-down3") : gradeColor(rt.grades[i], ES.state.thr),
          weight: 6, opacity: .95, lineCap: "round", dashArray: stair ? "3 8" : null }).addTo(routeLayer);
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
    const why = whyGentler(routes[gentler], routes[1 - gentler]);
    const verdict = similarLoad(a, b) && Math.abs(why.saved) <= 10
      ? `Both trips are similarly gentle on the knees.`
      : `Trip ${gentler + 1} is gentler on the knees — ${why.text}.`;
    const body = $("compareBody");
    body.innerHTML =
      (routes.some(isStraight) ? `<div class="hint">${STRAIGHT_WARN}</div>` : ``) +
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
  function ratingLabel(r) { return r === "friendly" ? "Knee-friendly" : r === "moderate" ? "Moderate" : "Steep ↓"; }
  const RATING_ORDER = ["friendly", "moderate", "avoid"];
  // Rating from measured steep-downhill metres, relative to trip length —
  // 100 m of steep trail is serious on a 1 km stroll, a footnote on 10 km.
  function measuredRating(m) {
    const friendlyCap = Math.max(50, m.dist * 0.015);
    const moderateCap = Math.max(150, m.dist * 0.05);
    return m.steepDown < friendlyCap ? "friendly" : m.steepDown < moderateCap ? "moderate" : "avoid";
  }
  // Blend measurement with the curated rating. Curated ratings come from
  // walks that were actually done and verified, while the measurement rests
  // on a ~30–90 m elevation model that invents slopes where a lakeside path
  // hugs a hillside — so the measurement may refine a curated rating but
  // never downgrade it by more than one level.
  function tripRating(t, metrics) {
    const m = metrics && metrics[t.id];
    if (!m || typeof m.steepDown !== "number") return t.rating || "moderate";
    let r = measuredRating(m);
    if (t.rating) {
      const cap = Math.min(RATING_ORDER.indexOf(t.rating) + 1, RATING_ORDER.length - 1);
      if (RATING_ORDER.indexOf(r) > cap) r = RATING_ORDER[cap];
    }
    return r;
  }
  function renderSuggestions(onSelect, metrics) {
    const wrap = $("suggestions");
    if (!wrap || !ES.trips) return;
    metrics = metrics || {};
    const list = ES.trips.all.slice().sort((a, b) => {
      const ra = RATING_ORDER.indexOf(tripRating(a, metrics));
      const rb = RATING_ORDER.indexOf(tripRating(b, metrics));
      if (ra !== rb) return ra - rb;                      // blended rating first
      const ma = metrics[a.id], mb = metrics[b.id];
      if (ma && mb) return ma.steepDown - mb.steepDown;   // then least steep downhill
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
      // flag loops where walking the right way round makes a real difference
      const dirLabel = m && m.dirSaved > 10 ? ` · right direction saves ${m.dirSaved} m ↓` : "";
      const div = document.createElement("div");
      div.className = "trip trip-" + rating;
      div.style.setProperty("--trip", col);
      div.innerHTML =
        `<div class="trip-head"><span class="trip-name">${t.name}</span>` +
        `<span class="trip-badge" style="background:${col}">${ratingLabel(rating)}</span></div>` +
        `<div class="trip-meta">${t.area} · ${distLabel} · ${steepLabel}${dirLabel}</div>` +
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
    // phone-only "waypoint on my location": offer it before any point is placed,
    // and also as the second point of an A→B route (e.g. my location → home)
    const fl = $("floatLoc");
    if (fl) fl.classList.toggle("show", !ES.state.busy && (!n || (ES.state.mode === "ab" && n < 2)));
  }

  // ---- results modal ----
  function showModal(html) { $("modalBody").innerHTML = html; $("modal").hidden = false; }
  function hideModal() { $("modal").hidden = true; }

  function loopSummary() {
    const routes = ES.state.routes, best = ES.state.recommended;
    const chosen = routes[best], other = routes[best === 0 ? 1 : 0];
    const gentleEither = !directionMatters(chosen, other);
    const why = whyGentler(chosen, other);
    const title = gentleEither ? "This loop is about as gentle either direction" : "Recommended walking direction";
    const lead = gentleEither
      ? `It's about the same both ways here, so walk it whichever direction you prefer — your points and the path don't change. ${tradeOffNote(chosen, other)}`
      : `The <b>recommended direction</b> (shown by the arrow on the map) is gentler than the reverse because it takes the steeper side <b>uphill</b>: ${why.text}. You still walk the same loop through the same numbered points; only the direction of travel changes.`;
    const rows =
      `<tr><td>Steep downhill · recommended</td><td class="num win">${Math.round(chosen.steepDown)} m</td></tr>` +
      `<tr><td>Steep downhill · reverse</td><td class="num">${Math.round(other.steepDown)} m</td></tr>` +
      (chosen.stairsDown > 5 || other.stairsDown > 5
        ? `<tr><td>Descending stairs</td><td class="num">${Math.round(chosen.stairsDown)} m (reverse: ${Math.round(other.stairsDown)} m)</td></tr>` : ``) +
      `<tr><td>Distance</td><td class="num">${fmtM(chosen.dist)}</td></tr>` +
      `<tr><td>Est. time</td><td class="num">${fmtTime(chosen.time)}</td></tr>` +
      `<tr><td>Total descent ↓</td><td class="num">${Math.round(chosen.descent)} m</td></tr>` +
      `<tr><td>Max down grade</td><td class="num">${(chosen.maxDown * 100).toFixed(0)}%</td></tr>`;
    return `<div class="modal-title">${title}</div><div class="modal-lead">${lead}</div>` +
      `<table class="cmp-table"><tbody>${rows}</tbody></table>` +
      `<div class="hint" style="margin-top:8px">Tip: the two direction buttons under the verdict let you preview the loop the other way round.</div>`;
  }

  function compareSummary() {
    const [a, b] = ES.state.routes;
    const gentler = a.kneeLoad <= b.kneeLoad ? 0 : 1;
    const faster = a.time <= b.time ? 0 : 1;
    const why = whyGentler(gentler === 0 ? a : b, gentler === 0 ? b : a);
    const similar = similarLoad(a, b) && Math.abs(why.saved) <= 10;
    const dMin = Math.round(Math.abs(a.time - b.time) / 60);
    let lead;
    if (gentler === faster) {
      lead = `<b>Trip ${gentler + 1}</b> wins on both counts — it's gentler on the knees${similar ? `` : ` (${why.text})`} and the quicker walk${dMin >= 1 ? ` by ${dMin} min` : ``}.`;
    } else if (similar) {
      lead = `The two are about equally kind to the knees, so go with <b>Trip ${faster + 1}</b> — it's faster${dMin >= 1 ? ` by ${dMin} min` : ``}.`;
    } else {
      lead = `<b>Trip ${faster + 1}</b> is faster${dMin >= 1 ? ` by ${dMin} min` : ``}, but <b>Trip ${gentler + 1}</b> is gentler on the knees — ${why.text}. For sore knees, take Trip ${gentler + 1}.`;
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

  ES.ui = { similarLoad, whyGentler, directionMatters, tradeOffNote, gradeColor, fmtM, fmtTime, drawRoute, drawProfile, fillStats, showReco, drawWaypoints, render, renderCompare, renderSuggestions, renderSavedTrips, resetResults, updateGoEnabled, showModal, hideModal, loopSummary, compareSummary, measuredRating, tripRating };
})();
