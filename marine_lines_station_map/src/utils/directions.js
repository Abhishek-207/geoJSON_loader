/**
 * Generate user-facing turn-by-turn directions from a path of nodes.
 *
 * The path is an array of ngraph nodes, each with `data.lng`/`data.lat`.
 * We segment the path by detecting bearing changes (turns) and emit
 * human-readable steps. We also note when the path passes near a vertical
 * circulation feature (stairs/escalator/lift) so the user is told to use it.
 */

const TURN_THRESHOLD_DEG = 25; // bearing change > this = a real turn
const SHARP_TURN_DEG = 60;
const VC_PROXIMITY_M = 8; // if a segment passes within this of stairs/lift, mention it

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const EARTH_R = 6371000;

function haversineM(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function bearingDeg(a, b) {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function turnDirection(prevBearing, nextBearing) {
  let diff = nextBearing - prevBearing;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  if (Math.abs(diff) < TURN_THRESHOLD_DEG) return null;
  const sharp = Math.abs(diff) >= SHARP_TURN_DEG;
  if (diff > 0) return sharp ? "sharp right" : "right";
  return sharp ? "sharp left" : "left";
}

/**
 * Polygon centroid for the {coordinates} of a Polygon geometry.
 */
function polygonCentroid(coords) {
  const ring = coords[0];
  const n = ring.length - 1;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += ring[i][0];
    cy += ring[i][1];
  }
  return [cx / n, cy / n];
}

/**
 * Find vertical-circulation features (stairs / escalator / lift) whose
 * centroid lies within VC_PROXIMITY_M of any path point.
 *
 * Returns an array of { name, kind, atIndex } where kind is "lift" |
 * "escalator" | "stairs" and atIndex is the path-point index closest to it.
 */
export function detectVerticalCirculation(pathCoords, structures) {
  const verticals = [];
  for (const f of structures.features || []) {
    const t = (f.properties?.type || "").toLowerCase();
    const c = (f.properties?.category || "").toLowerCase();
    let kind = null;
    if (t === "stairs" || c === "stairs" || c === "navigation") kind = "stairs";
    else if (t === "escalator" || c === "escalator") kind = "escalator";
    else if (t === "elevator" || t === "lift" || c === "vertical_circulation")
      kind = "lift";
    if (!kind) continue;

    if (f.geometry?.type !== "Polygon") continue;
    const cen = polygonCentroid(f.geometry.coordinates);

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < pathCoords.length; i++) {
      const d = haversineM(cen, pathCoords[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestDist <= VC_PROXIMITY_M) {
      verticals.push({
        name: f.properties.name || "",
        kind,
        atIndex: bestIdx,
        distM: bestDist,
      });
    }
  }
  // Order by path progression
  verticals.sort((a, b) => a.atIndex - b.atIndex);
  return verticals;
}

/**
 * Summarize which vertical-circulation options exist on a path. Used by the
 * Up/Down grid in the route card.
 */
export function summarizeVerticalCirculation(verticals) {
  const has = (kind) => verticals.some((v) => v.kind === kind);
  // We don't really know "up" vs "down" without floor metadata on path nodes,
  // so we mirror the same set in both columns. Whichever vertical option a
  // path uses going up, the user uses the same kind coming back down.
  const summary = {
    upLift: has("lift"),
    upEscalator: has("escalator"),
    upStairs: has("stairs"),
    downLift: has("lift"),
    downEscalator: has("escalator"),
    downStairs: has("stairs"),
  };
  return summary;
}

/**
 * Walking directions from a path of [lng, lat] coords.
 *
 * Algorithm:
 *  - Walk each segment and accumulate distance until a turn is detected.
 *  - At each turn, emit "Walk N m, then turn <dir>".
 *  - When passing near a vertical-circulation feature, splice in a
 *    "Take the <kind> (<name>)" step.
 *  - Final step is the arrival message.
 */
/**
 * Step shape: { type, title, detail?, distanceM? }
 *   type ∈ "start" | "walk" | "turn-left" | "turn-right" | "turn-sharp-left"
 *        | "turn-sharp-right" | "stairs" | "lift" | "escalator" | "arrive"
 */
export function generateDirections({
  pathCoords,
  destinationName,
  verticals = [],
}) {
  if (!pathCoords || pathCoords.length < 2) return [];
  const steps = [];

  const bearings = [];
  for (let i = 1; i < pathCoords.length; i++) {
    bearings.push(bearingDeg(pathCoords[i - 1], pathCoords[i]));
  }

  let leg = 0;
  let lastBearing = bearings[0];

  steps.push({
    type: "start",
    title: "Head out from the kiosk",
  });

  const verticalsByIndex = new Map();
  for (const v of verticals) verticalsByIndex.set(v.atIndex, v);

  const flushWalk = () => {
    if (leg > 0) {
      steps.push({
        type: "walk",
        title: "Walk forward",
        distanceM: Math.round(leg),
      });
      leg = 0;
    }
  };

  for (let i = 1; i < pathCoords.length; i++) {
    leg += haversineM(pathCoords[i - 1], pathCoords[i]);

    const turnAt =
      i < bearings.length ? turnDirection(lastBearing, bearings[i]) : null;

    if (verticalsByIndex.has(i)) {
      flushWalk();
      const v = verticalsByIndex.get(i);
      const titleByKind = {
        lift: "Take the lift",
        escalator: "Take the escalator",
        stairs: "Use the staircase",
      };
      steps.push({
        type: v.kind,
        title: titleByKind[v.kind] || "Take vertical circulation",
        detail: v.name || undefined,
      });
    }

    if (turnAt) {
      flushWalk();
      const map = {
        left: { type: "turn-left", title: "Turn left" },
        right: { type: "turn-right", title: "Turn right" },
        "sharp left": { type: "turn-sharp-left", title: "Turn sharp left" },
        "sharp right": { type: "turn-sharp-right", title: "Turn sharp right" },
      };
      steps.push(map[turnAt]);
      lastBearing = bearings[i];
    }
  }

  flushWalk();

  steps.push({
    type: "arrive",
    title: `Arrive at ${destinationName || "your destination"}`,
  });

  return dedupeAdjacent(steps);
}

function dedupeAdjacent(arr) {
  const out = [];
  for (const s of arr) {
    const prev = out[out.length - 1];
    if (prev && prev.type === s.type && prev.title === s.title) continue;
    out.push(s);
  }
  return out;
}
