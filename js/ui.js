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
    if (g >= 0.02) return getCss("--g-up");
    if (g > -0.025) return getCss("--g-flat");
    const down = -g;
    if (down < thr) return getCss("--g-down1");
    if (down < thr * 1.6) return getCss("--g-down2");
    return getCss("--g-down3");
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
    const ang = ES.geo.bearing(p[ai - 1], p[ai + 1]);
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
      const dirWord = best === 0 ? "as you marked it" : "in reverse";
      verdict.innerHTML = saved > 3
        ? `Walk the loop <span class="arrow">${best === 0 ? "▶" : "◀"}</span> <b>${dirWord}</b>.`
        : `This loop is gentle <b>either way</b>.`;
      delta.innerHTML =
        `<b>${dirWord}</b> · steep downhill <b>${Math.round(chosen.steepDown)} m</b><br>` +
        `other way · steep downhill <b>${Math.round(other.steepDown)} m</b>` +
        (saved > 3 ? `<br>→ you avoid <b>${saved} m</b> of sore descent by climbing the steep side instead.` : ``);
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
    ES.state.waypoints.forEach((w, i) => {
      const html = (ES.state.mode === "loop")
        ? `<div class="num-ico">${i + 1}</div>`
        : `<div class="num-ico">${i === 0 ? "A" : "B"}</div>`;
      L.marker([w.lat, w.lng], { icon: L.divIcon({ className: "", html, iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 1000 }).addTo(ES.layers.marker);
    });
  }

  function render() {
    const route = ES.state.routes[ES.state.selected];
    drawRoute(route); drawProfile(route); fillStats(route); showReco();
    drawWaypoints();
  }

  function resetResults() {
    ES.state.routes = []; ES.state.selected = 0; ES.state.recommended = 0;
    ES.layers.route.clearLayers(); ES.layers.deco.clearLayers();
    $("reco").classList.remove("show");
    $("stats").classList.remove("show");
    $("profile").classList.remove("show");
    $("switch").style.display = "none";
  }

  function updateGoEnabled() {
    const n = ES.state.waypoints.length;
    const ready = ES.state.mode === "ab" ? n >= 2 : n >= 3;
    $("go").disabled = !ready || ES.state.busy;
    const sg = $("suggest"); if (sg) sg.disabled = ES.state.busy || !ES.state.routes.length;
  }

  ES.ui = { gradeColor, fmtM, fmtTime, drawRoute, drawProfile, fillStats, showReco, drawWaypoints, render, resetResults, updateGoEnabled };
})();
