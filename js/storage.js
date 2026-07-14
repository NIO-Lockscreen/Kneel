/* EasyStride — local persistence (home + saved trips).
 * Everything lives in the browser's localStorage; nothing leaves the device. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  const HOME_KEY = "easystride.home";
  const TRIPS_KEY = "easystride.savedTrips";
  const METRICS_KEY = "easystride.tripMetrics";
  const THRESHOLD_KEY = "easystride.steepnessPct";
  const AVOID_KEY = "easystride.avoidAll";

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

  // ---- steepness limit (percent integer, persisted across visits) ----
  function getThreshold(fallback) { const v = read(THRESHOLD_KEY, null); return Number.isFinite(v) ? v : fallback; }
  function setThreshold(pct) { return write(THRESHOLD_KEY, pct); }

  // ---- "avoid steep downhill at almost any cost" toggle ----
  function getAvoid() { return !!read(AVOID_KEY, false); }
  function setAvoid(on) { return write(AVOID_KEY, !!on); }

  ES.store = { getHome, setHome, getTrips, saveTrips, addTrip, updateTrip, deleteTrip, getMetrics, setMetrics, getThreshold, setThreshold, getAvoid, setAvoid };
})();
