/* EasyStride — route scoring. Turns (points, elevations) into knee-relevant
 * metrics: steep-downhill metres, knee load, climb/descent, time, max grade. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  // Each metre of DESCENDING stairs counts as this many "equivalent steep
  // metres" of knee load — about the same as an 18% down-slope, because real
  // steps are far steeper and more jarring than the smoothed DEM ever shows.
  const STAIR_LOAD = 1.0;

  // DEM noise guard: an unbroken up- or down-run whose total height change is
  // under `eps` metres is almost certainly elevation-model noise (the public
  // DEM is ~30–90 m resolution), not a real hill — flatten it so it can't
  // masquerade as steep downhill and scare people off genuinely flat loops.
  function denoise(elev, eps) {
    const dh = [];
    for (let i = 0; i < elev.length - 1; i++) dh.push(elev[i + 1] - elev[i]);
    let i = 0;
    while (i < dh.length) {
      const s = Math.sign(dh[i]);
      let j = i, total = 0;
      while (j < dh.length && Math.sign(dh[j]) === s) { total += dh[j]; j++; }
      if (s !== 0 && Math.abs(total) < eps) for (let k = i; k < j; k++) dh[k] = 0;
      i = j;
    }
    return dh;
  }

  // analyse one ordered (pts, elev) pair in its given direction.
  // `stairs` is an optional per-segment boolean mask (OSM highway=steps).
  function analyse(pts, elev, thr, stairs) {
    const { haversine } = ES.geo;
    let dist = 0, ascent = 0, descent = 0, steepDown = 0, stairsDown = 0, kneeLoad = 0, time = 0, maxDown = 0;
    const cum = [0], grades = [];
    const dhs = denoise(elev, (ES.config && ES.config.noiseFloor) || 3);
    for (let i = 0; i < pts.length - 1; i++) {
      const d = haversine(pts[i], pts[i + 1]); cum.push(cum[i] + d);
      if (d < 0.5) { grades.push(0); continue; }
      const dh = dhs[i], grade = dh / d;
      grades.push(grade); dist += d;
      if (dh > 0) ascent += dh; else descent += -dh;
      const downStairs = stairs && stairs[i] && dh <= 0;
      if (downStairs) {                          // stairs going down: worst case
        steepDown += d; stairsDown += d;
        kneeLoad += d * STAIR_LOAD;
        if (-grade > maxDown) maxDown = -grade;
      } else if (dh < 0) {
        const g = -grade;                       // positive down-grade
        if (g > thr) steepDown += d;            // metres of painful trail
        kneeLoad += (-dh) * Math.pow(g / thr, 2); // "equivalent steep metres"
        if (g > maxDown) maxDown = g;
      }
      const v = 6 * Math.exp(-3.5 * Math.abs(grade + 0.05)); // Tobler km/h
      time += (d / 1000) / Math.max(v, 0.4) * 3600;
    }
    return { pts, elev, grades, cum, stairs: stairs || null, dist, ascent, descent, steepDown, stairsDown, kneeLoad, time, maxDown };
  }

  function reverseSeries(pts, elev) {
    return { pts: pts.slice().reverse(), elev: elev.slice().reverse() };
  }

  // the same path walked the other way — used for direction advice.
  // (reversing segment order also reverses the per-segment stair mask)
  function reversed(route, thr) {
    const rv = reverseSeries(route.pts, route.elev);
    const st = route.stairs ? route.stairs.slice().reverse() : null;
    return analyse(rv.pts, rv.elev, thr, st);
  }

  // Pick the gentlest route (least knee load) whose distance stays within
  // `budget` (fraction) of the shortest route. Near-ties in knee load go to
  // the shorter route, so a barely-gentler option can't drag in a long detour.
  // Returns the index.
  function pickWithinDetour(routes, budget) {
    if (!routes.length) return 0;
    const shortest = Math.min(...routes.map((r) => r.dist));
    const cap = shortest * (1 + budget);
    let best = -1;
    routes.forEach((r, i) => {
      if (r.dist > cap) return;
      if (best === -1) { best = i; return; }
      const b = routes[best];
      if (r.kneeLoad < b.kneeLoad * 0.95 - 1) best = i;                 // clearly gentler
      else if (r.kneeLoad <= b.kneeLoad * 1.05 + 1 && r.dist < b.dist) best = i; // near-tie: shorter wins
    });
    if (best === -1) { // nothing within budget: fall back to absolute gentlest
      best = 0;
      for (let i = 1; i < routes.length; i++) if (routes[i].kneeLoad < routes[best].kneeLoad) best = i;
    }
    return best;
  }

  ES.analysis = { analyse, denoise, reverseSeries, reversed, pickWithinDetour };
})();
