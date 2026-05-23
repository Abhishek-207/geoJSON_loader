function simplifyPath(coordinates, edgeProperties) {
  if (!coordinates || coordinates.length < 2) {
    return coordinates;
  }

  const description = (edgeProperties.description || "").toLowerCase();
  const source = edgeProperties.source || "";
  const target = edgeProperties.target || "";

  const isFOB =
    description.includes("fob") ||
    description.includes("foot overbridge") ||
    source.includes("fob") ||
    target.includes("fob") ||
    source.includes("fob_e_top") ||
    source.includes("fob_w_top") ||
    target.includes("fob_e_top") ||
    target.includes("fob_w_top");

  const isPlatform =
    description.includes("platform") ||
    source.includes("platform") ||
    target.includes("platform");

  if (isFOB || isPlatform) {
    return [coordinates[0], coordinates[coordinates.length - 1]];
  }

  if (coordinates.length > 10) {
    const simplified = [coordinates[0]];
    const step = Math.floor(coordinates.length / 5);
    for (let i = step; i < coordinates.length - 1; i += step) {
      simplified.push(coordinates[i]);
    }
    simplified.push(coordinates[coordinates.length - 1]);
    return simplified;
  }

  return coordinates;
}

function isPlatformNode(nodeId, nodeName) {
  const name = (nodeName || "").toLowerCase();
  return (
    name.includes("platform") ||
    nodeId.includes("platform") ||
    nodeId.startsWith("platform_") ||
    nodeId.includes("_coach_")
  );
}

function isFOBNode(nodeId, nodeName, nodeFloor) {
  const name = (nodeName || "").toLowerCase();
  return (
    (nodeFloor === 1 && (nodeId.includes("fob") || name.includes("fob"))) ||
    nodeId === "n_fob_e_top" ||
    nodeId === "n_fob_w_top" ||
    nodeId === "n_fob_center_mid" ||
    nodeId.includes("fob_e_") ||
    nodeId.includes("fob_w_")
  );
}

function areOnSameStructure(node1, node2, geojsonData) {
  const node1Feature = geojsonData.features.find(
    (f) => f.properties.id === node1.id && f.properties.type === "nav_node"
  );
  const node2Feature = geojsonData.features.find(
    (f) => f.properties.id === node2.id && f.properties.type === "nav_node"
  );

  if (!node1Feature || !node2Feature) return false;

  const node1Id = node1.id;
  const node1Name = node1Feature.properties.name || "";
  const node1Floor = node1Feature.properties.floor || 0;

  const node2Id = node2.id;
  const node2Name = node2Feature.properties.name || "";
  const node2Floor = node2Feature.properties.floor || 0;

  if (
    isFOBNode(node1Id, node1Name, node1Floor) &&
    isFOBNode(node2Id, node2Name, node2Floor)
  ) {
    return true;
  }

  if (
    isPlatformNode(node1Id, node1Name) &&
    isPlatformNode(node2Id, node2Name)
  ) {
    const getPlatformId = (id, name) => {
      const coachMatch = id.match(/^(platform_\d+|local_platform_\d+)/);
      if (coachMatch) return coachMatch[1];

      const platformMatch =
        name.match(/platform\s*(\d+)/i) || id.match(/platform[_\s]*(\d+)/i);
      if (platformMatch) {
        const isLocal =
          name.toLowerCase().includes("local") || id.includes("local");
        return `${isLocal ? "local_" : ""}platform_${platformMatch[1]}`;
      }

      if (name.toLowerCase().includes("local") || id.includes("local")) {
        return "local_platform";
      }
      if (name.toLowerCase().includes("main") || id.includes("main")) {
        return "main_platform";
      }

      return null;
    };

    const platform1 = getPlatformId(node1Id, node1Name);
    const platform2 = getPlatformId(node2Id, node2Name);

    if (platform1 && platform2 && platform1 === platform2) {
      return true;
    }

    const isLocal1 =
      node1Name.toLowerCase().includes("local") || node1Id.includes("local");
    const isLocal2 =
      node2Name.toLowerCase().includes("local") || node2Id.includes("local");
    const isMain1 =
      node1Name.toLowerCase().includes("main") || node1Id.includes("main");
    const isMain2 =
      node2Name.toLowerCase().includes("main") || node2Id.includes("main");

    if ((isLocal1 && isLocal2) || (isMain1 && isMain2)) {
      const num1 = (node1Name.match(/platform\s*(\d+)/i) ||
        node1Id.match(/platform[_\s]*(\d+)/i))?.[1];
      const num2 = (node2Name.match(/platform\s*(\d+)/i) ||
        node2Id.match(/platform[_\s]*(\d+)/i))?.[1];
      if (num1 && num2 && num1 === num2) {
        return true;
      }
    }
  }

  return false;
}

