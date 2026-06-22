/* EasyStride — curated Trondheim trip suggestions.
 *
 * Trips are defined by PLACE NAMES, not hard-coded coordinates: when a trip is
 * opened the app geocodes the name(s) live (OpenStreetMap / Nominatim) to get
 * the real location, then — for lake loops — builds a ring of waypoints around
 * the lake centre so the OSM foot router traces the actual lakeside paths.
 * This keeps the routes accurate without me guessing latitudes by hand.
 *
 *   loop trips:  { query, radius }     radius = approx lake radius in metres
 *   A→B trips:   { from, to }          two place-name endpoints
 *
 *   rating: "friendly" — flat / gentle, easy on sore knees
 *           "moderate" — mostly fine, a few short slopes; mind the direction
 *           "avoid"    — sustained steep descent; jarring on knees */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  const RANK = { friendly: 0, moderate: 1, avoid: 2 };

  const trips = [
    {
      id: "haukvatnet", name: "Haukvatnet", area: "Bymarka",
      mode: "loop", query: "Haukvatnet, Trondheim", radius: 280,
      rating: "friendly", dist: "~1.8 km",
      guide: "Flat, universally-designed gravel loop. Gentle in either direction — about as kind to knees as it gets.",
    },
    {
      id: "theisendammen", name: "Theisendammen", area: "Bymarka",
      mode: "loop", query: "Theisendammen, Trondheim", radius: 320,
      rating: "friendly", dist: "~2.6 km",
      guide: "Reservoir loop on wide gravel roads with very little steep descent. A relaxed, knee-easy classic.",
    },
    {
      id: "baklidammen", name: "Baklidammen", area: "Bymarka (city edge)",
      mode: "loop", query: "Baklidammen, Trondheim", radius: 220,
      rating: "friendly", dist: "~1.6 km",
      guide: "Small reservoir right above town — short, flat gravel loop. Easy to reach and easy on the joints.",
    },
    {
      id: "estenstaddammen", name: "Estenstaddammen", area: "Estenstadmarka",
      mode: "loop", query: "Estenstaddammen, Trondheim", radius: 260,
      rating: "friendly", dist: "~2.0 km",
      guide: "Popular, gentle forest-lake loop on the east side of town. Smooth gradients all the way round.",
    },
    {
      id: "ladestien", name: "Ladestien (coast path)", area: "Lade",
      mode: "ab", from: "Ladehammeren, Trondheim", to: "Korsvika, Trondheim",
      rating: "friendly", dist: "~3.8 km",
      guide: "Flat seaside path along the Lade peninsula — sea views the whole way and almost no descent.",
    },
    {
      id: "nidelvstien", name: "Nidelvstien (riverside)", area: "City · Nidelva",
      mode: "ab", from: "Bakklandet, Trondheim", to: "Sluppen, Trondheim",
      rating: "friendly", dist: "~3.5 km",
      guide: "Flat, paved path along the river from Bakklandet up to Sluppen. Pram- and knee-friendly throughout.",
    },
    {
      id: "lianvatnet", name: "Lianvatnet", area: "Bymarka · Lian",
      mode: "loop", query: "Lianvatnet, Trondheim", radius: 320,
      rating: "moderate", dist: "~3.0 km",
      guide: "Scenic lake by Lian station. A few short slopes — opened as a loop, EasyStride picks the gentler direction.",
    },
    {
      id: "kyvatnet", name: "Kyvatnet", area: "Byåsen",
      mode: "loop", query: "Kyvatnet, Trondheim", radius: 340,
      rating: "moderate", dist: "~3.5 km",
      guide: "Forest lake loop with rolling terrain. Pleasant, but expect one or two descents — mind the direction.",
    },
    {
      id: "grakallen-descent", name: "Gråkallen descent", area: "Bymarka · Gråkallen",
      mode: "ab", from: "Gråkallen, Trondheim", to: "Skistua, Trondheim",
      rating: "avoid", dist: "~2.2 km",
      guide: "Long, sustained downhill off the Gråkallen high point toward Skistua. Hard on knees — if you do it, walk it UPHILL instead.",
    },
    {
      id: "kristiansten-steps", name: "Kristiansten → Bakklandet", area: "City · Kristiansten",
      mode: "ab", from: "Kristiansten festning, Trondheim", to: "Bakklandet, Trondheim",
      rating: "avoid", dist: "~0.9 km",
      guide: "Steep stair-and-street descent from the fortress into Bakklandet. Jarring on knees — climb it rather than drop it.",
    },
  ];

  function sorted() {
    return trips.slice().sort((a, b) => RANK[a.rating] - RANK[b.rating] || a.name.localeCompare(b.name));
  }

  ES.trips = { all: trips, sorted, RANK };
})();
