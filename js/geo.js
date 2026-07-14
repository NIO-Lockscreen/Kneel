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

  // resample a polyline to ~spacing metres, capped at maxN points
  function resample(line, spacing, maxN) {
    if (line.length < 2) return line.slice();
    let total = 0;
    for (let i = 0; i < line.length - 1; i++) total += haversine(line[i], line[i + 1]);
    const n = Math.max(2, Math.min(maxN, Math.round(total / spacing) + 1));
    const step = total / (n - 1), out = [line[0]];
    let segI = 0, segStart = line[0], segLen = haversine(line[0], line[1]), acc = 0, target = step;
    let segEnd = line[1];
    while (out.length < n - 1) {
      if (acc + segLen >= target) {
        const t = (target - acc) / segLen;
        out.push({ lat: segStart.lat + (segEnd.lat - segStart.lat) * t, lng: segStart.lng + (segEnd.lng - segStart.lng) * t });
        target += step;
      } else {
        acc += segLen; segI++;
        if (segI >= line.length - 1) break;
        segStart = line[segI]; segEnd = line[segI + 1]; segLen = haversine(segStart, segEnd);
      }
    }
    out.push(line[line.length - 1]);
    return out;
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

  // moving-average smoothing, window radius w
  function smooth(arr, w) {
    if (arr.length < 3) return arr.slice();
    const out = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(arr.length - 1, i + w); j++) { s += arr[j]; c++; }
      out[i] = s / c;
    }
    return out;
  }

  ES.geo = { R, rad, haversine, bearing, resample, smooth, offset, pathLength, pointAt, sameGeometry };
})();
