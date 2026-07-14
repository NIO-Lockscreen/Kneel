# EasyStride

Knee-friendly walks in Trondheim. EasyStride finds the walking route with the
**least steep downhill** — the part of a walk that hurts sore knees most — and,
for loops, tells you which **direction** spares your knees.

## Features

- **A → B** routing or **Loop** (pick the gentler direction around a lake).
- Tap points on the map **or type start/destination addresses** (geocoded via
  Nominatim, biased to the Trondheim area).
- **Direction advice everywhere**: loops recommend the gentler way round, and
  A → B tells you when walking the same route **the other way (B → A)** would
  cut the steep descent — handy if you can start from either end.
- **Wider route search**: besides the router's own alternatives, EasyStride
  probes **side-path detours** (via-points pushed out to each side of the
  direct line), so "Suggest a gentler route" has real options even where the
  router returns just one path.
- **Stairs detection**: flags OpenStreetMap `highway=steps` on the route (via
  Overpass) and treats **descending stairs** as the most jarring thing a knee
  can meet — they're drawn **dashed red** on the map and profile, counted in
  the knee load, and called out in the recommendation.
- **Pain threshold** slider: choose what down-grade counts as "painful".
- **Acceptable detour** slider + **Suggest a gentler route** button: trade a bit
  of extra distance for less steep descent, capped at the detour you allow.
  Near-ties in knee load go to the **shorter** route, so a barely-gentler
  option never drags in a long detour.
- **"Avoid steep downhill at almost any cost"** toggle: lifts the detour cap
  and searches wider (extra via-point candidates), for days when the knees
  simply won't take a descent.
- Colour-coded route + elevation profile, plus distance / climb / descent /
  time / max-grade stats.

## Run locally

It's a static site with no build step. Either open `index.html` directly, or
serve the folder (recommended, so the routing/elevation/geocoding APIs and tile
servers behave consistently):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to Vercel

The repo deploys as a static site with **zero configuration** — Vercel serves
`index.html` and the `css/` + `js/` assets directly.

```bash
npm i -g vercel   # if needed
vercel            # preview deploy
vercel --prod     # production deploy
```

Or import the repo at [vercel.com/new](https://vercel.com/new) and deploy. The
included `vercel.json` just enables clean URLs and a couple of safe headers.

## Project layout

```
index.html        markup + script/style includes
css/styles.css    all styling
js/core.js        namespace, config, app state, DOM helpers
js/geo.js         geometry helpers (haversine, bearing, resample, smooth)
js/api.js         routing (OSRM foot), elevation (Open-Meteo), geocoding (Nominatim)
js/analysis.js    route scoring + gentlest-within-detour selection
js/ui.js          map drawing, elevation profile, stats, recommendation card
js/app.js         map init, waypoint flow, controls, orchestration
```

The JS files are plain (non-module) scripts that share a `window.EasyStride`
namespace, so they work both from `file://` and when deployed.

## Data & disclaimer

Routing: OSM foot profile (routing.openstreetmap.de). Elevation: Open-Meteo DEM
(~30 m). Stairs: OpenStreetMap via Overpass. Geocoding: Nominatim
(OpenStreetMap). Planning aid only — not medical advice. Grades from public
elevation data can be noisy on short segments.
