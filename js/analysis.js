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

  // Knee load per metre of height lost, at down-grade g with your limit thr.
  //
  // Under the limit the knee brakes but doesn't hurt. Then what loads it is
  // the height you lose; its share of absorbing it grows only mildly with
  // steepness: ≈38% of the energy at a 10% grade, ≈54% at 45% (knee work on
  // −6…−24° ramps, Schwameder, Roithner & Müller, ISBS 2000). `kneeShare`
  // fits that, so a gentle descent costs about the same per metre of height
  // whatever its grade.
  //
  // Over the limit it hurts, and more the steeper it gets: peak kneecap force
  // climbs from ~1× body weight on the level to ~3.5× at 32% (Alexander &
  // Schwameder, ISBS 2016). How pain scales with that force is personal and
  // not measured, so the r² growth and GENTLE_W are preferences — but varying
  // GENTLE_W from 0.1 to 0.5 and the growth from r to r³ changes no
  // recommended direction or route on the curated trips. The split itself
  // matters: without it the limit would scale every route's load by the same
  // factor and could never change which route or direction is recommended.
  const GENTLE_W = 0.25;
  const kneeShare = (g) => 0.35 + 0.45 * g;
  function descentWeight(g, thr) {
    const share = kneeShare(g) / kneeShare(thr), r = g / thr;
    return g > thr ? r * r * share : GENTLE_W * share;
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

  // OSM incline tag → +1 up / −1 down (along the way's node order), 0 unknown
  function inclineSign(v) {
    if (v === "up") return 1;
    if (v === "down") return -1;
    const x = parseFloat(v);
    return isFinite(x) && x !== 0 ? Math.sign(x) : 0;
  }

  // Which parts of a route run on OSM steps, matched EXACTLY: a route edge is
  // on a stair way when its two OSM nodes (the router reports the ids it
  // used, as geom.nodes) are consecutive nodes of that way. A ramp beside the
  // steps or a street past their foot uses other nodes, so it never matches.
  // Returns per resampled segment { share: 0..1 on steps, dir: −1 down /
  // +1 up / 0 unknown (no incline tag) } — or null when there are no steps.
  function stairsAlong(geom, pts, ways) {
    if (!ways || !ways.length || !geom || !geom.nodes) return null;
    const edges = new Map(); // "a,b" → direction when walking from a to b
    ways.forEach((w) => {
      const inc = inclineSign(w.incline);
      for (let k = 0; k < w.nodes.length - 1; k++) {
        edges.set(w.nodes[k] + "," + w.nodes[k + 1], inc);
        edges.set(w.nodes[k + 1] + "," + w.nodes[k], -inc);
      }
    });
    const spans = []; // stretches of the route on steps, in metres from the start
    let s = 0;
    for (let k = 0; k < geom.length - 1; k++) {
      const d = ES.geo.haversine(geom[k], geom[k + 1]);
      const key = geom.nodes[k] + "," + geom.nodes[k + 1];
      if (d > 0 && edges.has(key)) spans.push({ a: s, b: s + d, dir: edges.get(key) });
      s += d;
    }
    if (!spans.length) return null;
    const n = pts.length - 1, share = new Array(n).fill(0), dir = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = pts[i].s, b = pts[i + 1].s;
      if (!(b > a)) continue;
      let on = 0, up = 0, down = 0;
      spans.forEach((sp) => {
        const o = Math.min(b, sp.b) - Math.max(a, sp.a);
        if (o <= 0) return;
        on += o;
        if (sp.dir > 0) up += o; else if (sp.dir < 0) down += o;
      });
      share[i] = Math.min(1, on / (b - a));
      dir[i] = down > up ? -1 : up > down ? 1 : 0;
    }
    return { share, dir };
  }

  // analyse one ordered (pts, elev) pair in its given direction.
  // `stairs` is an optional { share, dir } from stairsAlong, already in this
  // walking direction. `meta` = { source, closed }.
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
      // steps tagged up/down settle it; untagged steps count as going down
      // unless the terrain clearly climbs (a short flight is often too small
      // for the terrain model to show which way it runs)
      const sf = stairs ? stairs.share[i] : 0, sd = stairs ? stairs.dir[i] : 0;
      if (sf > 0 && (sd < 0 || (sd === 0 && dh <= 0))) {
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
  // (segment order reverses, and steps that went up now go down)
  function reversed(route, thr) {
    const rv = reverseSeries(route.pts, route.elev);
    const st = route.stairs
      ? { share: route.stairs.share.slice().reverse(), dir: route.stairs.dir.slice().reverse().map((d) => -d) }
      : null;
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

  ES.analysis = { analyse, cleanProfile, denoise, descentWeight, stairsAlong, reverseSeries, reversed, pickWithinDetour };
})();