function collapseContinuousSegments(nodePath, geojsonData) {
  if (!nodePath || nodePath.length < 2) {
    return nodePath;
  }

  const collapsed = [nodePath[0]];
  let segmentStart = 0;

  for (let i = 1; i < nodePath.length; i++) {
    const prevNode = nodePath[i - 1];
    const currNode = nodePath[i];

    if (areOnSameStructure(prevNode, currNode, geojsonData)) {
      continue;
    } else {
      if (i - segmentStart > 1) {
        if (collapsed[collapsed.length - 1].id !== nodePath[segmentStart].id) {
          collapsed.push(nodePath[segmentStart]);
        }
        collapsed.push(nodePath[i - 1]);
      } else {
        if (collapsed[collapsed.length - 1].id !== nodePath[i - 1].id) {
          collapsed.push(nodePath[i - 1]);
        }
      }
      collapsed.push(currNode);
      segmentStart = i;
    }
  }

  if (segmentStart < nodePath.length - 1) {
    const lastNode = nodePath[nodePath.length - 1];
    const secondLastNode = nodePath[nodePath.length - 2];

    if (areOnSameStructure(secondLastNode, lastNode, geojsonData)) {
      if (collapsed[collapsed.length - 1].id !== secondLastNode.id) {
        collapsed.push(secondLastNode);
      }
    }
    if (collapsed[collapsed.length - 1].id !== lastNode.id) {
      collapsed.push(lastNode);
    }
  } else {
    if (
      collapsed[collapsed.length - 1].id !== nodePath[nodePath.length - 1].id
    ) {
      collapsed.push(nodePath[nodePath.length - 1]);
    }
  }

  return collapsed;
}

export function buildRoutePaths(geojsonData) {
  const routePaths = new Map();

  geojsonData.features.forEach((feature) => {
    if (feature.properties.type === "nav_edge") {
      const { source, target } = feature.properties;
      const key = `${source}->${target}`;
      const reverseKey = `${target}->${source}`;

      if (
        feature.geometry.type === "LineString" &&
        feature.geometry.coordinates.length > 1
      ) {
        const simplifiedPath = simplifyPath(
          feature.geometry.coordinates,
          feature.properties
        );
        routePaths.set(key, simplifiedPath);
        routePaths.set(reverseKey, [...simplifiedPath].reverse());
      }
    }
  });

  return routePaths;
}

export function getRoutePath(sourceNodeId, targetNodeId, routePaths) {
  const key = `${sourceNodeId}->${targetNodeId}`;
  return routePaths.get(key) || null;
}

function getFOBBridgeInfo(geojsonData) {
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
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      const centerLat = (minLat + maxLat) / 2;

      bridgeInfo.set(bridge.properties.id, {
        lat: centerLat,
        minLng,
        maxLng,
        minLat,
        maxLat,
        bridge,
      });
    }
  });

  return bridgeInfo;
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

