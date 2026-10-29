/* EasyStride — route scoring. Turns (points, elevations) into knee-relevant
 * metrics: steep-downhill metres, knee load, climb/descent, time, max grade. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  // How each elevation source (see api.js) is cleaned before scoring, in
  // metres along the path:
  //   medianR — running-median radius: drops dips/spikes narrower than ~2×
  //             this (a bridge over a brook is a ditch in a bare-earth
  //             terrain model) but passes real ramps through unchanged
  //   smoothR — moving-average radius
  //   noise   — an unbroken up- or down-run with less total height change
  //             than this is noise, not a hill, and is flattened
  const SOURCES = {
    dtm: { medianR: 20, smoothR: 10, noise: 1 }, // 1 m lidar terrain model
    dem: { medianR: 0, smoothR: 60, noise: 3 },  // ~90 m DEM, whole metres
  };

  // Knee load per metre of height lost. Descent gentler than your limit still
  // costs a little (the knee is still braking), but descent steeper than the
  // limit is what hurts — and it hurts more the steeper it is. Without the
  // split the limit would scale every route's load by the same 1/thr², so it
  // could never change which route or direction is recommended.
  const GENTLE_W = 0.25;
  function descentWeight(g, thr) {
    const r = g / thr;
    return (g > thr ? 1 : GENTLE_W) * r * r;
  }

  // Descending stairs load the knee at least like an 18% down-slope per metre
  // walked — real steps are far steeper and more jarring than any terrain
  // model shows — weighed against the same limit as every other descent.
  const STAIR_GRADE = 0.18;

  function cleanProfile(raw, spacing, source, closed) {
    const c = SOURCES[source] || SOURCES.dem;
    const mw = Math.round(c.medianR / spacing);
    const sw = Math.max(1, Math.round(c.smoothR / spacing));
    const e = mw >= 1 ? ES.geo.median(raw, mw, closed) : raw;
    return ES.geo.smooth(e, sw, closed);
  }

  // Per-segment height changes with noise runs flattened. On a loop the run
  // that crosses the start/finish is treated as one run, so the result is the
  // same whichever way round (and from wherever) the loop is walked.
  function denoise(elev, eps, closed) {
    const dh = [];
    for (let i = 0; i < elev.length - 1; i++) dh.push(elev[i + 1] - elev[i]);
    const n = dh.length;
    let off = 0;
    if (closed && n) {
      const s0 = Math.sign(dh[0]);
      while (off < n && Math.sign(dh[off]) === s0) off++;
      if (off === n) off = 0;
    }
    const rot = dh.slice(off).concat(dh.slice(0, off));
    let i = 0;
    while (i < n) {
      const s = Math.sign(rot[i]);
      let j = i, total = 0;
      while (j < n && Math.sign(rot[j]) === s) { total += rot[j]; j++; }
      if (s !== 0 && Math.abs(total) < eps) for (let k = i; k < j; k++) rot[k] = 0;
      i = j;
    }
    return rot.slice(n - off).concat(rot.slice(0, n - off));
  }

  // analyse one ordered (pts, elev) pair in its given direction.
  // `stairs` is an optional per-segment share (0..1, or boolean) of the
  // segment that runs on OSM highway=steps. `meta` = { source, closed }.
  function analyse(pts, elev, thr, stairs, meta) {
    meta = meta || {};
    const eps = (SOURCES[meta.source] || SOURCES.dem).noise;
    const stairPerM = STAIR_GRADE * descentWeight(STAIR_GRADE, thr);
    let dist = 0, ascent = 0, descent = 0, steepDown = 0, stairsDown = 0, kneeLoad = 0, time = 0, maxDown = 0;
    const cum = [0], grades = [], downStairs = [];
    const dhs = denoise(elev, eps, meta.closed);
    for (let i = 0; i < pts.length - 1; i++) {
      const d = ES.geo.segLength(pts[i], pts[i + 1]); cum.push(cum[i] + d);
      downStairs.push(false);
      if (d < 0.5) { grades.push(0); continue; }
      const dh = dhs[i], grade = dh / d;
      grades.push(grade); dist += d;
      if (dh > 0) ascent += dh; else descent += -dh;
      let steep = 0, load = 0;
      if (dh < 0) {
        const g = -grade;                         // positive down-grade
        if (g > thr) steep = d;                   // metres of painful trail
        load = -dh * descentWeight(g, thr);       // "equivalent steep metres"
        if (g > maxDown) maxDown = g;
      }
      // stairs that don't clearly climb are counted as going down: the
      // terrain model often can't tell which way a short flight runs
      const sf = stairs ? +stairs[i] || 0 : 0;
      if (sf > 0 && dh <= 0) {
        stairsDown += d * sf;
        steep = Math.max(steep, d * sf);
        load = Math.max(load, d * sf * stairPerM); // never lighter than the slope itself
        downStairs[i] = sf >= 0.5;
      }
      steepDown += steep; kneeLoad += load;
      const v = 6 * Math.exp(-3.5 * Math.abs(grade + 0.05)); // Tobler km/h
      time += (d / 1000) / Math.max(v, 0.4) * 3600;
    }
    return { pts, elev, grades, cum, stairs: stairs || null, downStairs, meta, dist, ascent, descent, steepDown, stairsDown, kneeLoad, time, maxDown };
  }

  function reverseSeries(pts, elev) {
    return { pts: pts.slice().reverse(), elev: elev.slice().reverse() };
  }

  // the same path walked the other way — used for direction advice.
  // (reversing segment order also reverses the per-segment stair mask)
  function reversed(route, thr) {
    const rv = reverseSeries(route.pts, route.elev);
    const st = route.stairs ? route.stairs.slice().reverse() : null;
    return analyse(rv.pts, rv.elev, thr, st, route.meta);
  }

  // Pick the gentlest route (least knee load) whose distance stays within
  // `budget` (fraction) of the shortest route. Routes within 5% (or 1 unit)
  // of the least load count as ties, and among ties the shorter one wins, so
  // a barely-gentler option can't drag in a long detour. Comparing every
  // route with the overall minimum (not with whichever was best so far) keeps
  // the answer independent of the order the router returned them in.
  // Returns the index.
  function pickWithinDetour(routes, budget) {
    if (!routes.length) return 0;
    const shortest = Math.min(...routes.map((r) => r.dist));
    const cap = shortest * (1 + budget) + 1e-6;
    const ok = routes.map((_, i) => i).filter((i) => routes[i].dist <= cap);
    const least = Math.min(...ok.map((i) => routes[i].kneeLoad));
    const tol = Math.max(1, least * 0.05);
    return ok.filter((i) => routes[i].kneeLoad <= least + tol)
      .reduce((a, b) => (routes[b].dist < routes[a].dist ? b : a));
  }

  ES.analysis = { analyse, cleanProfile, denoise, descentWeight, reverseSeries, reversed, pickWithinDetour };
})();
