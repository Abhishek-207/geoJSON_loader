/**
 * Navigation graph builder.
 *
 * Inputs:
 *   - lineStrings: GeoJSON FeatureCollection of LineStrings (the path network)
 *   - structures: GeoJSON FeatureCollection of station POIs (destinations)
 *
 * Output:
 *   - graph (ngraph.graph): weighted undirected graph for pathfinding
 *   - nodes:  Map<nodeId, { id, lng, lat }>
 *   - destinations: Array<{ id, name, type, category, nodeId, lng, lat, polygon }>
 *   - kioskNodeId: id of the node closest to the kiosk location
 *
 * Approach:
 *   1. Walk every line string vertex. Snap to a canonical node by spatial
 *      proximity (SNAP_TOLERANCE_M). Identical / near-identical coordinates
 *      across different lines collapse to one node, automatically connecting
 *      lines where they cross or meet.
 *   2. For each consecutive pair of vertices in a line, add an edge whose
 *      weight is the haversine distance in meters.
 *   3. For each POI in `structures`, compute centroid and snap to the nearest
 *      graph node within SNAP_TO_POI_M; if no node is close enough, project
 *      onto the nearest line segment and inject a new node there.
 */

import createGraph from "ngraph.graph";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Haversine distance between two [lng, lat] points, in meters. */
export function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Polygon centroid (average of outer ring vertices, ignoring duplicate close). */
export function polygonCentroid(coords) {
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

/** Centroid of any GeoJSON geometry we care about (Polygon / Point / etc). */
export function featureCentroid(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "Point") return g.coordinates;
  if (g.type === "Polygon") return polygonCentroid(g.coordinates);
  if (g.type === "MultiPolygon") return polygonCentroid(g.coordinates[0]);
  if (g.type === "LineString") {
    const c = g.coordinates;
    return c[Math.floor(c.length / 2)];
  }
  return null;
}

/**
 * Project point P onto segment AB, returning { point, t, distM }.
 * t is clamped to [0, 1] so the projection stays on the segment.
 */
function projectOntoSegment(p, a, b) {
  // Work in a local equirectangular frame so distances roughly match meters.
  const lat0 = (a[1] + b[1] + p[1]) / 3;
  const cosLat = Math.cos(toRad(lat0));
  const ax = a[0] * cosLat;
  const ay = a[1];
  const bx = b[0] * cosLat;
  const by = b[1];
  const px = p[0] * cosLat;
  const py = p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projLng = (ax + dx * t) / cosLat;
  const projLat = ay + dy * t;
  return {
    point: [projLng, projLat],
    t,
    distM: haversine(p, [projLng, projLat]),
  };
}

// ---------------------------------------------------------------------------
// Spatial node index (simple round-to-grid hash for fast snapping)
// ---------------------------------------------------------------------------

const SNAP_TOLERANCE_M = 6; // line vertices within 6m collapse to one node
// Note: this also stitches together line strings whose endpoints are drawn
// near each other but not exactly coincident — without this, the graph splits
// into disconnected subgraphs and routing fails.

class NodeIndex {
  constructor(toleranceM = SNAP_TOLERANCE_M) {
    this.toleranceM = toleranceM;
    this.nodes = new Map(); // id -> { id, lng, lat }
    this.byCell = new Map(); // cellKey -> array of ids
    this.nextId = 0;
    // ~1.5m at Mumbai (lat ~19°): 1° lat ≈ 111000m, 1° lng ≈ 105000m
    this.cellSize = toleranceM / 111000;
  }

  cellKey(lng, lat) {
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    return `${cx}:${cy}`;
  }