function findFOBBridgeForCoord(coord, bridgeInfo) {
  for (const [bridgeId, info] of bridgeInfo.entries()) {
    if (
      coord[0] >= info.minLng &&
      coord[0] <= info.maxLng &&
      coord[1] >= info.minLat &&
      coord[1] <= info.maxLat
    ) {
      if (
        info.bridge &&
        info.bridge.geometry.type === "Polygon" &&
        info.bridge.geometry.coordinates[0]
      ) {
        const polygon = info.bridge.geometry.coordinates[0];
        if (pointInPolygon(coord, polygon)) {
          return { bridgeId, centerLat: info.lat };
        }
      } else {
        return { bridgeId, centerLat: info.lat };
      }
    }
  }

  const extendFactor = 0.0002;
  for (const [bridgeId, info] of bridgeInfo.entries()) {
    const extendedMinLng = info.minLng - extendFactor;
    const extendedMaxLng = info.maxLng + extendFactor;
    const extendedMinLat = info.minLat - extendFactor;
    const extendedMaxLat = info.maxLat + extendFactor;

    if (
      coord[0] >= extendedMinLng &&
      coord[0] <= extendedMaxLng &&
      coord[1] >= extendedMinLat &&
      coord[1] <= extendedMaxLat
    ) {
      if (
        info.bridge &&
        info.bridge.geometry.type === "Polygon" &&
        info.bridge.geometry.coordinates[0]
      ) {
        const polygon = info.bridge.geometry.coordinates[0];
        if (pointInPolygon(coord, polygon)) {
          return { bridgeId, centerLat: info.lat };
        }
      } else {
        return { bridgeId, centerLat: info.lat };
      }
    }
  }

  return null;
}

function isNodeOnFOB(nodeId, nodeName, nodeFloor) {
  return isFOBNode(nodeId, nodeName, nodeFloor);
}

function findClosestFOBBridge(coord, bridgeInfo) {
  let closestBridge = null;
  let minDistance = Infinity;

  for (const [bridgeId, info] of bridgeInfo.entries()) {
    const bridgeCenterLng = (info.minLng + info.maxLng) / 2;
    const bridgeCenterLat = info.lat;
    const dist = Math.sqrt(
      Math.pow(coord[0] - bridgeCenterLng, 2) +
        Math.pow(coord[1] - bridgeCenterLat, 2)
    );

    if (dist < minDistance) {
      minDistance = dist;
      closestBridge = { bridgeId, centerLat: info.lat };
    }
  }

  if (closestBridge && minDistance < 0.002) {
    return closestBridge;
  }

  return null;
}

