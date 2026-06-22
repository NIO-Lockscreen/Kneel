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

  ES.geo = { R, rad, haversine, bearing, resample, smooth };
})();
