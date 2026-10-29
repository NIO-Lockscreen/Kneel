/* EasyStride — external services: routing (OSRM foot), elevation (Kartverket
 * terrain model in Norway, Open-Meteo elsewhere), and geocoding (Nominatim).
 * All network access lives here. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  // ---- elevation ----
  // Two sources:
  //  "dtm" — Kartverket's national terrain model (1 m lidar, Norway only).
  //          Accurate enough to see a real 20 m ramp or a flat shoreline path.
  //  "dem" — Open-Meteo (Copernicus ~90 m DEM, whole metres) anywhere. Too
  //          coarse for paths: a lakeside path gets the slope of the hillside
  //          next to it, so it needs heavier smoothing and a bigger noise floor.
  const NORWAY = { s: 57.9, n: 71.3, w: 4.4, e: 31.3 };
  function inNorway(pts) {
    return pts.every((p) => p.lat >= NORWAY.s && p.lat <= NORWAY.n && p.lng >= NORWAY.w && p.lng <= NORWAY.e);
  }

  // run fn over items, at most `limit` at a time, keeping order
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  // raw terrain-model heights, null where the model has none (water, abroad)
  async function fetchElevationDTM(pts) {
    const chunks = [];
    for (let i = 0; i < pts.length; i += 50) chunks.push(pts.slice(i, i + 50)); // API max: 50 points
    const parts = await mapLimit(chunks, 3, async (chunk) => {
      const list = "[" + chunk.map((p) => `[${p.lng.toFixed(6)},${p.lat.toFixed(6)}]`).join(",") + "]";
      // the explicit dtm1 source: the "best available" endpoint answers sea
      // points with water DEPTH, which would look like a cliff on a coast path
      const url = "https://ws.geonorge.no/hoydedata/v1/datakilder/dtm1/punkt?koordsys=4258&geojson=false&punkter=" + encodeURIComponent(list);
      const r = await fetch(url);
      if (!r.ok) throw new Error("elevation " + r.status);
      const j = await r.json();
      if (!j.punkter || j.punkter.length !== chunk.length) throw new Error("elevation: bad reply");
      return j.punkter.map((p) => (typeof p.z === "number" ? p.z : null));
    });
    return [].concat(...parts);
  }

  // A route's terrain-model heights in path order: a few gaps (a pier, a path
  // line drawn just over the water) are filled from their neighbours; mostly
  // gaps means the route is outside the coverage.
  function fillGaps(z) {
    if (z.filter((v) => v != null).length < z.length * 0.8) throw new Error("elevation: outside terrain-model coverage");
    z = z.slice();
    for (let i = 0; i < z.length; i++) {
      if (z[i] != null) continue;
      const a = i - 1;                                   // already known or filled
      let b = i + 1; while (b < z.length && z[b] == null) b++;
      z[i] = a < 0 ? z[b] : b >= z.length ? z[a] : z[a] + (z[b] - z[a]) / (b - a);
    }
    return z;
  }

  async function fetchElevationDEM(pts) {
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

  // Heights already fetched this visit, per source, keyed by coordinate.
  // Candidate routes sharing a start or finish (see geo.resample), re-runs
  // after changing a setting, compare mode and suggested trips scored in the
  // background all reuse them instead of asking again.
  const elevCache = { dtm: new Map(), dem: new Map() };
  const ptKey = (p) => p.lat.toFixed(6) + "," + p.lng.toFixed(6);
  async function cachedHeights(source, lists, fetcher) {
    const cache = elevCache[source];
    if (cache.size > 50000) cache.clear();
    const missing = new Map();
    lists.forEach((pts) => pts.forEach((p) => {
      const k = ptKey(p);
      if (!cache.has(k) && !missing.has(k)) missing.set(k, p);
    }));
    if (missing.size) {
      const pts = [...missing.values()];
      const z = await fetcher(pts);
      pts.forEach((p, i) => cache.set(ptKey(p), z[i]));
    }
    return lists.map((pts) => pts.map((p) => cache.get(ptKey(p))));
  }

  // Elevation for several point lists at once, all from the SAME source so
  // routes stay comparable (never score one candidate on the terrain model
  // and another on the coarse DEM). Returns { source, elevs }.
  async function fetchElevations(lists) {
    if (lists.every(inNorway)) {
      try { return { source: "dtm", elevs: (await cachedHeights("dtm", lists, fetchElevationDTM)).map(fillGaps) }; }
      catch (e) { console.warn("Terrain model unavailable, using Open-Meteo:", e.message); }
    }
    return { source: "dem", elevs: await cachedHeights("dem", lists, fetchElevationDEM) };
  }

  // ---- routing (OSRM foot profile) ----
  // Returns an array of geometries (arrays of {lat,lng}); first is the primary
  // route. Each geometry also carries `.nodes`: the OSM node id at every
  // coordinate, so stairs can be matched exactly (see analysis.stairsAlong).
  async function osrmRoute(pts, alternatives) {
    const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson&annotations=nodes&alternatives=${alternatives ? "3" : "false"}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("routing " + r.status);
    const j = await r.json();
    if (j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error("no route");
    return j.routes.map((rt) => {
      const geom = rt.geometry.coordinates.map((c) => ({ lat: c[1], lng: c[0] }));
      // the overview geometry is the legs joined, each junction coordinate
      // once; only trust the ids if they line up one-to-one
      const ids = [];
      (rt.legs || []).forEach((leg, i) => {
        const n = (leg.annotation && leg.annotation.nodes) || [];
        ids.push(...(i ? n.slice(1) : n));
      });
      if (ids.length === geom.length) geom.nodes = ids.map(Number);
      return geom;
    });
  }

  // ---- stairs (Overpass: OSM highway=steps ways in a bbox) ----
  // Returns the stair ways as { nodes: [OSM ids], pts: [{lat,lng}], incline },
  // so routes can flag segments that descend steps — the most jarring thing
  // for knees. `incline` ("up"/"down"/a signed grade) is relative to the
  // way's node order; it's mapped on many steps and settles their direction
  // where the terrain model can't.
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
      .filter((el) => el.nodes && el.nodes.length > 1 && el.geometry && el.geometry.length === el.nodes.length)
      .map((el) => ({
        nodes: el.nodes,
        pts: el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })),
        incline: (el.tags && el.tags.incline) || null,
      }));
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

  ES.api = { fetchElevations, inNorway, osrmRoute, fetchStairs, geocode };
})();
