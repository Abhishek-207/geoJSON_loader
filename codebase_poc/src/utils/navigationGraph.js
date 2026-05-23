import createGraph from "ngraph.graph";
import path from "ngraph.path";

export function buildNavigationGraph(geojsonData) {
  const graph = createGraph();
  const nodeCoordinates = new Map();

  geojsonData.features.forEach((feature) => {
    if (feature.properties.type === "nav_node") {
      const { id } = feature.properties;
      const coords = feature.geometry.coordinates;
      nodeCoordinates.set(id, coords);

      graph.addNode(id, {
        x: coords[0],
        y: coords[1],
        name: feature.properties.name,
        floor: feature.properties.floor || 0,
      });
    }
  });

  geojsonData.features.forEach((feature) => {
    if (feature.properties.type === "nav_edge") {
      const { source, target, weight, description } = feature.properties;

      graph.addLink(source, target, {
        weight: weight || 1,
        description: description || "",
      });

      graph.addLink(target, source, {
        weight: weight || 1,
        description: description || "",
      });
    }
  });

  return graph;
}

export function getPathBridgeInfo(path) {
  if (!path) return null;

  let usesEastFOB = false;
  let usesWestFOB = false;

  for (const node of path) {
    const nodeId = node.id;
    if (nodeId && nodeId.includes("fob_e")) {
      usesEastFOB = true;
    }
    if (nodeId && nodeId.includes("fob_w")) {
      usesWestFOB = true;
    }
  }

  if (usesEastFOB && usesWestFOB) return "both";
  if (usesEastFOB) return "east";
  if (usesWestFOB) return "west";
  return null;
}

export function isFOBLevelNode(nodeId, graph) {
  if (!nodeId) return false;

  if (nodeId.includes("_fob") || nodeId.includes("fob_")) {
    return true;
  }

  const node = graph.getNode(nodeId);
  if (node && node.data?.name) {
    const name = node.data.name.toLowerCase();
    return name.includes("fob level") || name.includes("(fob)");
  }

  return false;
}

export function getConnectedFOBTopNode(nodeId, graph) {
  if (!isFOBLevelNode(nodeId, graph)) return null;

  const node = graph.getNode(nodeId);
  if (!node) return null;

  let fobTopNode = null;
  let found = false;
  graph.forEachLinkedNode(nodeId, (linkedNode, link) => {
    if (found) return;
    const linkedNodeId = linkedNode.id;
    if (linkedNodeId === "n_fob_e_top" || linkedNodeId === "n_fob_w_top") {
      fobTopNode = linkedNodeId;
      found = true;
    }
  });

  return fobTopNode;
}

export function isPlatformToPlatformRoute(startNodeId, endNodeId, graph) {
  const startNode = graph.getNode(startNodeId);
  const endNode = graph.getNode(endNodeId);

  if (!startNode || !endNode) return false;

  const isPlatformNode = (name) => {
    return name && name.toLowerCase().includes("platform");
  };

  return (
    isPlatformNode(startNode.data?.name) && isPlatformNode(endNode.data?.name)
  );
}

function findPathThroughBridge(graph, startNodeId, endNodeId, bridgeTopNode) {
  const pathToBridge = findPath(graph, startNodeId, bridgeTopNode);
  if (!pathToBridge || pathToBridge.length === 0) {
    return null;
  }

  const pathFromBridge = findPath(graph, bridgeTopNode, endNodeId);
  if (!pathFromBridge || pathFromBridge.length === 0) {
    return null;
  }

  const combinedPath = [...pathToBridge, ...pathFromBridge.slice(1)];
  return combinedPath;
}

function getPathSignature(path) {
  if (!path || path.length === 0) return "";

  const bridgeTopNodes = path
    .filter(
      (node) => node.id && node.id.includes("fob_") && node.id.includes("_top")
    )
    .map((node) => node.id);

  return bridgeTopNodes.join("->");
}

