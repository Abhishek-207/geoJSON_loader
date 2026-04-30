# GeoJSON Extraction Guide

> This document defines the **exact GeoJSON format and conventions** we need for the creation of map data for our station navigation system.
> Follow this guide strictly so the exported data can be directly imported into the application without manual reformatting.

---

## Table of Contents

1. [Overview](#overview)
2. [Tools to use](#tools-to-use)
3. [File Format & Top-Level Structure](#file-format--top-level-structure)
4. [Coordinate System](#coordinate-system)
5. [Feature Categories & Required Properties](#feature-categories--required-properties)
   - [Buildings & Structures (Polygon)](#1-buildings--structures)
   - [Platforms (Polygon)](#2-platforms)
   - [Coaches (Polygon)](#3-coaches)
   - [Engines (Polygon)](#4-engines)
   - [Tracks (Polygon)](#5-tracks)
   - [Foot Overbridges / Walkways (Polygon)](#6-foot-overbridges--walkways)
   - [Staircases (Polygon)](#7-staircases)
   - [Elevators / Lifts (Polygon)](#8-elevators--lifts)
   - [Amenities — Entrances, Waiting Areas, Parking, Parks, etc. (Polygon)](#9-amenities)
   - [Navigation Nodes (Point)](#10-navigation-nodes)
   - [Navigation Edges (LineString)](#11-navigation-edges)
6. [Map View Configuration (Bounds & Camera)](#map-view-configuration-bounds--camera)
7. [Geometry Rules & Conventions](#geometry-rules--conventions)
8. [Naming & ID Conventions](#naming--id-conventions)
9. [Coordinate Precision](#coordinate-precision)
10. [Validation Checklist](#validation-checklist)
11. [Quick Reference — Complete Example](#quick-reference--complete-example)

---

## Overview

We build **3D indoor navigation maps** for railway stations (and similar large venues) using **MapLibre GL**. The GeoJSON data produce is the single source of truth for everything rendered on the map — building footprints, platforms, coaches, staircases, walkways, and the navigation graph used for pathfinding.

**What we need :**

- Accurately traced **polygons** for physical structures (buildings, platforms, staircases, etc.)
- **Point** markers for navigation nodes (key locations a user can navigate to/from)
- **LineString** features for navigation edges (walkable paths connecting nodes)

All of this goes into **one** GeoJSON file per station/venue.

---

## Tools to use

Any tool that can export valid GeoJSON is acceptable. Recommended options:

| Tool                 | Notes                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **QGIS**             | Full-featured GIS. Use the GeoJSON export option. Make sure CRS is set to **EPSG:4326 (WGS 84)**.                     |
| **geojson.io**       | Web-based, lightweight. Great for drawing polygons and points interactively on a satellite map. Export as `.geojson`. |
| **Google Earth Pro** | Can export KML; convert to GeoJSON using `ogr2ogr` or online converters.                                              |
| **Mapbox Studio**    | Can draw features interactively and export GeoJSON.                                                                   |

Regardless of tool, the final deliverable must be a **single `.geojson` or `.json` file** conforming to the structure below.

### Testing & Previewing GeoJSON

Before delivering, always preview GeoJSON on a map to visually verify correctness:

| Tool               | URL                                                               | What It Does                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GeoJSON Loader** | [geojson-loader.netlify.app](https://geojson-loader.netlify.app/) | Load a `.geojson` file directly or paste raw GeoJSON to instantly see it rendered on a map. Use this to verify shapes, positions, and coordinate accuracy before delivery. |
| **geojson.io**     | [geojson.io](https://geojson.io/)                                 | Draw, edit, and preview GeoJSON interactively on a satellite map. Also useful for quick validation.                                                                        |

**Recommended workflow:**  
After exporting from QGIS or any other tool → open [GeoJSON Loader](https://geojson-loader.netlify.app/) → drag-and-drop file or paste the raw JSON → confirm all polygons, points, and lines appear at the correct locations on the map.

---

## File Format & Top-Level Structure

The file must be a single **FeatureCollection** containing all features:

```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "properties": { ... }, "geometry": { ... } },
    { "type": "Feature", "properties": { ... }, "geometry": { ... } }
  ]
}
```

- `"type"` must be `"FeatureCollection"` at the top level.
- `"features"` is an array of `Feature` objects.
- Each `Feature` has exactly two fields: `"properties"` (metadata) and `"geometry"` (shape + coordinates).

---

## Coordinate System

| Setting              | Value                                                    |
| -------------------- | -------------------------------------------------------- |
| **CRS**              | **EPSG:4326 (WGS 84)** — this is the default for GeoJSON |
| **Coordinate Order** | **`[longitude, latitude]`** — NOT `[lat, lon]`           |
| **Longitude range**  | −180 to +180                                             |
| **Latitude range**   | −90 to +90                                               |

**Common mistake:** Many tools (Google Maps, etc.) show coordinates as `lat, lon`. GeoJSON requires the **opposite** order: `[lon, lat]`. Double-check this before delivery.

**Example for Mumbai area:**  
`[72.8195, 18.9708]` = longitude 72.8195°E, latitude 18.9708°N

---

## Feature Categories & Required Properties

Every feature must have a `"properties"` object with specific fields depending on the category. Below are all the categories we use.

---

### 1. Buildings & Structures

**Geometry type:** `Polygon`  
**What to trace:** Station building outlines, rooms, offices.

```json
{
  "type": "Feature",
  "properties": {
    "id": "main_building",
    "name": "Station Main Building",
    "type": "room",
    "category": "building",
    "floor": 0,
    "color": "#d4b896",
    "height": 12,
    "base": 0
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [72.8186, 18.9694],
        [72.8202, 18.9694],
        [72.8202, 18.971],
        [72.8186, 18.971],
        [72.8186, 18.9694]
      ]
    ]
  }
}
```

| Property   | Type   | Required | Description                                                                               |
| ---------- | ------ | -------- | ----------------------------------------------------------------------------------------- |
| `id`       | string | Yes      | Unique snake_case identifier (e.g. `main_building`, `parcel_office`)                      |
| `name`     | string | Yes      | Human-readable label                                                                      |
| `type`     | string | Yes      | Structural type: `"room"`, `"amenity"`                                                    |
| `category` | string | Yes      | `"building"`, `"parcel_office"`, `"booking_office"`, `"ticket_counter"`, `"kiosk_screen"` |
| `floor`    | number | Yes      | Floor level: `0` = ground, `1` = first floor / FOB level                                  |
| `color`    | string | Yes      | Hex color code for 3D rendering (e.g. `"#d4b896"`)                                        |
| `height`   | number | Yes      | Extrusion height in meters (how tall the 3D block appears)                                |
| `base`     | number | Yes      | Base elevation in meters (`0` for ground-level structures)                                |

---

### 2. Platforms

**Geometry type:** `Polygon`  
**What to trace:** The full footprint of each platform.

```json
{
  "type": "Feature",
  "properties": {
    "id": "platform_1",
    "name": "BCT Main Platform 1",
    "type": "platform",
    "category": "platform",
    "floor": 0,
    "color": "#b0b0b0",
    "height": 1.2,
    "base": 0
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[ ... ]]
  }
}
```

| Property   | Type   | Required | Description                                            |
| ---------- | ------ | -------- | ------------------------------------------------------ |
| `id`       | string | Yes      | `platform_1`, `platform_2`, `local_platform_1`, etc.   |
| `name`     | string | Yes      | e.g. `"BCT Main Platform 1"`, `"BCT Local Platform 1"` |
| `type`     | string | Yes      | Always `"platform"`                                    |
| `category` | string | Yes      | Always `"platform"`                                    |
| `floor`    | number | Yes      | Usually `0`                                            |
| `color`    | string | Yes      | Platform color (e.g. `"#b0b0b0"`)                      |
| `height`   | number | Yes      | Platform extrusion height                              |
| `base`     | number | Yes      | Usually `0`                                            |

---

### 3. Coaches

**Geometry type:** `Polygon`  
**What to trace:** Each individual coach position along a platform (small rectangular polygons).

```json
{
  "type": "Feature",
  "properties": {
    "id": "platform_1_coach_1",
    "name": "BCT Main Platform 1 Coach 1",
    "type": "coach",
    "category": "coach",
    "floor": 0,
    "color": "#FFD700",
    "height": 3.5,
    "base": 0,
    "coachNumber": 1,
    "platform": "platform_1"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[ ... ]]
  }
}
```

| Property      | Type   | Required | Description                                                        |
| ------------- | ------ | -------- | ------------------------------------------------------------------ |
| `id`          | string | Yes      | Format: `{platform_id}_coach_{number}` (e.g. `platform_1_coach_1`) |
| `name`        | string | Yes      | e.g. `"BCT Main Platform 1 Coach 1"`                               |
| `type`        | string | Yes      | Always `"coach"`                                                   |
| `category`    | string | Yes      | Always `"coach"`                                                   |
| `floor`       | number | Yes      | Usually `0`                                                        |
| `color`       | string | Yes      | Coach color (e.g. `"#FFD700"`)                                     |
| `height`      | number | Yes      | Coach extrusion height (e.g. `3.5`)                                |
| `base`        | number | Yes      | Usually `0`                                                        |
| `coachNumber` | number | Yes      | Sequential number: `1`, `2`, `3`, ...                              |
| `platform`    | string | Yes      | Parent platform ID (e.g. `"platform_1"`)                           |

---

### 4. Engines

**Geometry type:** `Polygon`  
**What to trace:** Engine position at the head of a train on each platform.

```json
{
  "type": "Feature",
  "properties": {
    "id": "platform_1_engine",
    "name": "Engine",
    "type": "engine",
    "category": "engine",
    "floor": 0,
    "color": "#8B4513",
    "height": 3.5,
    "base": 0,
    "platform": "platform_1"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[ ... ]]
  }
}
```

| Property   | Type   | Required | Description                    |
| ---------- | ------ | -------- | ------------------------------ |
| `id`       | string | Yes      | Format: `{platform_id}_engine` |
| `name`     | string | Yes      | `"Engine"`                     |
| `type`     | string | Yes      | Always `"engine"`              |
| `category` | string | Yes      | Always `"engine"`              |
| `floor`    | number | Yes      | Usually `0`                    |
| `color`    | string | Yes      | e.g. `"#8B4513"`               |
| `height`   | number | Yes      | Same as coaches (e.g. `3.5`)   |
| `base`     | number | Yes      | Usually `0`                    |
| `platform` | string | Yes      | Parent platform ID             |

---

### 5. Tracks

**Geometry type:** `Polygon`  
**What to trace:** The track/rail area between platforms.

```json
{
  "type": "Feature",
  "properties": {
    "id": "platform_track",
    "name": "Platform Track",
    "type": "track",
    "category": "track",
    "floor": 0,
    "color": "#404040",
    "height": 0.2,
    "base": 0
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[ ... ]]
  }
}
```

---

### 6. Foot Overbridges / Walkways

**Geometry type:** `Polygon`  
**What to trace:** Bridges connecting platforms at an elevated level, covered walkways.

```json
{
  "type": "Feature",
  "properties": {
    "id": "fob_center",
    "name": "Foot Overbridge Center (FOB)",
    "type": "bridge",
    "category": "fob",
    "floor": 1,
    "color": "#59717d",
    "height": 8,
    "base": 6
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[ ... ]]
  }
}
```

| Property   | Type   | Required | Description                                                         |
| ---------- | ------ | -------- | ------------------------------------------------------------------- |
| `id`       | string | Yes      | e.g. `fob_center`, `fob_south`, `fob_north`                         |
| `name`     | string | Yes      | Descriptive name                                                    |
| `type`     | string | Yes      | `"bridge"`                                                          |
| `category` | string | Yes      | `"fob"` or `"walkway"`                                              |
| `floor`    | number | Yes      | `1` for elevated structures                                         |
| `color`    | string | Yes      | e.g. `"#59717d"`                                                    |
| `height`   | number | Yes      | Top of extrusion (e.g. `8` meters)                                  |
| `base`     | number | Yes      | **Bottom of extrusion** (e.g. `6` — the bridge floats above ground) |

> **Important:** For elevated structures, `base` is the height at which the structure starts (e.g. `6` meters above ground), and `height` is where it ends (e.g. `8` meters). This makes the bridge appear to float.

---

### 7. Staircases

**Geometry type:** `Polygon`  
**What to trace:** The rectangular footprint of each staircase.

```json
{
  "type": "Feature",
  "properties": {
    "id": "staircase_1",
    "name": "Staircase 1",
    "type": "stairs",
    "category": "navigation",
    "floor_from": 0,
    "floor_to": 1,
    "accessible": false,
    "color": "#089c8d",
    "height": 8,
    "base": 0
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[ ... ]]
  }
}
```

| Property     | Type    | Required | Description                           |
| ------------ | ------- | -------- | ------------------------------------- |
| `id`         | string  | Yes      | `staircase_1`, `staircase_2`, etc.    |
| `name`       | string  | Yes      | `"Staircase 1"`, etc.                 |
| `type`       | string  | Yes      | `"stairs"`                            |
| `category`   | string  | Yes      | `"navigation"`                        |
| `floor_from` | number  | Yes      | Starting floor level (e.g. `0`)       |
| `floor_to`   | number  | Yes      | Ending floor level (e.g. `1`)         |
| `accessible` | boolean | Yes      | `false` for stairs, `true` for ramps  |
| `color`      | string  | Yes      | e.g. `"#089c8d"`                      |
| `height`     | number  | Yes      | Top height of the staircase extrusion |
| `base`       | number  | Yes      | Bottom of extrusion                   |

---

### 8. Elevators / Lifts

**Geometry type:** `Polygon`  
**What to trace:** The footprint of each elevator shaft.

```json
{
  "type": "Feature",
  "properties": {
    "id": "elevator_1",
    "name": "Lift 1",
    "type": "elevator",
    "category": "vertical_circulation",
    "floor_from": 0,
    "floor_to": 1,
    "accessible": true,
    "color": "#4169E1",
    "height": 8,
    "base": 0
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[ ... ]]
  }
}
```

| Property     | Type    | Required | Description                      |
| ------------ | ------- | -------- | -------------------------------- |
| `id`         | string  | Yes      | `elevator_1`, `elevator_2`, etc. |
| `name`       | string  | Yes      | `"Lift 1"`, etc.                 |
| `type`       | string  | Yes      | `"elevator"`                     |
| `category`   | string  | Yes      | `"vertical_circulation"`         |
| `floor_from` | number  | Yes      | Lower floor                      |
| `floor_to`   | number  | Yes      | Upper floor                      |
| `accessible` | boolean | Yes      | Typically `true` for elevators   |
| `color`      | string  | Yes      | e.g. `"#4169E1"`                 |
| `height`     | number  | Yes      | Top height                       |
| `base`       | number  | Yes      | Base elevation                   |

---

### 9. Amenities

**Geometry type:** `Polygon`  
**What to trace:** Entrances, waiting areas, parking lots, parks, kiosk screens, ticket counters, booking offices, parcel offices.

```json
{
  "type": "Feature",
  "properties": {
    "id": "waiting_area",
    "name": "Waiting Area",
    "type": "amenity",
    "category": "waiting_area",
    "floor": 0,
    "color": "#4CAF50",
    "height": 4,
    "base": 0
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[ ... ]]
  }
}
```

Supported amenity categories:

| `category` value   | Examples                            |
| ------------------ | ----------------------------------- |
| `"entrance"`       | Main entrance, side exits           |
| `"waiting_area"`   | Passenger waiting halls             |
| `"parking"`        | Vehicle parking areas               |
| `"park"`           | Parks, green spaces                 |
| `"kiosk_screen"`   | Information kiosks, display screens |
| `"ticket_counter"` | Manual ticket counters              |
| `"booking_office"` | PRS/ticket booking offices          |
| `"parcel_office"`  | Parcel/luggage offices              |

---

### 10. Navigation Nodes

**Geometry type:** `Point`  
**What to mark:** Key locations that a user can navigate to or from. One point per important location.

```json
{
  "type": "Feature",
  "properties": {
    "type": "nav_node",
    "id": "n_platform_1",
    "name": "BCT Main Platform 1",
    "floor": 0
  },
  "geometry": {
    "type": "Point",
    "coordinates": [72.8194, 18.9705]
  }
}
```

| Property | Type   | Required | Description                                                                                 |
| -------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| `type`   | string | Yes      | Always `"nav_node"`                                                                         |
| `id`     | string | Yes      | **Must start with `n_`** prefix (e.g. `n_platform_1`, `n_waiting_area`, `n_stair_1_ground`) |
| `name`   | string | Yes      | Human-readable name shown to users                                                          |
| `floor`  | number | Yes      | `0` = ground, `1` = FOB level                                                               |

**Where to place nav_nodes:**

- Center of each platform
- At each entrance/exit
- At each staircase (one node at ground level, one at FOB level)
- At each elevator (one node at ground level, one at FOB level)
- At each amenity (waiting area, ticket counter, etc.)
- At key coach positions (for coach-level navigation)

**ID naming for vertical circulation nodes:**

- Ground-level stair node: `n_stair_1_ground`
- FOB-level stair node: `n_stair_1_fob`
- Ground-level lift node: `n_lift_1_ground`
- FOB-level lift node: `n_lift_1_fob`

---

### 11. Navigation Edges

**Geometry type:** `LineString`  
**What to draw:** Walkable paths connecting two navigation nodes.

```json
{
  "type": "Feature",
  "properties": {
    "type": "nav_edge",
    "source": "n_main_entrance",
    "target": "n_waiting_area",
    "weight": 4,
    "description": "Walk from Main Entrance to Waiting Area"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [72.81985, 18.96958],
      [72.81914, 18.96976]
    ]
  }
}
```

| Property      | Type   | Required | Description                                                        |
| ------------- | ------ | -------- | ------------------------------------------------------------------ |
| `type`        | string | Yes      | Always `"nav_edge"`                                                |
| `source`      | string | Yes      | ID of the starting nav_node (must match an existing `nav_node` id) |
| `target`      | string | Yes      | ID of the ending nav_node                                          |
| `weight`      | number | Yes      | Relative walking cost/distance (integer, higher = longer/harder)   |
| `description` | string | Yes      | Human-readable: `"Walk from {source_name} to {target_name}"`       |

**Rules:**

- The first coordinate must match the `source` node's coordinates.
- The last coordinate must match the `target` node's coordinates.
- For simple straight-line connections, use just 2 coordinate pairs.
- For paths that follow a curve or corridor, add intermediate waypoints.
- Navigation edges are treated as **bidirectional** — only need to define each connection once.

---

## Map View Configuration (Bounds & Camera)

Apart from the GeoJSON features, we also need **two pieces of spatial metadata** for every station/venue. These tell the app where to point the camera and how far users can pan.

### 1. Initial View State (Camera Position)

This defines where the map camera is centered when the app first loads.

```json
{
  "longitude": 72.8193,
  "latitude": 18.9688,
  "zoom": 18,
  "pitch": 45,
  "bearing": 270
}
```

| Field       | Type   | Description                                                                                                                        |
| ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `longitude` | number | Center longitude of the venue                                                                                                      |
| `latitude`  | number | Center latitude of the venue                                                                                                       |
| `zoom`      | number | Zoom level. `18` is typical for station-level detail. Range: `0` (whole world) to `22` (building-level).                           |
| `pitch`     | number | Camera tilt in degrees. `0` = top-down, `45` = angled 3D view, `60` = very tilted. Use `45` for 3D station maps.                   |
| `bearing`   | number | Camera rotation in degrees. `0` = north-up. Adjust so the station layout looks natural (e.g. `270` if the station runs east-west). |

**How to determine these values:**

1. Open GeoJSON in [geojson.io](https://geojson.io/) or [GeoJSON Loader](https://geojson-loader.netlify.app/).
2. Navigate the map so the entire station/venue is nicely visible and centered.
3. Note the center coordinate (longitude, latitude) from the map view.
4. We will fine-tune `zoom`, `pitch`, and `bearing` on our end — but provide a reasonable starting point.

### 2. Map Bounds (Bounding Box)

This restricts how far users can pan away from the station. It's a rectangle defined by 4 coordinates:

```json
{
  "bounds": [72.817, 18.967, 72.8225, 18.9741]
}
```

The order is: **`[west, south, east, north]`** which means **`[minLongitude, minLatitude, maxLongitude, maxLatitude]`**.

```
         north (maxLat)
          ┌──────────┐
          │          │
west      │  STATION │      east
(minLon)  │          │   (maxLon)
          └──────────┘
         south (minLat)
```

| Index | Field                 | Description                                             |
| ----- | --------------------- | ------------------------------------------------------- |
| 0     | `west` (minLongitude) | Left boundary — the westernmost longitude of the area   |
| 1     | `south` (minLatitude) | Bottom boundary — the southernmost latitude of the area |
| 2     | `east` (maxLongitude) | Right boundary — the easternmost longitude of the area  |
| 3     | `north` (maxLatitude) | Top boundary — the northernmost latitude of the area    |

**How to determine bounds:**

1. Open GeoJSON in [geojson.io](https://geojson.io/) or [GeoJSON Loader](https://geojson-loader.netlify.app/).
2. Identify the **outermost features** of the station (the features furthest in each direction).
3. Add some padding beyond those — roughly **50–100 meters** of extra space on each side so the map doesn't feel cramped.
4. Record the 4 corner values.

**Alternatively in QGIS:**

1. Select all features → right-click layer → "Zoom to Layer".
2. Read the extent from the bottom status bar or via `Layer Properties → Information → Extent`.
3. Add padding to each side.

### How to Deliver This

Include these values in a separate small JSON file alongside the main GeoJSON, or in a clearly marked section at the top of delivery notes:

```json
{
  "venue_name": "Mumbai Central Station",
  "initial_view": {
    "longitude": 72.8193,
    "latitude": 18.9688,
    "zoom": 18,
    "pitch": 45,
    "bearing": 270
  },
  "bounds": [72.817, 18.967, 72.8225, 18.9741]
}
```

> **This is required for every station/venue.** Without bounds and initial view, we cannot configure the map correctly.

---

## Geometry Rules & Conventions

### Polygon Rules

1. **Coordinates are nested three levels deep:**  
   `coordinates: [ [ [lon, lat], [lon, lat], ... ] ]`
   - Outer array = list of rings
   - First ring = outer boundary
   - Additional rings = holes (rarely needed)

2. **Rings must be closed:**  
   The first and last coordinate pair in every ring **must be identical**.

3. **Minimum points:**  
   A polygon needs at least **4 coordinate pairs** (3 distinct corners + 1 closing = triangle). Rectangles have **5** pairs (4 corners + closing).

4. **Winding order:**  
   Outer rings should follow **counter-clockwise** order (right-hand rule). Holes should be clockwise. Most tools handle this automatically.

### Point Rules

1. **Coordinates are a single pair:**  
   `coordinates: [lon, lat]`

2. Place points at the **center** or most meaningful location of what they represent.

### LineString Rules

1. **Coordinates are an array of pairs:**  
   `coordinates: [ [lon, lat], [lon, lat], ... ]`

2. Minimum **2 coordinate pairs** (start and end).

3. The line is **not closed** (unlike polygons — start and end can differ).

---

## Naming & ID Conventions

| Rule                                                   | Example                                    |
| ------------------------------------------------------ | ------------------------------------------ |
| Use **snake_case** for all IDs                         | `platform_1`, `fob_center`, `staircase_12` |
| Navigation node IDs start with **`n_`**                | `n_platform_1`, `n_stair_1_ground`         |
| Coach IDs follow **`{platform_id}_coach_{number}`**    | `platform_3_coach_12`                      |
| Engine IDs follow **`{platform_id}_engine`**           | `platform_1_engine`                        |
| Staircase IDs are sequential: **`staircase_{number}`** | `staircase_1` through `staircase_27`       |
| Elevator IDs are sequential: **`elevator_{number}`**   | `elevator_1` through `elevator_8`          |
| IDs must be **unique** across the entire file          | No duplicates allowed                      |

---

## Coordinate Precision

- Use **at least 5 decimal places** for longitude and latitude.  
  At the equator, 5 decimal places ≈ 1.1 meter accuracy. For station-level mapping, **6–8 decimal places** is preferred.
- Do not round coordinates below 5 decimal places.

| Decimal Places | Approximate Accuracy |
| -------------- | -------------------- |
| 4              | ~11 meters           |
| 5              | ~1.1 meters          |
| 6              | ~0.11 meters         |
| 7              | ~0.011 meters        |

---

## Validation Checklist

Before delivering the GeoJSON file, verify:

- [ ] File is valid JSON (paste into [jsonlint.com](https://jsonlint.com/) to check)
- [ ] Top-level `type` is `"FeatureCollection"`
- [ ] Every feature has `"type": "Feature"`
- [ ] Every feature has both `"properties"` and `"geometry"` fields
- [ ] Coordinate order is `[longitude, latitude]` — NOT `[latitude, longitude]`
- [ ] All Polygon rings are **closed** (first coordinate == last coordinate)
- [ ] All IDs are **unique** across the file
- [ ] All nav*node IDs start with `n*`
- [ ] All nav_edge `source` and `target` values reference existing nav_node IDs
- [ ] nav_edge LineString start coordinate matches source node, end coordinate matches target node
- [ ] All required properties are present for each category (see tables above)
- [ ] Colors are valid hex codes (e.g. `"#FFD700"`)
- [ ] `height` and `base` values are reasonable numbers in meters
- [ ] CRS is EPSG:4326 (WGS 84) — this is the GeoJSON default; do not include a `"crs"` field
- [ ] **Map view config** is provided: initial view (center lon/lat, zoom, pitch, bearing) and bounds (`[west, south, east, north]`)
- [ ] Bounds have adequate padding (~50–100m) around the outermost features
- [ ] Paste into [geojson.io](https://geojson.io/) or [GeoJSON Loader](https://geojson-loader.netlify.app/) and visually verify shapes appear at the correct location

---

## Quick Reference — Complete Example

A minimal but complete file with one of each feature type:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": "main_building",
        "name": "Station Main Building",
        "type": "room",
        "category": "building",
        "floor": 0,
        "color": "#d4b896",
        "height": 12,
        "base": 0
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [72.8186, 18.9694],
            [72.8202, 18.9694],
            [72.8202, 18.971],
            [72.8186, 18.971],
            [72.8186, 18.9694]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "platform_1",
        "name": "BCT Main Platform 1",
        "type": "platform",
        "category": "platform",
        "floor": 0,
        "color": "#b0b0b0",
        "height": 1.2,
        "base": 0
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [72.8191, 18.9699],
            [72.8192, 18.9699],
            [72.8192, 18.972],
            [72.8191, 18.972],
            [72.8191, 18.9699]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "platform_1_coach_1",
        "name": "BCT Main Platform 1 Coach 1",
        "type": "coach",
        "category": "coach",
        "floor": 0,
        "color": "#FFD700",
        "height": 3.5,
        "base": 0,
        "coachNumber": 1,
        "platform": "platform_1"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [72.81914, 18.97003],
            [72.81916, 18.97003],
            [72.81916, 18.97013],
            [72.81914, 18.97013],
            [72.81914, 18.97003]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "fob_center",
        "name": "Foot Overbridge Center",
        "type": "bridge",
        "category": "fob",
        "floor": 1,
        "color": "#59717d",
        "height": 8,
        "base": 6
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [72.81856, 18.97094],
            [72.82016, 18.9708],
            [72.82016, 18.97076],
            [72.81856, 18.9709],
            [72.81856, 18.97094]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "id": "staircase_1",
        "name": "Staircase 1",
        "type": "stairs",
        "category": "navigation",
        "floor_from": 0,
        "floor_to": 1,
        "accessible": false,
        "color": "#089c8d",
        "height": 8,
        "base": 0
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [72.81949, 18.97085],
            [72.8195, 18.97098],
            [72.81951, 18.97098],
            [72.8195, 18.97085],
            [72.81949, 18.97085]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "type": "nav_node",
        "id": "n_platform_1",
        "name": "BCT Main Platform 1",
        "floor": 0
      },
      "geometry": {
        "type": "Point",
        "coordinates": [72.8194, 18.9705]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "type": "nav_node",
        "id": "n_stair_1_ground",
        "name": "Staircase 1 (Ground)",
        "floor": 0
      },
      "geometry": {
        "type": "Point",
        "coordinates": [72.8195, 18.9709]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "type": "nav_edge",
        "source": "n_platform_1",
        "target": "n_stair_1_ground",
        "weight": 3,
        "description": "Walk from BCT Main Platform 1 to Staircase 1"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [72.8194, 18.9705],
          [72.8195, 18.9709]
        ]
      }
    }
  ]
}
```

---

## Delivery Format

Each station/venue delivery must include **two things**:

| #   | File                                              | Contents                                                                                                 |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `station_data.json` (or `{venue_name}_data.json`) | The main GeoJSON `FeatureCollection` with all features                                                   |
| 2   | `map_config.json` (or included in delivery notes) | Initial view state + bounding box (see [Map View Configuration](#map-view-configuration-bounds--camera)) |

**Requirements:**

- **Encoding:** UTF-8
- **One file per station/venue** containing all features
- **No extra wrappers** — just the raw FeatureCollection as shown above
- **Map config must be provided** — without bounds and initial camera, we cannot set up the map

If the GeoJSON file is too large to work with in one go, it can be split into separate files per category (e.g. `platforms.geojson`, `navigation.geojson`) and we will merge them. Communicate this in advance.
