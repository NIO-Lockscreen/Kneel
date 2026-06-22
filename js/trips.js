/* EasyStride — curated Trondheim trip suggestions.
 *
 * A hand-picked guide to walks around Trondheim (lakes in Bymarka and
 * Estenstadmarka, plus a couple of flat city/coast paths). Each trip carries a
 * knee-friendliness `rating` used to colour and sort the list; the live
 * routing + elevation analysis still runs when a trip is opened, so the on-map
 * grade colours and (for loops) the recommended direction are real, not canned.
 *
 *   rating: "friendly" — flat / gentle, easy on sore knees
 *           "moderate" — mostly fine, a few short slopes; mind the direction
 *           "avoid"    — sustained steep descent; jarring on knees
 *
 * Coordinates are approximate points along each route; the OSM foot router
 * snaps them to real walking paths. */
;(function () {
  "use strict";
  const ES = (window.EasyStride = window.EasyStride || {});

  const RANK = { friendly: 0, moderate: 1, avoid: 2 };

  const trips = [
    {
      id: "haukvatnet",
      name: "Haukvatnet",
      area: "Bymarka",
      mode: "loop",
      rating: "friendly",
      dist: "~1.8 km",
      guide: "Flat, universally-designed gravel loop. Gentle in either direction — about as kind to knees as it gets.",
      points: [
        { lat: 63.3925, lng: 10.3445 },
        { lat: 63.3935, lng: 10.3475 },
        { lat: 63.3905, lng: 10.3485 },
        { lat: 63.3895, lng: 10.3450 },
      ],
    },
    {
      id: "theisendammen",
      name: "Theisendammen",
      area: "Bymarka",
      mode: "loop",
      rating: "friendly",
      dist: "~2.6 km",
      guide: "Reservoir loop on wide gravel roads with very little steep descent. A relaxed, knee-easy classic.",
      points: [
        { lat: 63.4055, lng: 10.3555 },
        { lat: 63.4060, lng: 10.3610 },
        { lat: 63.4025, lng: 10.3620 },
        { lat: 63.4020, lng: 10.3560 },
      ],
    },
    {
      id: "baklidammen",
      name: "Baklidammen",
      area: "Bymarka (city edge)",
      mode: "loop",
      rating: "friendly",
      dist: "~1.6 km",
      guide: "Small reservoir right above town — short, flat gravel loop. Easy to reach and easy on the joints.",
      points: [
        { lat: 63.4090, lng: 10.3760 },
        { lat: 63.4090, lng: 10.3805 },
        { lat: 63.4068, lng: 10.3800 },
        { lat: 63.4070, lng: 10.3762 },
      ],
    },
    {
      id: "estenstaddammen",
      name: "Estenstaddammen",
      area: "Estenstadmarka",
      mode: "loop",
      rating: "friendly",
      dist: "~2.0 km",
      guide: "Popular, gentle forest-lake loop on the east side of town. Smooth gradients all the way round.",
      points: [
        { lat: 63.3960, lng: 10.4680 },
        { lat: 63.3962, lng: 10.4725 },
        { lat: 63.3938, lng: 10.4730 },
        { lat: 63.3940, lng: 10.4685 },
      ],
    },
    {
      id: "ladestien",
      name: "Ladestien (coast path)",
      area: "Lade",
      mode: "ab",
      rating: "friendly",
      dist: "~3.8 km",
      guide: "Flat seaside path from Ladehammeren to Korsvika — sea views the whole way and almost no descent.",
      points: [
        { lat: 63.4520, lng: 10.4380 },
        { lat: 63.4485, lng: 10.4795 },
      ],
    },
    {
      id: "nidelvstien",
      name: "Nidelvstien (riverside)",
      area: "City · Nidelva",
      mode: "ab",
      rating: "friendly",
      dist: "~3.5 km",
      guide: "Flat, paved path along the river from Bakklandet up to Sluppen. Pram- and knee-friendly throughout.",
      points: [
        { lat: 63.4290, lng: 10.4030 },
        { lat: 63.4045, lng: 10.3940 },
      ],
    },
    {
      id: "lianvatnet",
      name: "Lianvatnet",
      area: "Bymarka · Lian",
      mode: "loop",
      rating: "moderate",
      dist: "~3.0 km",
      guide: "Scenic lake by Lian station. A few short slopes — open it as a loop and EasyStride will pick the gentler direction.",
      points: [
        { lat: 63.3975, lng: 10.3275 },
        { lat: 63.3970, lng: 10.3340 },
        { lat: 63.3945, lng: 10.3345 },
        { lat: 63.3950, lng: 10.3285 },
      ],
    },
    {
      id: "kyvatnet",
      name: "Kyvatnet",
      area: "Bymarka",
      mode: "loop",
      rating: "moderate",
      dist: "~3.5 km",
      guide: "Forest lake loop with rolling terrain. Pleasant, but expect one or two descents — mind the direction.",
      points: [
        { lat: 63.4035, lng: 10.2965 },
        { lat: 63.4035, lng: 10.3045 },
        { lat: 63.4000, lng: 10.3050 },
        { lat: 63.4005, lng: 10.2970 },
      ],
    },
    {
      id: "grakallen-descent",
      name: "Gråkallen descent",
      area: "Bymarka · Gråkallen",
      mode: "ab",
      rating: "avoid",
      dist: "~2.2 km",
      guide: "Long, sustained downhill off the Gråkallen high point toward Skistua. Hard on knees — if you do it, walk it UPHILL instead.",
      points: [
        { lat: 63.4115, lng: 10.2980 },
        { lat: 63.4070, lng: 10.3170 },
      ],
    },
    {
      id: "kristiansten-steps",
      name: "Kristiansten → Bakklandet steps",
      area: "City · Kristiansten",
      mode: "ab",
      rating: "avoid",
      dist: "~0.9 km",
      guide: "Steep stair-and-street descent from the fortress into Bakklandet. Jarring on knees — take a gentler street, or climb it rather than drop it.",
      points: [
        { lat: 63.4285, lng: 10.4115 },
        { lat: 63.4290, lng: 10.4025 },
      ],
    },
  ];

  function sorted() {
    return trips.slice().sort((a, b) => RANK[a.rating] - RANK[b.rating] || a.name.localeCompare(b.name));
  }

  ES.trips = { all: trips, sorted, RANK };
})();