export function findMultiplePaths(
  graph,
  startNodeId,
  endNodeId,
  maxRoutes = 3
) {
  console.log("findMultiplePaths called:", {
    startNodeId,
    endNodeId,
    maxRoutes,
  });

  if (!graph.hasNode(startNodeId) || !graph.hasNode(endNodeId)) {
    console.log("Start or end node not found in graph");
    return [];
  }

  const routes = [];
  const usedSignatures = new Set();

  const isPlatformRoute = isPlatformToPlatformRoute(
    startNodeId,
    endNodeId,
    graph
  );
  console.log("isPlatformRoute:", isPlatformRoute);

  if (isPlatformRoute) {
    const bridgeConfigs = [
      { node: "n_fob_e_top", type: "east", label: "Via FOB East" },
      { node: "n_fob_w_top", type: "west", label: "Via FOB West" },
    ];

    for (const bridge of bridgeConfigs) {
      if (routes.length >= maxRoutes) break;

      console.log("Trying bridge:", bridge.node);
      const path = findPathThroughBridge(
        graph,
        startNodeId,
        endNodeId,
        bridge.node
      );
      console.log(
        "Path found:",
        path ? path.map((n) => n.id).join(" -> ") : "null"
      );

      if (path && path.length > 0) {
        const signature = getPathSignature(path);
        console.log("Path signature:", signature);

        if (!usedSignatures.has(signature)) {
          const bridgeInfo = getPathBridgeInfo(path);
          routes.push({
            path: path,
            bridgeUsed: bridgeInfo || bridge.type,
            routeType: bridgeInfo === "both" ? "Via Both FOBs" : bridge.label,
          });
          usedSignatures.add(signature);
          console.log("Added route:", bridge.label);
        } else {
          console.log("Duplicate signature, skipping:", signature);
        }
      }
    }

    if (routes.length < 2) {
      console.log("Less than 2 routes found, trying direct path");
      const directPath = findPath(graph, startNodeId, endNodeId);
      if (directPath && directPath.length > 0) {
        const signature = getPathSignature(directPath);
        if (!usedSignatures.has(signature)) {
          const bridgeInfo = getPathBridgeInfo(directPath);
          routes.push({
            path: directPath,
            bridgeUsed: bridgeInfo,
            routeType: bridgeInfo
              ? `Via FOB ${
                  bridgeInfo.charAt(0).toUpperCase() + bridgeInfo.slice(1)
                }`
              : "Direct Route",
          });
          usedSignatures.add(signature);
        }
      }
    }
  } else {
    const primaryPath = findPath(graph, startNodeId, endNodeId);
    if (primaryPath && primaryPath.length > 0) {
      const bridgeInfo = getPathBridgeInfo(primaryPath);
      routes.push({
        path: primaryPath,
        bridgeUsed: bridgeInfo,
        routeType: bridgeInfo
          ? `Via FOB ${
              bridgeInfo.charAt(0).toUpperCase() + bridgeInfo.slice(1)
            }`
          : "Direct Route",
      });
    }
  }

  console.log("Total routes found:", routes.length);
  routes.forEach((r, i) => console.log(`Route ${i}: ${r.routeType}`));

  return routes;
}

export function findPath(graph, startNodeId, endNodeId) {
  if (!graph.hasNode(startNodeId) || !graph.hasNode(endNodeId)) {
    console.error("Start or end node not found in graph");
    return null;
  }

  const startNode = graph.getNode(startNodeId);
  const endNode = graph.getNode(endNodeId);
  const isStartEntrance = startNode?.data?.name?.toLowerCase().includes("entrance");
  const isEndEntrance = endNode?.data?.name?.toLowerCase().includes("entrance");

  const pathFinder = path.aStar(graph, {
    distance(fromNode, toNode, link) {
      let weight = link.data ? link.data.weight : 1;
      const description = link.data?.description?.toLowerCase() || "";
      
      const fromName = fromNode.data?.name?.toLowerCase() || "";
      const toName = toNode.data?.name?.toLowerCase() || "";
      const fromId = fromNode.id || "";
      const toId = toNode.id || "";
      
      const isFromEntrance = fromName.includes("entrance") || fromId.includes("entrance");
      const isToPlatform = toName.includes("platform") || toId.includes("platform");
      const isToLiftOrStair = toName.includes("lift") || toName.includes("stair") || 
                              toId.includes("lift") || toId.includes("stair");
      
      if (isFromEntrance && isToPlatform && !isToLiftOrStair) {
        weight += 50;
      }
      
      if ((isStartEntrance || isEndEntrance) && isToPlatform && !isToLiftOrStair) {
        if (isStartEntrance && isEndEntrance) {
          weight += 30;
        }
      }
      
      return weight;
    },
    heuristic(fromNode, toNode) {
      const dx = fromNode.data.x - toNode.data.x;
      const dy = fromNode.data.y - toNode.data.y;
      return Math.sqrt(dx * dx + dy * dy) * 111000;
    },
  });

  const foundPath = pathFinder.find(startNodeId, endNodeId);

  if (!foundPath || foundPath.length === 0) {
    console.warn("No path found between nodes");
    return null;
  }

  return foundPath.reverse();
}

import { nodePathToRoutePath, buildRoutePaths } from "./routePaths.js";

let cachedRoutePaths = null;

export function initializeRoutePaths(geojsonData) {
  if (!cachedRoutePaths) {
    cachedRoutePaths = buildRoutePaths(geojsonData);
  }
}

