/**
 * Structure-aware GeoJSON processor.
 *
 * Detects features whose properties indicate they are staircases, escalators,
 * FOBs, lifts, or platforms and transforms them so MapLibre can render them
 * with the correct 3-D appearance (stepped extrusions, elevated bridges, etc.).
 *
 * Detection relies on the feature's `type` or `name` property:
 *   stairs / staircase  → stepped extrusion
 *   escalator           → stepped extrusion
 *   fob / bridge        → elevated solid extrusion
 *   lift / elevator     → solid shaft extrusion
 *   platform            → solid extrusion (low height)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const interpolate = (p1, p2, ratio) => [
  p1[0] + (p2[0] - p1[0]) * ratio,
  p1[1] + (p2[1] - p1[1]) * ratio,
];

const addVector = (p, v, scale = 1) => [
  p[0] + v[0] * scale,
  p[1] + v[1] * scale,
];

/**
 * Rotate a polygon's coordinate ring 180° around its centroid.
 * Effectively flips which end of the polygon is "top" vs "bottom" for stairs.
 */
function rotateRing180(ring) {
  let cx = 0, cy = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    cx += ring[i][0];
    cy += ring[i][1];
  }
  cx /= n;
  cy /= n;
  return ring.map((c) => [2 * cx - c[0], 2 * cy - c[1]]);
}

// Names of staircases that need their direction reversed (data-side quirk
// where the polygon was drawn pointing the wrong way).
const FLIPPED_STAIRCASE_NAMES = new Set([
  "Staircase 2",
  "Staircase 3",
  "Staircase 4",
  "Staircase 5",
  "Staircase 9",
  "Staircase 10",
  "Staircase 11",
  "Staircase 12",
  "Staircase 13",
]);

/**
 * Scale a polygon geometry outward from its centroid.
 */
function scalePolygon(geometry, scale) {
  if (geometry.type !== "Polygon") return geometry;
  const coords = geometry.coordinates[0];
  // Compute centroid
  let cx = 0,
    cy = 0;
  const n = coords.length - 1; // last coord = first coord
  for (let i = 0; i < n; i++) {
    cx += coords[i][0];
    cy += coords[i][1];
  }
  cx /= n;
  cy /= n;
  // Scale each point outward from centroid
  const scaled = coords.map((c) => [
    cx + (c[0] - cx) * scale,
    cy + (c[1] - cy) * scale,
  ]);
  return { type: "Polygon", coordinates: [scaled] };
}

