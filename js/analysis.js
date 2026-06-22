/* EasyStride — route scoring. Turns (points, elevations) into knee-relevant
 * metrics: steep-downhill metres, knee load, climb/descent, time, max grade. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  // analyse one ordered (pts, elev) pair in its given direction
  function analyse(pts, elev, thr) {
    const { haversine } = ES.geo;
    let dist = 0, ascent = 0, descent = 0, steepDown = 0, kneeLoad = 0, time = 0, maxDown = 0;
    const cum = [0], grades = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = haversine(pts[i], pts[i + 1]); cum.push(cum[i] + d);
      if (d < 0.5) { grades.push(0); continue; }
      const dh = elev[i + 1] - elev[i], grade = dh / d;
      grades.push(grade); dist += d;
      if (dh > 0) ascent += dh; else descent += -dh;
      if (dh < 0) {
        const g = -grade;                       // positive down-grade
        if (g > thr) steepDown += d;            // metres of painful trail
        kneeLoad += (-dh) * Math.pow(g / thr, 2); // "equivalent steep metres"
        if (g > maxDown) maxDown = g;
      }
      const v = 6 * Math.exp(-3.5 * Math.abs(grade + 0.05)); // Tobler km/h
      time += (d / 1000) / Math.max(v, 0.4) * 3600;
    }
    return { pts, elev, grades, cum, dist, ascent, descent, steepDown, kneeLoad, time, maxDown };
  }

  function reverseSeries(pts, elev) {
    return { pts: pts.slice().reverse(), elev: elev.slice().reverse() };
  }

  // Pick the gentlest route (least knee load) whose distance stays within
  // `budget` (fraction) of the shortest route. Returns the index.
  function pickWithinDetour(routes, budget) {
    if (!routes.length) return 0;
    const shortest = Math.min(...routes.map((r) => r.dist));
    const cap = shortest * (1 + budget);
    let best = -1;
    routes.forEach((r, i) => {
      if (r.dist <= cap && (best === -1 || r.kneeLoad < routes[best].kneeLoad)) best = i;
    });
    if (best === -1) { // nothing within budget: fall back to absolute gentlest
      best = 0;
      for (let i = 1; i < routes.length; i++) if (routes[i].kneeLoad < routes[best].kneeLoad) best = i;
    }
    return best;
  }

  ES.analysis = { analyse, reverseSeries, pickWithinDetour };
})();
