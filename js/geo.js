/* EasyStride — geometry helpers (pure, no DOM, no network). */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;

  function haversine(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function bearing(a, b) {
    const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
      Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // resample a polyline to ~spacing metres, capped at maxN points. Each output
  // point carries `s`, its distance ALONG the path — use that (not the
  // straight-line chord between samples) for grades: at bends, switchbacks and
  // out-and-back turnarounds the chord can be a fraction of the walked distance.
  function resample(line, spacing, maxN) {
    if (line.length < 2) return line.map((p) => ({ lat: p.lat, lng: p.lng, s: 0 }));
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));
    const total = cum[cum.length - 1];
    const n = Math.max(2, Math.min(maxN, Math.round(total / spacing) + 1));
    const step = total / (n - 1), out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const target = k === n - 1 ? total : k * step;
      while (j < line.length - 2 && cum[j + 1] < target) j++;
      const len = cum[j + 1] - cum[j];
      const t = len ? Math.min(1, Math.max(0, (target - cum[j]) / len)) : 0;
      out.push({ lat: line[j].lat + (line[j + 1].lat - line[j].lat) * t,
                 lng: line[j].lng + (line[j + 1].lng - line[j].lng) * t, s: target });
    }
    return out;
  }

  // walked distance between consecutive samples (falls back to the chord for
  // points that didn't come from resample)
  function segLength(a, b) {
    return (a.s != null && b.s != null) ? Math.abs(b.s - a.s) : haversine(a, b);
  }

  // destination point: start at p, walk `dist` metres on compass bearing `brg`
  function offset(p, brg, dist) {
    const δ = dist / R, θ = rad(brg);
    const φ1 = rad(p.lat), λ1 = rad(p.lng);
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: φ2 * 180 / Math.PI, lng: ((λ2 * 180 / Math.PI + 540) % 360) - 180 };
  }

  function pathLength(line) {
    let t = 0;
    for (let i = 1; i < line.length; i++) t += haversine(line[i - 1], line[i]);
    return t;
  }

  // point at fraction f (0..1) of the line's length
  function pointAt(line, f) {
    const total = pathLength(line);
    let target = total * f, acc = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const d = haversine(line[i], line[i + 1]);
      if (acc + d >= target) {
        const t = d ? (target - acc) / d : 0;
        return { lat: line[i].lat + (line[i + 1].lat - line[i].lat) * t,
                 lng: line[i].lng + (line[i + 1].lng - line[i].lng) * t };
      }
      acc += d;
    }
    return line[line.length - 1];
  }

  // metres from point p to segment a–b (local equirectangular approximation —
  // plenty accurate at the tens-of-metres scale this is used for)
  function distToSegment(p, a, b) {
    const kx = 111320 * Math.cos(rad(p.lat)), ky = 110540;
    const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
    const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? -(ax * dx + ay * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + dx * t, y = ay + dy * t;
    return Math.sqrt(x * x + y * y);
  }

  // is p within maxDist metres of the polyline?
  function nearPolyline(p, line, maxDist) {
    for (let i = 0; i < line.length - 1; i++) {
      if (distToSegment(p, line[i], line[i + 1]) <= maxDist) return true;
    }
    return false;
  }

  // do two geometries describe essentially the same walk? (similar length and
  // close together at the ¼, ½ and ¾ marks)
  function sameGeometry(a, b) {
    const la = pathLength(a), lb = pathLength(b);
    if (Math.abs(la - lb) > Math.max(60, 0.03 * Math.min(la, lb))) return false;
    for (const f of [0.25, 0.5, 0.75]) {
      if (haversine(pointAt(a, f), pointAt(b, f)) > 80) return false;
    }
    return true;
  }

  // Sliding-window filter, window radius w. `closed` means the series is a
  // loop whose last sample is the first one again: the window wraps around
  // the seam. Open series shrink the window symmetrically at the ends, so the
  // first/last values aren't dragged towards their neighbours (a lopsided
  // window there flattens the start and end, and on a loop that undercounts
  // the descent of whichever direction goes downhill through the start).
  function windowed(arr, w, closed, reduce) {
    const n = arr.length;
    if (n < 3 || w < 1) return arr.slice();
    const out = new Array(n);
    if (closed) {
      const m = n - 1;
      for (let i = 0; i < m; i++) {
        const win = [];
        for (let j = i - w; j <= i + w; j++) win.push(arr[((j % m) + m) % m]);
        out[i] = reduce(win);
      }
      out[m] = out[0];
    } else {
      for (let i = 0; i < n; i++) {
        const r = Math.min(w, i, n - 1 - i);
        out[i] = reduce(arr.slice(i - r, i + r + 1));
      }
    }
    return out;
  }
  const mean = (win) => win.reduce((a, b) => a + b, 0) / win.length;
  const mid = (win) => win.slice().sort((a, b) => a - b)[win.length >> 1];

  // moving-average smoothing
  function smooth(arr, w, closed) { return windowed(arr, w, closed, mean); }
  // running median: removes dips/spikes narrower than the window (e.g. a
  // bridge over a stream, which a bare-earth terrain model shows as a ditch)
  // while passing real ramps through unchanged
  function median(arr, w, closed) { return windowed(arr, w, closed, mid); }

  ES.geo = { R, rad, haversine, bearing, resample, segLength, smooth, median, offset, pathLength, pointAt, distToSegment, nearPolyline, sameGeometry };
})();