export function pathToGeoJSON(path, geojsonData) {
  if (!path || path.length === 0) {
    return null;
  }

  if (!cachedRoutePaths) {
    cachedRoutePaths = buildRoutePaths(geojsonData);
  }

  const routeCoordinates = nodePathToRoutePath(path, cachedRoutePaths, geojsonData);

  if (routeCoordinates.length === 0) {
    const rawCoordinates = path.map((node) => {
      const nodeFeature = geojsonData.features.find(
        (f) => f.properties.id === node.id && f.properties.type === "nav_node"
      );

      if (nodeFeature) {
        return nodeFeature.geometry.coordinates;
      }

      return [node.data.x, node.data.y];
    });
    
    return {
      type: "Feature",
      properties: {
        pathType: "route",
        nodeCount: rawCoordinates.length,
      },
      geometry: {
        type: "LineString",
        coordinates: rawCoordinates,
      },
    };
  }

  return {
    type: "Feature",
    properties: {
      pathType: "route",
      nodeCount: routeCoordinates.length,
    },
    geometry: {
      type: "LineString",
      coordinates: routeCoordinates,
    },
  };
}

function alignFOBSegments(coordinates, path, geojsonData) {
  if (coordinates.length < 2) {
    return coordinates;
  }

  const fobBridges = geojsonData.features.filter(
    (f) =>
      f.properties.type === "bridge" &&
      (f.properties.category === "fob" ||
        f.properties.name?.toLowerCase().includes("fob"))
  );

  const bridgeInfo = new Map();
  fobBridges.forEach((bridge) => {
    if (bridge.geometry.type === "Polygon" && bridge.geometry.coordinates[0]) {
      const coords = bridge.geometry.coordinates[0];
      const lats = coords.map((c) => c[1]);
      const lngs = coords.map((c) => c[0]);
      const avgLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      
      bridgeInfo.set(bridge.properties.id, {
        lat: avgLat,
        minLng,
        maxLng,
        minLat,
        maxLat,
        bridge
      });
    }
  });

  const result = [];
  let currentFOBSegment = null; // { startIdx, bridgeId, centerLat }
  
  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];
    const node = path[i];
    const nodeId = node.id;
    const nodeFloor = node.data?.floor || 0;

    const isOnFOBLevel = nodeFloor === 1;
    
    const isFOBNode = nodeId?.includes("fob") || 
                      nodeId === "n_fob_e_top" || 
                      nodeId === "n_fob_w_top" ||
                      nodeId === "n_fob_center_mid";

    if (isOnFOBLevel || isFOBNode) {
      let matchingBridge = null;
      let matchingBridgeId = null;
      
      for (const [bridgeId, info] of bridgeInfo.entries()) {
        if (
          coord[0] >= info.minLng &&
          coord[0] <= info.maxLng &&
          coord[1] >= info.minLat &&
          coord[1] <= info.maxLat
        ) {
          matchingBridge = info;
          matchingBridgeId = bridgeId;
          break;
        }
      }

      if (matchingBridge) {
        if (!currentFOBSegment) {
          currentFOBSegment = {
            startIdx: i,
            bridgeId: matchingBridgeId,
            centerLat: matchingBridge.lat
          };
        } else if (currentFOBSegment.bridgeId !== matchingBridgeId) {
          alignSegment(result, coordinates, currentFOBSegment.startIdx, i - 1, currentFOBSegment.centerLat);
          currentFOBSegment = {
            startIdx: i,
            bridgeId: matchingBridgeId,
            centerLat: matchingBridge.lat
          };
        }
      } else {
        if (currentFOBSegment) {
          alignSegment(result, coordinates, currentFOBSegment.startIdx, i - 1, currentFOBSegment.centerLat);
          currentFOBSegment = null;
        }
        result.push(coord);
      }
    } else {
      if (currentFOBSegment) {
        alignSegment(result, coordinates, currentFOBSegment.startIdx, i - 1, currentFOBSegment.centerLat);
        currentFOBSegment = null;
      }
      result.push(coord);
    }
  }

  if (currentFOBSegment) {
    alignSegment(result, coordinates, currentFOBSegment.startIdx, coordinates.length - 1, currentFOBSegment.centerLat);
  }

  return result;
}

function alignSegment(result, coordinates, startIdx, endIdx, centerLat) {
  for (let i = startIdx; i <= endIdx; i++) {
    const coord = coordinates[i];
    result.push([coord[0], centerLat]);
  }
}

