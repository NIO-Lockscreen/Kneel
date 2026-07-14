/* EasyStride — external services: routing (OSRM foot), elevation (Open-Meteo),
 * and geocoding (Nominatim). All network access lives here. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  // ---- elevation (Open-Meteo DEM) ----
  async function fetchElevation(pts) {
    const out = [];
    const B = ES.config.elevationBatch;
    for (let i = 0; i < pts.length; i += B) {
      const chunk = pts.slice(i, i + B);
      const lat = chunk.map((p) => p.lat.toFixed(6)).join(",");
      const lng = chunk.map((p) => p.lng.toFixed(6)).join(",");
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("elevation " + r.status);
      const j = await r.json();
      if (!j.elevation) throw new Error("elevation: no data");
      out.push(...j.elevation);
    }
    return out;
  }

  // ---- routing (OSRM foot profile) ----
  // Returns an array of geometries (arrays of {lat,lng}); first is the primary route.
  async function osrmRoute(pts, alternatives) {
    const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson&alternatives=${alternatives ? "3" : "false"}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("routing " + r.status);
    const j = await r.json();
    if (j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error("no route");
    return j.routes.map((rt) => rt.geometry.coordinates.map((c) => ({ lat: c[1], lng: c[0] })));
  }

  // ---- stairs (Overpass: OSM highway=steps ways in a bbox) ----
  // Returns an array of polylines ([{lat,lng}, …]) for stair ways, so routes
  // can flag segments that descend steps — the most jarring thing for knees.
  async function fetchStairs(south, west, north, east) {
    const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
    const q = `[out:json][timeout:12];way[highway=steps](${bbox});out geom 400;`;
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q),
    });
    if (!r.ok) throw new Error("stairs " + r.status);
    const j = await r.json();
    return (j.elements || [])
      .filter((el) => el.geometry && el.geometry.length > 1)
      .map((el) => el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })));
  }

  // ---- geocoding (Nominatim) ----
  // `viewbox` (west,north,east,south) softly biases results to a region; omit
  // it for a global search (e.g. picking a town/city).
  async function geocode(query, viewbox) {
    const q = encodeURIComponent(query.trim());
    if (!q) throw new Error("empty query");
    let url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}&accept-language=en`;
    if (viewbox) url += `&viewbox=${viewbox}&bounded=0`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("geocode " + r.status);
    const j = await r.json();
    if (!j.length) throw new Error('no match for "' + query + '"');
    const hit = j[0];
    const bb = hit.boundingbox; // [south, north, west, east] as strings
    const bbox = (bb && bb.length === 4)
      ? { south: +bb[0], north: +bb[1], west: +bb[2], east: +bb[3] }
      : null;
    return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), label: hit.display_name, bbox };
  }

  ES.api = { fetchElevation, osrmRoute, fetchStairs, geocode };
})();