export function nodePathToRoutePath(nodePath, routePaths, geojsonData) {
  if (!nodePath || nodePath.length < 2) {
    return [];
  }

  const fobBridgeInfo = getFOBBridgeInfo(geojsonData);

  const collapsedPath = collapseContinuousSegments(nodePath, geojsonData);

  const startNode = collapsedPath[0];
  const endNode = collapsedPath[collapsedPath.length - 1];

  const startNodeFeature = geojsonData.features.find(
    (f) => f.properties.id === startNode.id && f.properties.type === "nav_node"
  );
  const endNodeFeature = geojsonData.features.find(
    (f) => f.properties.id === endNode.id && f.properties.type === "nav_node"
  );

  const exactStartCoord = startNodeFeature?.geometry.coordinates || null;
  const exactEndCoord = endNodeFeature?.geometry.coordinates || null;

  const result = [];

  for (let i = 0; i < collapsedPath.length - 1; i++) {
    const currentNode = collapsedPath[i];
    const nextNode = collapsedPath[i + 1];

    // Get node coordinates
    const currentNodeFeature = geojsonData.features.find(
      (f) =>
        f.properties.id === currentNode.id && f.properties.type === "nav_node"
    );
    const nextNodeFeature = geojsonData.features.find(
      (f) => f.properties.id === nextNode.id && f.properties.type === "nav_node"
    );

    if (!currentNodeFeature || !nextNodeFeature) continue;

    let currentCoord = currentNodeFeature.geometry.coordinates;
    let nextCoord = nextNodeFeature.geometry.coordinates;

    if (areOnSameStructure(currentNode, nextNode, geojsonData)) {
      const currentNodeFloor = currentNodeFeature.properties.floor || 0;
      const nextNodeFloor = nextNodeFeature.properties.floor || 0;
      const currentNodeName = currentNodeFeature.properties.name || "";
      const nextNodeName = nextNodeFeature.properties.name || "";

      const currentIsFOB = isFOBNode(
        currentNode.id,
        currentNodeName,
        currentNodeFloor
      );
      const nextIsFOB = isFOBNode(nextNode.id, nextNodeName, nextNodeFloor);

      const pathSegment = getRoutePath(currentNode.id, nextNode.id, routePaths);

      if (
        currentIsFOB ||
        nextIsFOB ||
        currentNodeFloor === 1 ||
        nextNodeFloor === 1
      ) {
        let fobPath = pathSegment;

        if (!fobPath || fobPath.length < 2) {
          fobPath = [currentCoord, nextCoord];
        }

        let bridge1 = findFOBBridgeForCoord(currentCoord, fobBridgeInfo);
        let bridge2 = findFOBBridgeForCoord(nextCoord, fobBridgeInfo);

        if (!bridge1 && (currentIsFOB || currentNodeFloor === 1)) {
          bridge1 = findClosestFOBBridge(currentCoord, fobBridgeInfo);
        }
        if (!bridge2 && (nextIsFOB || nextNodeFloor === 1)) {
          bridge2 = findClosestFOBBridge(nextCoord, fobBridgeInfo);
        }

        let targetBridge = null;
        if (bridge1 && bridge2 && bridge1.bridgeId === bridge2.bridgeId) {
          targetBridge = bridge1;
        } else if (bridge1) {
          targetBridge = bridge1;
        } else if (bridge2) {
          targetBridge = bridge2;
        }

        if (targetBridge) {
          const alignedFobPath = fobPath.map((coord) => {
            return [coord[0], targetBridge.centerLat];
          });

          if (i === 0) {
            result.push(...alignedFobPath);
          } else {
            const lastCoord = result[result.length - 1];
            const firstCoord = alignedFobPath[0];
            const tolerance = 0.00001;
            const isSame =
              Math.abs(lastCoord[0] - firstCoord[0]) < tolerance &&
              Math.abs(lastCoord[1] - firstCoord[1]) < tolerance;

            if (isSame) {
              result.push(...alignedFobPath.slice(1));
            } else {
              result.push(...alignedFobPath);
            }
          }
        } else {
          // No bridge found, use path as-is
          if (i === 0) {
            result.push(...fobPath);
          } else {
            const lastCoord = result[result.length - 1];
            const firstCoord = fobPath[0];
            const tolerance = 0.00001;
            const isSame =
              Math.abs(lastCoord[0] - firstCoord[0]) < tolerance &&
              Math.abs(lastCoord[1] - firstCoord[1]) < tolerance;

            if (isSame) {
              result.push(...fobPath.slice(1));
            } else {
              result.push(...fobPath);
            }
          }
        }
      } else {
        if (pathSegment && pathSegment.length > 0) {
          if (i === 0) {
            result.push(...pathSegment);
          } else {
            const lastCoord = result[result.length - 1];
            const firstCoord = pathSegment[0];
            const tolerance = 0.00001;
            const isSame =
              Math.abs(lastCoord[0] - firstCoord[0]) < tolerance &&
              Math.abs(lastCoord[1] - firstCoord[1]) < tolerance;

            if (isSame) {
              result.push(...pathSegment.slice(1));
            } else {
              result.push(...pathSegment);
            }
          }
        } else {
          // Fallback: straight line
          if (i === 0) {
            result.push(currentCoord);
          }
          result.push(nextCoord);
        }
      }
    } else {
      const pathSegment = getRoutePath(currentNode.id, nextNode.id, routePaths);

      const edgeFeature = geojsonData.features.find(
        (f) =>
          f.properties.type === "nav_edge" &&
          f.properties.source === currentNode.id &&
          f.properties.target === nextNode.id
      );

      if (pathSegment && pathSegment.length > 0) {
        const isStaircase =
          edgeFeature?.properties.description
            ?.toLowerCase()
            .includes("stair") ||
          edgeFeature?.properties.description
            ?.toLowerCase()
            .includes("climb") ||
          currentNode.id.includes("stair") ||
          nextNode.id.includes("stair");
        const isLift =
          edgeFeature?.properties.description?.toLowerCase().includes("lift") ||
          currentNode.id.includes("lift") ||
          nextNode.id.includes("lift");

        const connectsToFOB =
          nextNode.id.includes("fob") ||
          nextNode.id === "n_fob_e_top" ||
          nextNode.id === "n_fob_w_top" ||
          currentNode.id.includes("fob") ||
          currentNode.id === "n_fob_e_top" ||
          currentNode.id === "n_fob_w_top";

        if (isStaircase || isLift) {
          if (i === 0) {
            if (exactStartCoord && pathSegment.length > 0) {
              const firstEdgeCoord = pathSegment[0];
              const dist = Math.sqrt(
                Math.pow(firstEdgeCoord[0] - exactStartCoord[0], 2) +
                  Math.pow(firstEdgeCoord[1] - exactStartCoord[1], 2)
              );
              if (dist > 0.00001) {
                // Replace first point with exact start coordinate
                result.push(exactStartCoord, ...pathSegment.slice(1));
              } else {
                result.push(...pathSegment);
              }
            } else {
              result.push(...pathSegment);
            }
          } else {
            const lastCoord = result[result.length - 1];
            const firstCoord = pathSegment[0];
            const tolerance = 0.00001;
            const isSame =
              Math.abs(lastCoord[0] - firstCoord[0]) < tolerance &&
              Math.abs(lastCoord[1] - firstCoord[1]) < tolerance;

            if (isSame) {
              result.push(...pathSegment.slice(1));
            } else {
              result.push(...pathSegment);
            }
          }
        } else if (connectsToFOB) {
          if (i === 0) {
            if (exactStartCoord && pathSegment.length > 0) {
              const firstEdgeCoord = pathSegment[0];
              const dist = Math.sqrt(
                Math.pow(firstEdgeCoord[0] - exactStartCoord[0], 2) +
                  Math.pow(firstEdgeCoord[1] - exactStartCoord[1], 2)
              );
              if (dist > 0.00001) {
                // Replace first point with exact start coordinate
                result.push(exactStartCoord, ...pathSegment.slice(1));
              } else {
                result.push(...pathSegment);
              }
            } else {
              result.push(...pathSegment);
            }
          } else {
            const lastCoord = result[result.length - 1];
            const firstCoord = pathSegment[0];
            const tolerance = 0.00001;
            const isSame =
              Math.abs(lastCoord[0] - firstCoord[0]) < tolerance &&
              Math.abs(lastCoord[1] - firstCoord[1]) < tolerance;

            if (isSame) {
              result.push(...pathSegment.slice(1));
            } else {
              result.push(...pathSegment);
            }
          }
        } else {
          const simplified = simplifyPath(pathSegment, {
            source: currentNode.id,
            target: nextNode.id,
            description: edgeFeature?.properties.description || "",
          });
          if (i === 0) {
            if (exactStartCoord && simplified.length > 0) {
              const firstSimplifiedCoord = simplified[0];
              const dist = Math.sqrt(
                Math.pow(firstSimplifiedCoord[0] - exactStartCoord[0], 2) +
                  Math.pow(firstSimplifiedCoord[1] - exactStartCoord[1], 2)
              );
              if (dist > 0.00001) {
                result.push(exactStartCoord, ...simplified.slice(1));
              } else {
                result.push(...simplified);
              }
            } else {
              result.push(...simplified);
            }
          } else {
            const lastCoord = result[result.length - 1];
            const firstCoord = simplified[0];
            const tolerance = 0.00001;
            const isSame =
              Math.abs(lastCoord[0] - firstCoord[0]) < tolerance &&
              Math.abs(lastCoord[1] - firstCoord[1]) < tolerance;

            if (isSame) {
              result.push(...simplified.slice(1));
            } else {
              result.push(...simplified);
            }
          }
        }
      } else {
        if (i === 0) {
          result.push(currentCoord);
        }
        result.push(nextCoord);
      }
    }
  }

  const coordToNodeMap = new Map();
  for (let i = 0; i < collapsedPath.length; i++) {
    const node = collapsedPath[i];
    const nodeFeature = geojsonData.features.find(
      (f) => f.properties.id === node.id && f.properties.type === "nav_node"
    );
    if (nodeFeature) {
      const nodeCoord = nodeFeature.geometry.coordinates;
      const key = `${nodeCoord[0].toFixed(6)},${nodeCoord[1].toFixed(6)}`;
      coordToNodeMap.set(key, {
        nodeId: node.id,
        nodeName: nodeFeature.properties.name || "",
        nodeFloor: nodeFeature.properties.floor || 0,
      });
    }
  }

  const fobSegments = [];
  let currentFobSegment = null;

  for (let i = 0; i < collapsedPath.length; i++) {
    const node = collapsedPath[i];
    const nodeFeature = geojsonData.features.find(
      (f) => f.properties.id === node.id && f.properties.type === "nav_node"
    );

    if (nodeFeature) {
      const nodeFloor = nodeFeature.properties.floor || 0;
      const nodeName = nodeFeature.properties.name || "";
      const isFOB = isFOBNode(node.id, nodeName, nodeFloor) || nodeFloor === 1;

      if (isFOB) {
        if (!currentFobSegment) {
          currentFobSegment = { startIdx: i, endIdx: i, nodes: [node] };
        } else {
          currentFobSegment.endIdx = i;
          currentFobSegment.nodes.push(node);
        }
      } else {
        if (currentFobSegment) {
          fobSegments.push(currentFobSegment);
          currentFobSegment = null;
        }
      }
    }
  }

  if (currentFobSegment) {
    fobSegments.push(currentFobSegment);
  }

  const segmentBridgeMap = new Map();
  for (const segment of fobSegments) {
    let segmentBridge = null;

    for (const node of segment.nodes) {
      const nodeFeature = geojsonData.features.find(
        (f) => f.properties.id === node.id && f.properties.type === "nav_node"
      );
      if (nodeFeature) {
        const nodeCoord = nodeFeature.geometry.coordinates;
        const bridge =
          findFOBBridgeForCoord(nodeCoord, fobBridgeInfo) ||
          findClosestFOBBridge(nodeCoord, fobBridgeInfo);

        if (bridge) {
          segmentBridge = bridge;
          break;
        }
      }
    }

    if (segmentBridge) {
      for (let idx = segment.startIdx; idx <= segment.endIdx; idx++) {
        segmentBridgeMap.set(idx, segmentBridge);
      }
    }
  }

  const aligned = [];
  let currentFOBBridge = null;

  for (let i = 0; i < result.length; i++) {
    const coord = result[i];

    let targetBridge = null;

    targetBridge = findFOBBridgeForCoord(coord, fobBridgeInfo);

    if (!targetBridge) {
      for (const [bridgeId, info] of fobBridgeInfo.entries()) {
        if (
          coord[0] >= info.minLng - 0.0001 &&
          coord[0] <= info.maxLng + 0.0001
        ) {
          const latDiff = Math.abs(coord[1] - info.lat);
          const bridgeWidth = (info.maxLat - info.minLat) / 2;

          if (
            coord[1] >= info.minLat - 0.0001 &&
            coord[1] <= info.maxLat + 0.0001
          ) {
            targetBridge = { bridgeId, centerLat: info.lat };
            break;
          } else if (latDiff <= bridgeWidth * 2) {
            targetBridge = { bridgeId, centerLat: info.lat };
            break;
          }
        }
      }
    }

    if (!targetBridge) {
      const coordKey = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
      const nodeInfo = coordToNodeMap.get(coordKey);

      if (
        nodeInfo &&
        isNodeOnFOB(nodeInfo.nodeId, nodeInfo.nodeName, nodeInfo.nodeFloor)
      ) {
        targetBridge = findClosestFOBBridge(coord, fobBridgeInfo);
      }
    }

    if (!targetBridge && i > 0 && i < result.length - 1) {
      const prevCoord = result[i - 1];
      const nextCoord = result[i + 1];

      const prevBridge = findFOBBridgeForCoord(prevCoord, fobBridgeInfo);
      const nextBridge = findFOBBridgeForCoord(nextCoord, fobBridgeInfo);

      if (
        prevBridge &&
        nextBridge &&
        prevBridge.bridgeId === nextBridge.bridgeId
      ) {
        targetBridge = prevBridge;
      } else if (prevBridge) {
        const dist = Math.sqrt(
          Math.pow(coord[0] - prevCoord[0], 2) +
            Math.pow(coord[1] - prevCoord[1], 2)
        );
        if (dist < 0.002) {
          targetBridge = prevBridge;
        }
      } else if (nextBridge) {
        const dist = Math.sqrt(
          Math.pow(coord[0] - nextCoord[0], 2) +
            Math.pow(coord[1] - nextCoord[1], 2)
        );
        if (dist < 0.002) {
          targetBridge = nextBridge;
        }
      }
    }

    if (!targetBridge && currentFOBBridge) {
      const info = fobBridgeInfo.get(currentFOBBridge.bridgeId);
      if (info) {
        if (
          coord[0] >= info.minLng - 0.0003 &&
          coord[0] <= info.maxLng + 0.0003 &&
          coord[1] >= info.minLat - 0.0003 &&
          coord[1] <= info.maxLat + 0.0003
        ) {
          targetBridge = currentFOBBridge;
        }
      }
    }

    if (targetBridge) {
      if (
        !currentFOBBridge ||
        currentFOBBridge.bridgeId !== targetBridge.bridgeId
      ) {
        currentFOBBridge = targetBridge;
      }
      aligned.push([coord[0], currentFOBBridge.centerLat]);
    } else {
      let isNearAnyFOB = false;
      for (const [bridgeId, info] of fobBridgeInfo.entries()) {
        if (
          coord[0] >= info.minLng - 0.0003 &&
          coord[0] <= info.maxLng + 0.0003 &&
          coord[1] >= info.minLat - 0.0003 &&
          coord[1] <= info.maxLat + 0.0003
        ) {
          isNearAnyFOB = true;
          break;
        }
      }

      if (!isNearAnyFOB) {
        currentFOBBridge = null;
      }
      aligned.push(coord);
    }
  }

  if (exactStartCoord && aligned.length > 1) {
    const firstCoord = aligned[0];
    const secondCoord = aligned[1];

    aligned[0] = exactStartCoord;

    const startNodeName = startNodeFeature?.properties.name || "";
    const isPlatform =
      startNodeName.toLowerCase().includes("platform") ||
      startNode.id.includes("platform") ||
      startNode.id.includes("entrance") ||
      startNode.id.includes("coach");

    if (isPlatform && aligned.length > 1) {
      const secondCoord = aligned[1];
      const dx = Math.abs(secondCoord[0] - exactStartCoord[0]);
      const dy = Math.abs(secondCoord[1] - exactStartCoord[1]);

      if (dx > 0.00001 && dy > 0.00001) {
        if (dx > dy) {
          aligned[1] = [secondCoord[0], exactStartCoord[1]];
        } else {
          aligned[1] = [exactStartCoord[0], secondCoord[1]];
        }
      } else if (dx > dy) {
        aligned[1] = [secondCoord[0], exactStartCoord[1]];
      } else if (dy > dx) {
        aligned[1] = [exactStartCoord[0], secondCoord[1]];
      }

      if (aligned.length > 2) {
        const thirdCoord = aligned[2];
        const secondCoordAligned = aligned[1];
        const dx2 = Math.abs(thirdCoord[0] - secondCoordAligned[0]);
        const dy2 = Math.abs(thirdCoord[1] - secondCoordAligned[1]);

        if (dx2 > 0.00001 && dy2 > 0.00001) {
          if (dx2 > dy2) {
            aligned[2] = [thirdCoord[0], secondCoordAligned[1]];
          } else {
            aligned[2] = [secondCoordAligned[0], thirdCoord[1]];
          }
        }
      }
    }
  }

  if (exactEndCoord && aligned.length > 1) {
    const lastCoord = aligned[aligned.length - 1];
    const secondLastCoord = aligned[aligned.length - 2];

    aligned[aligned.length - 1] = exactEndCoord;

    const endNodeName = endNodeFeature?.properties.name || "";
    const isPlatform =
      endNodeName.toLowerCase().includes("platform") ||
      endNode.id.includes("platform") ||
      endNode.id.includes("entrance") ||
      endNode.id.includes("coach");

    if (isPlatform && aligned.length > 1) {
      const secondLastCoord = aligned[aligned.length - 2];
      const dx = Math.abs(exactEndCoord[0] - secondLastCoord[0]);
      const dy = Math.abs(exactEndCoord[1] - secondLastCoord[1]);

      if (dx > 0.00001 && dy > 0.00001) {
        if (dx > dy) {
          aligned[aligned.length - 2] = [secondLastCoord[0], exactEndCoord[1]];
        } else {
          aligned[aligned.length - 2] = [exactEndCoord[0], secondLastCoord[1]];
        }
      } else if (dx > dy) {
        aligned[aligned.length - 2] = [secondLastCoord[0], exactEndCoord[1]];
      } else if (dy > dx) {
        aligned[aligned.length - 2] = [exactEndCoord[0], secondLastCoord[1]];
      }

      if (aligned.length > 2) {
        const thirdLastCoord = aligned[aligned.length - 3];
        const secondLastCoordAligned = aligned[aligned.length - 2];
        const dx2 = Math.abs(secondLastCoordAligned[0] - thirdLastCoord[0]);
        const dy2 = Math.abs(secondLastCoordAligned[1] - thirdLastCoord[1]);

        if (dx2 > 0.00001 && dy2 > 0.00001) {
          if (dx2 > dy2) {
            aligned[aligned.length - 3] = [
              thirdLastCoord[0],
              secondLastCoordAligned[1],
            ];
          } else {
            aligned[aligned.length - 3] = [
              secondLastCoordAligned[0],
              thirdLastCoord[1],
            ];
          }
        }
      }
    }
  }

  const cleaned = [];
  const tolerance = 0.00001;

  for (let i = 0; i < aligned.length; i++) {
    if (i === 0) {
      cleaned.push(aligned[i]);
    } else if (i === aligned.length - 1) {
      cleaned.push(aligned[i]);
    } else {
      const prev = cleaned[cleaned.length - 1];
      const curr = aligned[i];

      const dist = Math.sqrt(
        Math.pow(curr[0] - prev[0], 2) + Math.pow(curr[1] - prev[1], 2)
      );

      if (dist > tolerance) {
        const prevBridge = findFOBBridgeForCoord(prev, fobBridgeInfo);
        const currBridge = findFOBBridgeForCoord(curr, fobBridgeInfo);

        if (prevBridge && !currBridge) {
          cleaned.push(curr);
        } else if (!prevBridge && currBridge) {
          cleaned.push(curr);
        } else if (
          prevBridge &&
          currBridge &&
          prevBridge.bridgeId !== currBridge.bridgeId
        ) {
          cleaned.push(curr);
        } else {
          cleaned.push(curr);
        }
      }
    }
  }

  return cleaned;
}
