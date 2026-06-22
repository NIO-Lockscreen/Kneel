/* EasyStride — local persistence (home + saved trips) and GPX export.
 * Everything lives in the browser's localStorage; nothing leaves the device
 * until the user explicitly exports. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  const HOME_KEY = "easystride.home";
  const TRIPS_KEY = "easystride.savedTrips";
  const METRICS_KEY = "easystride.tripMetrics";

  function read(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  // ---- home ----
  function getHome() { return read(HOME_KEY, null); }
  function setHome(home) { return write(HOME_KEY, home); }

  // ---- saved trips ----
  function getTrips() { const t = read(TRIPS_KEY, []); return Array.isArray(t) ? t : []; }
  function saveTrips(arr) { return write(TRIPS_KEY, arr); }
  function addTrip(trip) { const a = getTrips(); a.push(trip); saveTrips(a); return a; }
  function updateTrip(id, trip) {
    const a = getTrips();
    const i = a.findIndex((t) => t.id === id);
    if (i >= 0) a[i] = trip; else a.push(trip);
    saveTrips(a); return a;
  }
  function deleteTrip(id) { const a = getTrips().filter((t) => t.id !== id); saveTrips(a); return a; }

  // ---- cached suggested-trip metrics (measured steep-downhill etc.) ----
  function getMetrics() { const m = read(METRICS_KEY, {}); return (m && typeof m === "object") ? m : {}; }
  function setMetrics(m) { return write(METRICS_KEY, m); }

  // ---- GPX export of every saved trip (waypoints + route track) ----
  function esc(s) {
    return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
  }
  function toGPX(trips) {
    let s = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="EasyStride" xmlns="http://www.topografix.com/GPX/1/1">\n`;
    trips.forEach((t) => {
      (t.waypoints || []).forEach((w, i) => {
        s += `  <wpt lat="${(+w.lat).toFixed(6)}" lon="${(+w.lng).toFixed(6)}"><name>${esc(t.name)} · ${i + 1}</name></wpt>\n`;
      });
      const path = (t.path && t.path.length) ? t.path : (t.waypoints || []);
      if (path.length) {
        s += `  <trk><name>${esc(t.name)}</name><trkseg>\n`;
        path.forEach((p) => { s += `    <trkpt lat="${(+p.lat).toFixed(6)}" lon="${(+p.lng).toFixed(6)}"></trkpt>\n`; });
        s += `  </trkseg></trk>\n`;
      }
    });
    return s + `</gpx>\n`;
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  ES.store = { getHome, setHome, getTrips, saveTrips, addTrip, updateTrip, deleteTrip, getMetrics, setMetrics, toGPX, download };
})();