  /** Find existing node within tolerance, or null. */
  findNear(lng, lat) {
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    let best = null;
    let bestDist = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const ids = this.byCell.get(`${cx + dx}:${cy + dy}`);
        if (!ids) continue;
        for (const id of ids) {
          const node = this.nodes.get(id);
          const d = haversine([lng, lat], [node.lng, node.lat]);
          if (d <= this.toleranceM && d < bestDist) {
            best = node;
            bestDist = d;
          }
        }
      }
    }
    return best;
  }

  /** Get-or-create node id for a coordinate. */
  ensure(lng, lat) {
    const existing = this.findNear(lng, lat);
    if (existing) return existing.id;
    const id = `n${this.nextId++}`;
    const node = { id, lng, lat };
    this.nodes.set(id, node);
    const key = this.cellKey(lng, lat);
    if (!this.byCell.has(key)) this.byCell.set(key, []);
    this.byCell.get(key).push(id);
    return id;
  }

  /** Nearest node to a coordinate, regardless of tolerance. */
  nearest(lng, lat) {
    let best = null;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      const d = haversine([lng, lat], [node.lng, node.lat]);
      if (d < bestDist) {
        best = node;
        bestDist = d;
      }
    }
    return { node: best, distM: bestDist };
  }
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build a navigation graph from line strings + station structures.
 *
 * @param {Object}   lineStrings   GeoJSON FeatureCollection of LineStrings
 * @param {Object}   structures    GeoJSON FeatureCollection of POI Polygons
 * @param {Object}   options
 * @param {[number,number]} options.kioskCoord  [lng, lat] of the kiosk; the
 *   graph node closest to this coord becomes the start of every route.
 *
 * @returns {{ graph, nodeIndex, destinations, kioskNodeId, lineEdges }}
 *   - graph: ngraph.graph instance, nodes have { lng, lat }, links have { weight }
 *   - nodeIndex: NodeIndex for ad-hoc lookups (e.g. snapping click coords)
 *   - destinations: Array of POIs with attached nodeId
 *   - kioskNodeId: id of the kiosk anchor node
 *   - lineEdges: Array of [fromNodeId, toNodeId] for visualizing the network
 */
export function buildNavigationGraph(lineStrings, structures, options = {}) {
  const graph = createGraph({ multigraph: false });
  const nodeIndex = new NodeIndex();
  const lineEdges = [];

  // 1. Walk every line and create nodes + edges.
  for (const feature of lineStrings.features || []) {
    if (feature.geometry?.type !== "LineString") continue;
    const coords = feature.geometry.coordinates;
    let prevId = null;
    for (const [lng, lat] of coords) {
      const id = nodeIndex.ensure(lng, lat);
      if (!graph.getNode(id)) {
        graph.addNode(id, { lng, lat });
      }
      if (prevId && prevId !== id) {
        const a = nodeIndex.nodes.get(prevId);
        const b = nodeIndex.nodes.get(id);
        const w = haversine([a.lng, a.lat], [b.lng, b.lat]);
        // Avoid duplicate links if the same segment appears twice.
        const existing = graph.getLink(prevId, id) || graph.getLink(id, prevId);
        if (!existing) {
          graph.addLink(prevId, id, { weight: w });
          lineEdges.push([prevId, id]);
        }
      }
      prevId = id;
    }
  }

  // 1b. Stitch disconnected components together. The seven line strings in
  //     the source data don't share endpoints, so the raw graph splits into
  //     several isolated sub-networks. We iteratively find the closest pair of
  //     nodes that sit in different components and add a bridging edge,
  //     stopping once everything is connected (or no pair is close enough).
  stitchComponents(graph, /* maxBridgeM */ 25);

  // 2. Attach destinations: snap each POI centroid to the closest graph node.
  //    If no node is close enough (POI off the network), we project onto the
  //    nearest segment and inject a new node so routing always has a target.
  const destinations = [];
  const POI_SNAP_M = 8; // up to 8m: snap to existing node
  const SEGMENT_PROJECT_M = 50; // up to 50m: inject a node onto a segment

  for (const feature of structures.features || []) {
    const props = feature.properties || {};
    const centroid = featureCentroid(feature);
    if (!centroid) continue;

    const { node: nearest, distM } = nodeIndex.nearest(centroid[0], centroid[1]);
    let nodeId = null;

    if (nearest && distM <= POI_SNAP_M) {
      nodeId = nearest.id;
    } else {
      // Find nearest segment and project
      const proj = nearestSegmentProjection(centroid, graph);
      if (proj && proj.distM <= SEGMENT_PROJECT_M) {
        nodeId = injectNodeOnSegment(graph, nodeIndex, proj);
      } else if (nearest) {
        nodeId = nearest.id; // fall back: just attach to nearest, even if far
      }
    }

    destinations.push({
      id: props.id || `${props.name || "poi"}_${destinations.length}`,
      name: props.name || `POI ${destinations.length + 1}`,
      type: props.type || "",
      category: props.category || "",
      nodeId,
      lng: centroid[0],
      lat: centroid[1],
      polygon: feature.geometry,
      properties: props,
    });
  }

  // 3. Resolve kiosk anchor.
  let kioskNodeId = null;
  if (options.kioskCoord) {
    const [klng, klat] = options.kioskCoord;
    const { node } = nodeIndex.nearest(klng, klat);
    kioskNodeId = node?.id ?? null;
  }

  return { graph, nodeIndex, destinations, kioskNodeId, lineEdges };
}

