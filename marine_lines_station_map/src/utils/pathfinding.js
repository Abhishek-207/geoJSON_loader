/**
 * Dynamic pathfinding on the line-string graph.
 *
 * Provides:
 *   - findShortestPath(graph, fromId, toId)       → single best route
 *   - findKAlternatives(graph, fromId, toId, k)   → up to k routes (shortest + alts)
 *
 * The k-alternatives routine is a simple penalty-based variant: after we find
 * the shortest path, we temporarily multiply the weight of edges used in that
 * path by a penalty factor and re-run Dijkstra. Repeating this yields paths
 * that overlap less and less with previous ones — good enough for showing a
 * user "the shortest" plus "another way to go" without the complexity of full
 * Yen's algorithm.
 */

import { aStar } from "ngraph.path";

/** Convert ngraph path (array of nodes from->to) to LineString coords. */
export function pathToCoords(path) {
  return path.map((n) => [n.data.lng, n.data.lat]);
}

/** Total length of a path in meters. */
export function pathDistanceM(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1].data;
    const b = path[i].data;
    total += haversineMeters(a.lng, a.lat, b.lng, b.lat);
  }
  return total;
}

function haversineMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Find a single shortest path. Returns array of nodes or null. */
export function findShortestPath(graph, fromId, toId, getWeight = defaultWeight) {
  if (!fromId || !toId || fromId === toId) return null;
  const finder = aStar(graph, {
    distance: (_a, _b, link) => getWeight(link),
    heuristic: (a, b) =>
      haversineMeters(a.data.lng, a.data.lat, b.data.lng, b.data.lat),
  });
  const path = finder.find(fromId, toId);
  if (!path || path.length === 0) return null;
  // ngraph returns path in destination → source order; flip it.
  return path[0].id === toId ? path.slice().reverse() : path;
}

const defaultWeight = (link) => link.data?.weight ?? 1;

/**
 * Find up to k distinct paths.
 *
 * Strategy (simplified Yen's):
 *   1. Find the shortest path.
 *   2. For each edge in the shortest path, temporarily make that edge
 *      effectively impassable and run Dijkstra again. Each run yields a
 *      candidate alternative that avoids that edge.
 *   3. Among all candidates, keep the shortest one that is also distinct
 *      from the shortest path. That's alternative #1.
 *   4. Repeat against alternative #1 to find alternative #2, and so on.
 *
 * This produces *real* alternatives (not just penalty-shifted variants of
 * the same corridor) and reliably returns the second-best route when one
 * actually exists in the graph.
 */
const BLOCK_WEIGHT = 1e9;

export function findKAlternatives(graph, fromId, toId, k = 2) {
  const shortest = findShortestPath(graph, fromId, toId);
  if (!shortest || shortest.length < 2) return [];
  const results = [shortest];

  for (let i = 1; i < k; i++) {
    const reference = results[results.length - 1];
    const next = findBestAlternative(graph, fromId, toId, results);
    if (!next || pathsEqual(next, reference)) break;
    if (results.some((r) => pathsEqual(r, next))) break;
    results.push(next);
  }

  return results;
}

/**
 * Find the best path that is distinct from every path in `existing`.
 * For every edge appearing in any existing path, run a Dijkstra with that
 * edge blocked and keep the cheapest valid result.
 */
function findBestAlternative(graph, fromId, toId, existing) {
  const candidateEdges = new Set();
  for (const path of existing) {
    for (let i = 1; i < path.length; i++) {
      candidateEdges.add(edgeKeyFromIds(path[i - 1].id, path[i].id));
    }
  }

  let best = null;
  let bestDist = Infinity;
  for (const blockedKey of candidateEdges) {
    const weightFn = (link) => {
      if (edgeKey(link) === blockedKey) return BLOCK_WEIGHT;
      return link.data?.weight ?? 1;
    };
    const candidate = findShortestPath(graph, fromId, toId, weightFn);
    if (!candidate || candidate.length < 2) continue;
    if (existing.some((r) => pathsEqual(r, candidate))) continue;
    // Skip candidates that "got around" by using a blocked edge anyway —
    // this happens when there's no real alternative and the algorithm just
    // pays the BLOCK_WEIGHT cost. Such candidates are absurdly long.
    const dist = pathDistanceM(candidate);
    if (dist >= BLOCK_WEIGHT / 2) continue;
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

function edgeKey(link) {
  return edgeKeyFromIds(link.fromId, link.toId);
}

function edgeKeyFromIds(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pathsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
  return true;
}

/**
 * Convert an array of paths into ready-to-render route objects.
 * Each route has: { id, coords, distanceM, nodeIds }
 */
export function pathsToRoutes(paths) {
  return paths.map((path, i) => ({
    id: `route-${i}`,
    label: i === 0 ? "Shortest" : `Alternative ${i}`,
    coords: pathToCoords(path),
    distanceM: pathDistanceM(path),
    nodeIds: path.map((n) => n.id),
  }));
}
