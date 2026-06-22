/* EasyStride — shared namespace, config, app state and tiny DOM helpers.
 * Loaded first; every other module hangs off window.EasyStride. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  ES.config = {
    center: [63.413, 10.38],   // Trondheim
    zoom: 12,
    elevationBatch: 100,       // Open-Meteo points per request
    maxRoutePoints: 150,       // resample cap per route
    sampleSpacing: 30,         // metres, minimum spacing when resampling
  };

  ES.state = {
    mode: "ab",                // 'ab' | 'loop'
    waypoints: [],
    routes: [],
    selected: 0,
    recommended: 0,
    thr: 0.08,                 // pain threshold (down-grade fraction)
    detour: 0.25,              // max acceptable detour vs shortest route (fraction)
    busy: false,
  };

  ES.$ = (id) => document.getElementById(id);

  ES.setStatus = function (msg, err) {
    const s = ES.$("status");
    s.textContent = msg;
    s.classList.toggle("err", !!err);
  };
})();
