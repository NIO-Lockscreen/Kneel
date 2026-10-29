/* EasyStride — curated Trondheim trip suggestions.
 *
 * These are hand-corrected loops with EXPLICIT waypoints (lat/lng) imported
 * from a verified GPX, so they load exactly where intended — no geocoding or
 * bounding-box guessing. Clicking a trip drops these waypoints and routes the
 * loop through them with the OSM foot router.
 *
 * Waypoints must sit ON the walked path: one a few metres off it makes the
 * router walk out to it and back (a spur that adds fake descents). Those
 * were moved onto the loop; Estenstaddammen, whose old points were a
 * bounding-box hexagon up to 36 m off any path, was re-traced along the
 * shoreline paths in OpenStreetMap. Distances are the routed loop lengths.
 *
 *   rating: "friendly" — flat / gentle, easy on sore knees
 *           "moderate" — mostly fine, a few short slopes; mind the direction */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  const RANK = { friendly: 0, moderate: 1, avoid: 2 };

  const trips = [
    {
      id: "baklidammen", name: "Baklidammen", area: "Bymarka (city edge)",
      mode: "loop", rating: "friendly", dist: "~1.6 km",
      guide: "Small reservoir right above town — short, flat gravel loop. Easy to reach and easy on the joints.",
      waypoints: [
        { lat: 63.417418, lng: 10.323061 },
        { lat: 63.419549, lng: 10.325754 },
        { lat: 63.420249, lng: 10.319767 },
        { lat: 63.418411, lng: 10.316559 },
      ],
    },
    {
      id: "estenstaddammen", name: "Estenstaddammen", area: "Estenstadmarka",
      mode: "loop", rating: "friendly", dist: "~0.9 km",
      guide: "Popular, gentle forest-lake loop on the east side of town. Smooth gradients all the way round.",
      waypoints: [
        { lat: 63.392194, lng: 10.487965 },
        { lat: 63.391950, lng: 10.490058 },
        { lat: 63.390976, lng: 10.489307 },
        { lat: 63.390505, lng: 10.488002 },
        { lat: 63.390248, lng: 10.486216 },
        { lat: 63.391427, lng: 10.484354 },
        { lat: 63.391624, lng: 10.484451 },
        { lat: 63.392174, lng: 10.487274 },
      ],
    },
    {
      id: "haukvatnet", name: "Haukvatnet", area: "Bymarka",
      mode: "loop", rating: "friendly", dist: "~2.1 km",
      guide: "Flat, universally-designed gravel loop. Gentle in either direction — about as kind to knees as it gets.",
      waypoints: [
        { lat: 63.395465, lng: 10.317299 },
        { lat: 63.392574, lng: 10.316184 },
        { lat: 63.390393, lng: 10.314875 },
        { lat: 63.390304, lng: 10.317409 },
        { lat: 63.392286, lng: 10.320239 },
        { lat: 63.393862, lng: 10.323006 },
        { lat: 63.394322, lng: 10.324895 },
        { lat: 63.394101, lng: 10.319788 },
      ],
    },
    {
      id: "theisendammen", name: "Theisendammen", area: "Bymarka",
      mode: "loop", rating: "friendly", dist: "~1.9 km",
      guide: "Reservoir loop on wide gravel roads with very little steep descent. A relaxed, knee-easy classic.",
      waypoints: [
        { lat: 63.422687, lng: 10.349486 },
        { lat: 63.423493, lng: 10.347362 },
        { lat: 63.422687, lng: 10.345924 },
        { lat: 63.422034, lng: 10.342791 },
        { lat: 63.420173, lng: 10.340581 },
        { lat: 63.419040, lng: 10.342212 },
        { lat: 63.419309, lng: 10.348585 },
        { lat: 63.421808, lng: 10.348648 },
      ],
    },
    {
      id: "lianvatnet", name: "Lianvatnet", area: "Bymarka · Lian",
      mode: "loop", rating: "moderate", dist: "~1.8 km",
      guide: "Scenic lake by Lian station. A few short slopes — opened as a loop, EasyStride picks the gentler direction.",
      waypoints: [
        { lat: 63.400645, lng: 10.322406 },
        { lat: 63.400126, lng: 10.322342 },
        { lat: 63.397927, lng: 10.318952 },
        { lat: 63.399435, lng: 10.315411 },
        { lat: 63.400741, lng: 10.313115 },
        { lat: 63.402652, lng: 10.316404 },
        { lat: 63.402959, lng: 10.319123 },
      ],
    },
    {
      id: "kyvatnet", name: "Kyvatnet", area: "Byåsen",
      mode: "loop", rating: "moderate", dist: "~2.3 km",
      guide: "Forest lake loop with rolling terrain. Pleasant, but expect one or two descents — mind the direction.",
      waypoints: [
        { lat: 63.403056, lng: 10.341911 },
        { lat: 63.403786, lng: 10.338736 },
        { lat: 63.405207, lng: 10.338521 },
        { lat: 63.408411, lng: 10.337069 },
        { lat: 63.408327, lng: 10.339766 },
        { lat: 63.407262, lng: 10.343177 },
        { lat: 63.405966, lng: 10.344529 },
        { lat: 63.405291, lng: 10.344334 },
      ],
    },
  ];

  function sorted() {
    return trips.slice().sort((a, b) => RANK[a.rating] - RANK[b.rating] || a.name.localeCompare(b.name));
  }

  ES.trips = { all: trips, sorted, RANK };
})();