function edgeLength(a, b) {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

/**
 * Given the first four corners of a rectangular polygon, find:
 *  - stepEdge: the LONG edge (direction of travel / step progression)
 *  - widthVector: the SHORT edge direction (step width, how wide each step is)
 *
 * Real staircases are LONGER along the direction of travel than they are wide,
 * so steps progress along the long axis and each step spans the short axis.
 */
function findStepEdgeAndWidth(coords) {
  const [p1, p2, p3, p4] = coords.slice(0, 4);
  const edges = [
    { start: p1, end: p2, length: edgeLength(p1, p2), index: 0 },
    { start: p2, end: p3, length: edgeLength(p2, p3), index: 1 },
    { start: p3, end: p4, length: edgeLength(p3, p4), index: 2 },
    { start: p4, end: p1, length: edgeLength(p4, p1), index: 3 },
  ];
  edges.sort((a, b) => b.length - a.length); // longest first
  const longest = edges[0]; // direction of travel

  // Width vector points along the SHORT (perpendicular) axis
  let widthVector;
  if (longest.index === 0) widthVector = [p4[0] - p1[0], p4[1] - p1[1]];
  else if (longest.index === 1) widthVector = [p1[0] - p2[0], p1[1] - p2[1]];
  else if (longest.index === 2) widthVector = [p2[0] - p3[0], p2[1] - p3[1]];
  else widthVector = [p3[0] - p4[0], p3[1] - p4[1]];

  return { stepEdge: longest, widthVector };
}

// ---------------------------------------------------------------------------
// Default rendering parameters
// ---------------------------------------------------------------------------
const DEFAULTS = {
  stairs: { color: "#089c8d", height: 5, base: 0, numSteps: 20 },
  escalator: { color: "#006400", height: 5, base: 0, numSteps: 20 },
  fob: { color: "#59717d", height: 6, base: 3 },
  lift: { color: "#4285F4", height: 6, base: 0 },
  platform: { color: "#808080", height: 2, base: 0 },
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a feature into one of the known structure types.
 * Returns one of: "stairs", "escalator", "fob", "lift", "platform", or null.
 */
export function classifyFeature(feature) {
  if (!feature || !feature.properties) return null;
  const props = feature.properties;

  // Check explicit `type` property first
  const t = (props.type || "").toLowerCase().trim();
  if (t === "stairs" || t === "staircase") return "stairs";
  if (t === "escalator") return "escalator";
  if (t === "bridge" || t === "fob") return "fob";
  if (t === "elevator" || t === "lift") return "lift";
  if (t === "platform") return "platform";

  // Check explicit `category` property
  const cat = (props.category || "").toLowerCase().trim();
  if (cat === "stairs" || cat === "staircase") return "stairs";
  if (cat === "escalator") return "escalator";
  if (cat === "fob" || cat === "bridge") return "fob";
  if (cat === "elevator" || cat === "lift") return "lift";
  if (cat === "platform") return "platform";

  // Fallback: infer from name
  const n = (props.name || "").toLowerCase();
  if (n.includes("staircase") || n.includes("stairs")) return "stairs";
  if (n.includes("escalator")) return "escalator";
  if (
    n.includes("fob") ||
    n.includes("foot over bridge") ||
    n.includes("flyover")
  )
    return "fob";
  if (n.includes("lift") || n.includes("elevator")) return "lift";
  if (n.includes("platform")) return "platform";

  return null;
}

/**
 * Whether this feature should be decomposed into individual step polygons.
 * Only decompose when the feature has an explicit `type` or `category` property
 * marking it as stairs/escalator. Name-based matches mean the data is likely
 * already pre-split into individual steps (as in preloaded station data).
 */
function shouldDecompose(feature) {
  if (!feature || !feature.properties) return false;
  const props = feature.properties;
  const t = (props.type || "").toLowerCase().trim();
  if (["stairs", "staircase", "escalator"].includes(t)) return true;
  const cat = (props.category || "").toLowerCase().trim();
  if (["stairs", "staircase", "escalator"].includes(cat)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Step generation (stairs & escalators)
// ---------------------------------------------------------------------------

/**
 * Create stepped extrusion features from a single staircase/escalator polygon.
 *
 * @param {Object} feature  - GeoJSON Feature (Polygon)
 * @param {string} kind     - "stairs" or "escalator"
 * @returns {Object[]}      - Array of step GeoJSON Features
 */
function createSteps(feature, kind) {
  if (!feature.geometry || feature.geometry.type !== "Polygon") {
    return [feature];
  }

  let coords = feature.geometry.coordinates[0];
  if (coords.length < 4) return [feature];

  const defaults = DEFAULTS[kind];
  const props = feature.properties;

  // Specific staircases were drawn pointing the wrong direction in the source
  // GeoJSON — rotate them 180° so steps progress the right way.
  if (kind === "stairs" && FLIPPED_STAIRCASE_NAMES.has(props?.name)) {
    coords = rotateRing180(coords);
  }

  // Respect GeoJSON properties, fall back to defaults
  // Staircases default to FOB top so the top step lands on the bridge.
  const fobTop = DEFAULTS.fob.base + DEFAULTS.fob.height;
  const totalHeight =
    props.height != null
      ? Number(props.height)
      : kind === "stairs"
        ? fobTop
        : defaults.height;
  const baseHeight = props.base != null ? Number(props.base) : defaults.base;
  const numSteps =
    props.numSteps != null ? Number(props.numSteps) : defaults.numSteps;
  const baseColor = props.color || defaults.color;

  // Direction: stairs ascend by default. If `flip` is set, respect it.
  // If floor_to > floor_from, force ascending (going up). If floor_to < floor_from, descending.
  let shouldFlip;
  if (props.flip != null) {
    shouldFlip = !!props.flip;
  } else if (props.floor_to != null && props.floor_from != null) {
    shouldFlip = Number(props.floor_to) > Number(props.floor_from);
  } else {
    shouldFlip = true; // default: stairs go up
  }

  const { stepEdge, widthVector } = findStepEdgeAndWidth(coords);
  // Step width matches polygon footprint (no over-widening). Match Marine Lines 1
  // visual where each step is sized to the staircase's actual physical width.
  const widthScale = kind === "stairs" ? 0.7 : 1.5;
  const scaledWidthVector = [
    widthVector[0] * widthScale,
    widthVector[1] * widthScale,
  ];

  const stepFeatures = [];
  const zFightOffset = 0.6;
  const stepThickness = Math.max((totalHeight / numSteps) * 1.2, 0.5);
  const isStep = kind === "stairs" ? "isStairStep" : "isEscalatorStep";

  // Offset so the step is centered on the polygon's long axis when widthScale < 1
  const widthOffset = (1 - widthScale) / 2;
  const offsetVector = [
    widthVector[0] * widthOffset,
    widthVector[1] * widthOffset,
  ];

  for (let i = 0; i < numSteps; i++) {
    const progress = i / numSteps;
    const nextProgress = (i + 1) / numSteps;

    // Steps progress along the short edge (direction of travel)
    const stepStart = addVector(
      interpolate(stepEdge.start, stepEdge.end, progress),
      offsetVector,
    );
    const stepEnd = addVector(
      interpolate(stepEdge.start, stepEdge.end, nextProgress),
      offsetVector,
    );

    const step_p1 = stepStart;
    const step_p2 = addVector(stepStart, scaledWidthVector);
    const step_p3 = addVector(stepEnd, scaledWidthVector);
    const step_p4 = stepEnd;

    // Height progression: step 0 = top, step N = ground (descending by default)
    let stepLevel;
    if (shouldFlip) {
      stepLevel = baseHeight + totalHeight * (i / numSteps);
    } else {
      stepLevel = baseHeight + totalHeight * (1 - i / numSteps);
    }

    const isFirstStep = i === 0;
    const isLastStep = i === numSteps - 1;

    let stepBaseHeight, stepTopHeight;
    if ((shouldFlip && isFirstStep) || (!shouldFlip && isLastStep)) {
      // Ground-level step
      stepBaseHeight = baseHeight + zFightOffset;
      const minThickness = 0.5;
      stepTopHeight = Math.max(
        stepLevel + zFightOffset * 0.5,
        stepBaseHeight + minThickness,
      );
    } else {
      stepBaseHeight = Math.max(stepLevel - stepThickness, baseHeight);
      stepTopHeight = stepLevel;
    }

    // Only the middle step keeps the name label so the staircase shows
    // exactly one label, not one per step.
    const labelStepIndex = Math.floor(numSteps / 2);
    const isLabelStep = i === labelStepIndex;

    stepFeatures.push({
      type: "Feature",
      properties: {
        ...props,
        name: isLabelStep ? props.name : "",
        _originalType: kind,
        id: `${props.id || props.name || kind}_step_${i}`,
        base: stepBaseHeight,
        height: stepTopHeight,
        stepIndex: i,
        [isStep]: true,
        color: baseColor,
      },
      geometry: {
        type: "Polygon",
        coordinates: [[step_p1, step_p2, step_p3, step_p4, step_p1]],
      },
    });
  }

  return stepFeatures;
}

/**
 * Convert a LineString escalator to a polygon, then create steps.
 */
function createEscalatorStepsFromLine(feature) {
  const coords = feature.geometry.coordinates;
  if (coords.length < 2) return [feature];

  const [start, end] = coords;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return [feature];

  const widthVectorX = -dy / length;
  const widthVectorY = dx / length;
  // Give escalator a sensible width (~2m in degrees at typical latitudes)
  const sw = 0.000018;

  const polygonCoords = [
    [start[0] + widthVectorX * sw, start[1] + widthVectorY * sw],
    [end[0] + widthVectorX * sw, end[1] + widthVectorY * sw],
    [end[0] - widthVectorX * sw, end[1] - widthVectorY * sw],
    [start[0] - widthVectorX * sw, start[1] - widthVectorY * sw],
    [start[0] + widthVectorX * sw, start[1] + widthVectorY * sw],
  ];

  const polyFeature = {
    ...feature,
    geometry: { type: "Polygon", coordinates: [polygonCoords] },
  };

  return createSteps(polyFeature, "escalator");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a GeoJSON FeatureCollection: detect structure types and expand
 * staircases/escalators into stepped features. Other structure types get
 * their properties enriched with sensible defaults when missing.
 *
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @returns {{ processed: Object, hasStructures: boolean }}
 */
export function processStructures(geojson) {
  if (!geojson || !geojson.features) {
    return { processed: geojson, hasStructures: false };
  }

  let hasStructures = false;
  const processedFeatures = [];

  // First pass: group features by name to detect pre-split stair/escalator groups
  const nameGroups = {};
  geojson.features.forEach((feature, idx) => {
    const name = feature.properties?.name || "";
    if (!nameGroups[name]) nameGroups[name] = [];
    nameGroups[name].push(idx);
  });

  // Track which features belong to pre-split stair/escalator groups
  const preSplitStepIndices = new Set();
  const preSplitGroups = []; // { indices, kind, defaults }
  for (const [, indices] of Object.entries(nameGroups)) {
    if (indices.length < 3) continue; // Single features aren't pre-split groups
    const sample = geojson.features[indices[0]];
    const kind = classifyFeature(sample);
    if (
      (kind === "stairs" || kind === "escalator") &&
      !shouldDecompose(sample)
    ) {
      // This is a pre-split staircase/escalator group (name-based, no explicit type)
      preSplitGroups.push({ indices, kind, defaults: DEFAULTS[kind] });
      indices.forEach((i) => preSplitStepIndices.add(i));
    }
  }

  geojson.features.forEach((feature, idx) => {
    // Skip pre-split step features — they'll be handled in batch below
    if (preSplitStepIndices.has(idx)) return;

    const kind = classifyFeature(feature);

    if (!kind) {
      processedFeatures.push(feature);
      return;
    }

    hasStructures = true;
    const defaults = DEFAULTS[kind];
    const decompose = shouldDecompose(feature);

    if (decompose && kind === "stairs") {
      if (feature.geometry?.type === "Polygon") {
        processedFeatures.push(...createSteps(feature, "stairs"));
      } else {
        processedFeatures.push(enrichFeature(feature, defaults));
      }
    } else if (decompose && kind === "escalator") {
      if (feature.geometry?.type === "LineString") {
        processedFeatures.push(...createEscalatorStepsFromLine(feature));
      } else if (feature.geometry?.type === "Polygon") {
        processedFeatures.push(...createSteps(feature, "escalator"));
      } else {
        processedFeatures.push(enrichFeature(feature, defaults));
      }
    } else {
      // Name-based match or fob/lift/platform — enrich only, don't decompose
      processedFeatures.push(enrichFeature(feature, defaults));
    }
  });

  // Second pass: assign progressive step heights to pre-split groups.
  // Sub-cluster by spatial proximity so multiple staircases under one name
  // are handled independently. Skip duplicate polygons across groups.
  const processedCoordKeys = new Set();

  for (const group of preSplitGroups) {
    hasStructures = true;
    const { indices, kind, defaults } = group;
    const totalHeight = defaults.height;
    const baseHeight = defaults.base;
    const baseColor = defaults.color;
    const isStep = kind === "stairs" ? "isStairStep" : "isEscalatorStep";

    // Filter out duplicate polygons (same coords already processed by another group)
    const uniqueIndices = indices.filter((fi) => {
      const key = JSON.stringify(geojson.features[fi].geometry.coordinates);
      if (processedCoordKeys.has(key)) return false;
      processedCoordKeys.add(key);
      return true;
    });

    if (uniqueIndices.length === 0) continue;

    // Compute centroids for spatial clustering
    const centroids = uniqueIndices.map((fi) => {
      const coords = geojson.features[fi].geometry.coordinates[0];
      let cx = 0,
        cy = 0;
      const n = coords.length - 1;
      for (let j = 0; j < n; j++) {
        cx += coords[j][0];
        cy += coords[j][1];
      }
      return [cx / n, cy / n];
    });

    // Split into sub-clusters whenever consecutive centroids jump > threshold
    const GAP_THRESHOLD = 0.0001; // ~11 meters
    const subClusters = [[]];
    for (let i = 0; i < uniqueIndices.length; i++) {
      if (i > 0) {
        const dx = centroids[i][0] - centroids[i - 1][0];
        const dy = centroids[i][1] - centroids[i - 1][1];
        if (Math.sqrt(dx * dx + dy * dy) > GAP_THRESHOLD) {
          subClusters.push([]);
        }
      }
      subClusters[subClusters.length - 1].push(uniqueIndices[i]);
    }

    // Process each sub-cluster as an independent staircase
    for (const cluster of subClusters) {
      const numSteps = cluster.length;
      const stepHeight = totalHeight / numSteps;
      // Large clusters (>15 steps) need flipped direction
      const flipCluster = numSteps > 15;
      // Only the middle step keeps the name label so each staircase shows
      // exactly one label, not one per step.
      const labelStepIndex = Math.floor(numSteps / 2);

      cluster.forEach((featureIdx, stepIdx) => {
        const feature = geojson.features[featureIdx];
        const props = feature.properties || {};

        let stepBaseHeight, stepTopHeight;
        if (flipCluster) {
          // Ascending: step 0 = ground, last step = FOB height
          stepBaseHeight = baseHeight + stepIdx * stepHeight;
          stepTopHeight = stepBaseHeight + stepHeight;
        } else {
          // Descending: step 0 = FOB height, last step = ground
          stepTopHeight = baseHeight + totalHeight - stepIdx * stepHeight;
          stepBaseHeight = stepTopHeight - stepHeight;
        }

        // Scale polygon outward from centroid to make steps wider
        const scaledGeometry = scalePolygon(feature.geometry, 2.0);

        processedFeatures.push({
          ...feature,
          geometry: scaledGeometry,
          properties: {
            ...props,
            name: stepIdx === labelStepIndex ? props.name : "",
            _structureType: kind,
            height: props.height != null ? Number(props.height) : stepTopHeight,
            base: props.base != null ? Number(props.base) : stepBaseHeight,
            color: props.color || baseColor,
            [isStep]: true,
            stepIndex: stepIdx,
          },
        });
      });
    }
  }

  return {
    processed: { ...geojson, features: processedFeatures },
    hasStructures,
  };
}

/**
 * Enrich a feature's properties with default height/base/color when they are
 * not already specified in the GeoJSON. GeoJSON properties always win.
 */
function enrichFeature(feature, defaults) {
  const props = feature.properties || {};
  return {
    ...feature,
    properties: {
      ...props,
      _structureType: classifyFeature(feature),
      height: props.height != null ? Number(props.height) : defaults.height,
      base: props.base != null ? Number(props.base) : defaults.base,
      color: props.color || defaults.color,
    },
  };
}

/**
 * Check if a feature is a stepped feature (stair step or escalator step)
 * produced by processStructures.
 */
export function isSteppedFeature(feature) {
  return !!(
    feature?.properties?.isStairStep || feature?.properties?.isEscalatorStep
  );
}