// ---------------------------------------------------------------------------
// Segment projection helpers (used when a POI is far from any node)
// ---------------------------------------------------------------------------

/**
 * Repeatedly bridge the two closest disconnected components until the graph
 * is fully connected (or no cross-component pair is within `maxBridgeM`).
 *
 * Cost: each pass is O(n²) over node pairs in different components; we run at
 * most (#components - 1) passes. Marine Lines has ~70 nodes, so this is cheap.
 */
function stitchComponents(graph, maxBridgeM = 25) {
  while (true) {
    const components = connectedComponents(graph);
    if (components.length <= 1) return;

    // Find the closest cross-component pair.
    let best = null;
    for (let i = 0; i < components.length; i++) {
      for (let j = i + 1; j < components.length; j++) {
        const pair = closestPairBetween(graph, components[i], components[j]);
        if (!pair) continue;
        if (!best || pair.distM < best.distM) best = pair;
      }
    }

    if (!best || best.distM > maxBridgeM) return; // can't bridge further
    graph.addLink(best.aId, best.bId, { weight: best.distM, bridged: true });
  }
}

function connectedComponents(graph) {
  const visited = new Set();
  const components = [];
  graph.forEachNode((node) => {
    if (visited.has(node.id)) return;
    const comp = [];
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      comp.push(id);
      graph.forEachLinkedNode(id, (other) => {
        if (!visited.has(other.id)) stack.push(other.id);
      });
    }
    components.push(comp);
  });
  return components;
}

function closestPairBetween(graph, idsA, idsB) {
  let best = null;
  for (const aId of idsA) {
    const a = graph.getNode(aId)?.data;
    if (!a) continue;
    for (const bId of idsB) {
      const b = graph.getNode(bId)?.data;
      if (!b) continue;
      const d = haversine([a.lng, a.lat], [b.lng, b.lat]);
      if (!best || d < best.distM) best = { aId, bId, distM: d };
    }
  }
  return best;
}

function nearestSegmentProjection(point, graph) {
  let best = null;
  graph.forEachLink((link) => {
    const a = graph.getNode(link.fromId)?.data;
    const b = graph.getNode(link.toId)?.data;
    if (!a || !b) return;
    const proj = projectOntoSegment(point, [a.lng, a.lat], [b.lng, b.lat]);
    if (!best || proj.distM < best.distM) {
      best = { ...proj, link };
    }
  });
  return best;
}

function injectNodeOnSegment(graph, nodeIndex, proj) {
  const { link, point } = proj;
  const [lng, lat] = point;
  const newId = nodeIndex.ensure(lng, lat);
  if (graph.getNode(newId)) {
    // already snapped to an existing node — nothing to do
    return newId;
  }
  graph.addNode(newId, { lng, lat });

  const fromNode = graph.getNode(link.fromId).data;
  const toNode = graph.getNode(link.toId).data;
  const w1 = haversine([fromNode.lng, fromNode.lat], [lng, lat]);
  const w2 = haversine([lng, lat], [toNode.lng, toNode.lat]);

  graph.removeLink(link);
  graph.addLink(link.fromId, newId, { weight: w1 });
  graph.addLink(newId, link.toId, { weight: w2 });
  return newId;
}
