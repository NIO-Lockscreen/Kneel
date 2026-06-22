/* EasyStride — curated Trondheim trip suggestions.
 *
 * These are hand-corrected loops with EXPLICIT waypoints (lat/lng) imported
 * from a verified GPX, so they load exactly where intended — no geocoding or
 * bounding-box guessing. Clicking a trip drops these waypoints and routes the
 * loop through them with the OSM foot router.
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
      mode: "loop", rating: "friendly", dist: "~1.7 km",
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
      mode: "loop", rating: "friendly", dist: "~1.6 km",
      guide: "Popular, gentle forest-lake loop on the east side of town. Smooth gradients all the way round.",
      waypoints: [
        { lat: 63.392341, lng: 10.487088 },
        { lat: 63.391742, lng: 10.489798 },
        { lat: 63.390545, lng: 10.489798 },
        { lat: 63.389946, lng: 10.487088 },
        { lat: 63.391742, lng: 10.484377 },
        { lat: 63.391091, lng: 10.484412 },
      ],
    },
    {
      id: "haukvatnet", name: "Haukvatnet", area: "Bymarka",
      mode: "loop", rating: "friendly", dist: "~3.3 km",
      guide: "Flat, universally-designed gravel loop. Gentle in either direction — about as kind to knees as it gets.",
      waypoints: [
        { lat: 63.395465, lng: 10.317299 },
        { lat: 63.392574, lng: 10.316184 },
        { lat: 63.390393, lng: 10.314875 },
        { lat: 63.390316, lng: 10.317600 },
        { lat: 63.392286, lng: 10.320239 },
        { lat: 63.393928, lng: 10.323007 },
        { lat: 63.394322, lng: 10.324895 },
        { lat: 63.394101, lng: 10.319788 },
      ],
    },
    {
      id: "theisendammen", name: "Theisendammen", area: "Bymarka",
      mode: "loop", rating: "friendly", dist: "~2.8 km",
      guide: "Reservoir loop on wide gravel roads with very little steep descent. A relaxed, knee-easy classic.",
      waypoints: [
        { lat: 63.422687, lng: 10.349486 },
        { lat: 63.423493, lng: 10.347362 },
        { lat: 63.422687, lng: 10.345924 },
        { lat: 63.422034, lng: 10.342791 },
        { lat: 63.420173, lng: 10.340581 },
        { lat: 63.419040, lng: 10.342212 },
        { lat: 63.419309, lng: 10.348585 },
        { lat: 63.421746, lng: 10.348649 },
      ],
    },
    {
      id: "lianvatnet", name: "Lianvatnet", area: "Bymarka · Lian",
      mode: "loop", rating: "moderate", dist: "~2.8 km",
      guide: "Scenic lake by Lian station. A few short slopes — opened as a loop, EasyStride picks the gentler direction.",
      waypoints: [
        { lat: 63.400645, lng: 10.322406 },
        { lat: 63.400126, lng: 10.322342 },
        { lat: 63.397927, lng: 10.318952 },
        { lat: 63.399435, lng: 10.315411 },
        { lat: 63.400741, lng: 10.313115 },
        { lat: 63.402661, lng: 10.316441 },
        { lat: 63.402959, lng: 10.319123 },
      ],
    },
    {
      id: "kyvatnet", name: "Kyvatnet", area: "Byåsen",
      mode: "loop", rating: "moderate", dist: "~3.6 km",
      guide: "Forest lake loop with rolling terrain. Pleasant, but expect one or two descents — mind the direction.",
      waypoints: [
        { lat: 63.403056, lng: 10.341911 },
        { lat: 63.403786, lng: 10.338736 },
        { lat: 63.405207, lng: 10.338521 },
        { lat: 63.407588, lng: 10.336611 },
        { lat: 63.408327, lng: 10.339766 },
        { lat: 63.407262, lng: 10.343177 },
        { lat: 63.405966, lng: 10.344529 },
        { lat: 63.405284, lng: 10.344379 },
      ],
    },
  ];

  function sorted() {
    return trips.slice().sort((a, b) => RANK[a.rating] - RANK[b.rating] || a.name.localeCompare(b.name));
  }

  ES.trips = { all: trips, sorted, RANK };
})();