export function getNavigationNodes(geojsonData) {
  return geojsonData.features
    .filter((f) => f.properties.type === "nav_node")
    .map((f) => ({
      id: f.properties.id,
      name: f.properties.name,
      floor: f.properties.floor || 0,
      coordinates: f.geometry.coordinates,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function calculatePathDistance(pathGeoJSON) {
  if (
    !pathGeoJSON ||
    !pathGeoJSON.geometry ||
    !pathGeoJSON.geometry.coordinates
  ) {
    return 0;
  }

  const coords = pathGeoJSON.geometry.coordinates;
  let totalDistance = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];

    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    totalDistance += R * c;
  }

  return Math.round(totalDistance);
}

export function getDirections(path) {
  if (!path || path.length < 2) {
    return [];
  }

  const directions = [];
  let currentFloor = path[0].data?.floor || 0;

  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    const nodeName = node.data?.name || node.id;
    const nodeId = node.id;
    const nodeFloor = node.data?.floor || 0;

    if (i === 0) {
      const floorLabel =
        nodeFloor === 0 ? "Ground Floor" : `Floor ${nodeFloor}`;
      directions.push(`Start at ${nodeName} (${floorLabel})`);
    } else if (i === path.length - 1) {
      const floorLabel =
        nodeFloor === 0 ? "Ground Floor" : `Floor ${nodeFloor}`;
      directions.push(`📍 Arrive at ${nodeName} (${floorLabel})`);
    } else {
      if (nodeFloor !== currentFloor) {
        const isGoingUp = nodeFloor > currentFloor;
        const floorChange = Math.abs(nodeFloor - currentFloor);

        if (nodeId && nodeId.includes("elevator")) {
          directions.push(
            `🛗 Take elevator ${
              isGoingUp ? "up" : "down"
            } ${floorChange} floor${floorChange > 1 ? "s" : ""} to ${
              nodeFloor === 0 ? "Ground Floor" : `Floor ${nodeFloor}`
            }`
          );
        } else if (nodeId && nodeId.includes("escalator")) {
          directions.push(
            `⬆️ Take escalator ${isGoingUp ? "up" : "down"} to ${
              nodeFloor === 0 ? "Ground Floor" : `Floor ${nodeFloor}`
            }`
          );
        } else if (nodeId && nodeId.includes("stairs")) {
          directions.push(
            `🪜 ${isGoingUp ? "Climb" : "Descend"} stairs to ${
              nodeFloor === 0 ? "Ground Floor" : `Floor ${nodeFloor}`
            }`
          );
        } else {
          directions.push(
            `${isGoingUp ? "⬆️" : "⬇️"} Go ${isGoingUp ? "up" : "down"} to ${
              nodeFloor === 0 ? "Ground Floor" : `Floor ${nodeFloor}`
            }`
          );
        }
        currentFloor = nodeFloor;
      } else if (nodeId && nodeId.includes("fob_")) {
        if (nodeId.includes("_top")) {
          directions.push(`🌉 Cross the foot overbridge`);
        } else if (nodeId.includes("_pf")) {
          const isEast = nodeId.includes("fob_e");
          directions.push(`🚶 Take stairs to FOB ${isEast ? "East" : "West"}`);
        }
      } else if (nodeName.toLowerCase().includes("platform")) {
        directions.push(`🚉 Walk along ${nodeName}`);
      } else if (nodeName.toLowerCase().includes("entrance")) {
        directions.push(`🚪 Go through ${nodeName}`);
      } else if (nodeName.toLowerCase().includes("parcel office")) {
        directions.push(`📦 Continue to ${nodeName}`);
      } else if (nodeName.toLowerCase().includes("waiting area")) {
        directions.push(`🪑 Continue to ${nodeName}`);
      } else if (nodeName.toLowerCase().includes("ticket counter")) {
        directions.push(`🎫 Continue to ${nodeName}`);
      } else if (
        nodeName.toLowerCase().includes("prs") ||
        nodeName.toLowerCase().includes("ticket booking")
      ) {
        directions.push(`🎟️ Continue to ${nodeName}`);
      } else if (
        nodeName.toLowerCase().includes("vehicle parking") ||
        nodeName.toLowerCase().includes("parking area")
      ) {
        directions.push(`🚗 Continue to ${nodeName}`);
      } else if (
        nodeName.toLowerCase().includes("park") ||
        nodeName.toLowerCase().includes("kalingana")
      ) {
        directions.push(`🌳 Continue to ${nodeName}`);
      } else if (
        nodeName.toLowerCase().includes("admin") ||
        nodeName.toLowerCase().includes("commercial") ||
        nodeName.toLowerCase().includes("control")
      ) {
        directions.push(`🏢 Enter ${nodeName}`);
      } else {
        directions.push(`Continue to ${nodeName}`);
      }
    }
  }

  return directions;
}
