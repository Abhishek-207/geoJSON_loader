const fs = require("fs");
const path = require("path");

// Read the station data
const stationDataPath = path.join(__dirname, "../data/station_data.json");
const stationData = JSON.parse(fs.readFileSync(stationDataPath, "utf-8"));

function calculatePolylineLength(coordinates) {
  let totalLength = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[i + 1];

    const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
    const dLat = (lat2 - lat1) * 110540;
    const distance = Math.sqrt(dLng * dLng + dLat * dLat);
    totalLength += distance;
  }
  return totalLength;
}

function getPointAtDistance(coordinates, targetDistance) {
  let accumulatedDistance = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[i + 1];

    const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
    const dLat = (lat2 - lat1) * 110540;
    const segmentLength = Math.sqrt(dLng * dLng + dLat * dLat);

    if (accumulatedDistance + segmentLength >= targetDistance) {
      const ratio = (targetDistance - accumulatedDistance) / segmentLength;
      return [lng1 + (lng2 - lng1) * ratio, lat1 + (lat2 - lat1) * ratio];
    }

    accumulatedDistance += segmentLength;
  }

  return coordinates[coordinates.length - 1];
}

function generateCoaches(
  platformCoordinates,
  numCoaches,
  platformId,
  platformName,
  navNodeId
) {
  const platformLine = platformCoordinates[0];
  const totalLength = calculatePolylineLength(platformLine);

  const isLocalPlatform = platformId.startsWith("local_platform_");
  const isBCTMainPlatform = platformId.startsWith("platform_") && !isLocalPlatform;
  const baseSpacing = totalLength / (numCoaches + 1);
  let spacing;
  if (isLocalPlatform) {
    spacing = baseSpacing * 0.5;
  } else if (isBCTMainPlatform) {
    spacing = baseSpacing * 0.5; // Reduce gap to half for BCT Main Platforms
  } else {
    spacing = baseSpacing;
  }

  const coaches = [];

  for (let i = 0; i < numCoaches; i++) {
    const distance = spacing * (i + 1);
    const [lng, lat] = getPointAtDistance(platformLine, distance);

    const coachWidth = 0.00001;
    const coachLength = 0.00001;

    const coachPolygon = [
      [lng - coachWidth, lat - coachLength],
      [lng + coachWidth, lat - coachLength],
      [lng + coachWidth, lat + coachLength],
      [lng - coachWidth, lat + coachLength],
      [lng - coachWidth, lat - coachLength],
    ];

    const coachNumber = i + 1;
    const coachId = `${platformId}_coach_${coachNumber}`;
    const coachName = `Coach ${coachNumber}`;
    const fullCoachName = `${platformName} ${coachName}`;

    const coachFeature = {
      type: "Feature",
      properties: {
        id: coachId,
        name: fullCoachName,
        type: "coach",
        category: "coach",
        floor: 0,
        color: "#FFD700",
        height: 3.5,
        base: 0,
        coachNumber: coachNumber,
        platform: platformId,
      },
      geometry: {
        type: "Polygon",
        coordinates: [coachPolygon],
      },
    };

    const navNode = {
      type: "Feature",
      properties: {
        id: coachId,
        name: fullCoachName,
        type: "nav_node",
        category: "coach",
        floor: 0,
        coachNumber: coachNumber,
        platform: platformId,
      },
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
    };

    coaches.push({
      coachFeature,
      navNode,
      coordinates: [lng, lat],
      id: coachId,
    });
  }

  return coaches;
}

function generateEngine(
  platformCoordinates,
  platformId,
  platformName,
  numCoaches
) {
  const platformLine = platformCoordinates[0];
  const totalLength = calculatePolylineLength(platformLine);

  const isLocalPlatform = platformId.startsWith("local_platform_");
  const isBCTMainPlatform = platformId.startsWith("platform_") && !isLocalPlatform;
  const baseSpacing = totalLength / (numCoaches + 1);
  let spacing;
  if (isLocalPlatform) {
    spacing = baseSpacing * 0.5;
  } else if (isBCTMainPlatform) {
    spacing = baseSpacing * 0.5; // Reduce gap to half for BCT Main Platforms
  } else {
    spacing = baseSpacing;
  }

  const engineDistance = spacing * 0.5;
  const [engineLng, engineLat] = getPointAtDistance(
    platformLine,
    engineDistance
  );

  const engineWidth = 0.00002;
  const engineLength = 0.00002;

  const enginePolygon = [
    [engineLng - engineWidth, engineLat - engineLength],
    [engineLng + engineWidth, engineLat - engineLength],
    [engineLng + engineWidth, engineLat + engineLength],
    [engineLng - engineWidth, engineLat + engineLength],
    [engineLng - engineWidth, engineLat - engineLength],
  ];

  const engineId = `${platformId}_engine`;
  const engineName = "Engine";

  const engineFeature = {
    type: "Feature",
    properties: {
      id: engineId,
      name: engineName,
      type: "engine",
      category: "engine",
      floor: 0,
      color: "#8B4513",
      height: 3.5,
      base: 0,
      platform: platformId,
    },
    geometry: {
      type: "Polygon",
      coordinates: [enginePolygon],
    },
  };

  return engineFeature;
}

function generateCoachNavEdges(coaches, platformNavNodeId, platformName) {
  const edges = [];

  coaches.forEach((coach, index) => {
    const coachId = coach.id;

    if (index === 0 || index === coaches.length - 1) {
      edges.push({
        type: "Feature",
        properties: {
          id: `edge_${coachId}_${platformNavNodeId}`,
          type: "nav_edge",
          source: coachId,
          target: platformNavNodeId,
          weight: 2,
          description: `Walk from ${coach.coachFeature.properties.name} to ${platformName}`,
        },
        geometry: {
          type: "LineString",
          coordinates: [coach.coordinates, coach.coordinates],
        },
      });
    }

    if (index > 0) {
      const prevCoach = coaches[index - 1];
      const prevCoachId = prevCoach.id;

      edges.push({
        type: "Feature",
        properties: {
          id: `edge_${prevCoachId}_${coachId}`,
          type: "nav_edge",
          source: prevCoachId,
          target: coachId,
          weight: 1,
          description: `Walk between coaches`,
        },
        geometry: {
          type: "LineString",
          coordinates: [prevCoach.coordinates, coach.coordinates],
        },
      });
    }
  });

  return edges;
}

const platforms = {
  platform_1: {
    name: "BCT Main Platform 1",
    numCoaches: 24,
    navNodeId: "n_platform_1",
  },
  platform_2: {
    name: "BCT Main Platform 2",
    numCoaches: 24,
    navNodeId: "n_platform_2",
  },
  platform_3: {
    name: "BCT Main Platform 3",
    numCoaches: 24,
    navNodeId: "n_platform_3",
  },
  platform_4: {
    name: "BCT Main Platform 4",
    numCoaches: 24,
    navNodeId: "n_platform_4",
  },
  platform_5: {
    name: "BCT Main Platform 5",
    numCoaches: 24,
    navNodeId: "n_platform_5",
  },
  local_platform_1: {
    name: "BCT Local Platform 1",
    numCoaches: 12,
    navNodeId: "n_local_platform_1",
  },
  local_platform_2: {
    name: "BCT Local Platform 2",
    numCoaches: 12,
    navNodeId: "n_local_platform_2",
  },
  local_platform_3: {
    name: "BCT Local Platform 3",
    numCoaches: 12,
    navNodeId: "n_local_platform_3",
  },
  local_platform_4: {
    name: "BCT Local Platform 4",
    numCoaches: 12,
    navNodeId: "n_local_platform_4",
  },
};

console.log("Extracting platform data...");
const platformData = {};
Object.keys(platforms).forEach((platformId) => {
  const feature = stationData.features.find(
    (f) => f.properties.id === platformId
  );
  if (feature) {
    platformData[platformId] = {
      ...platforms[platformId],
      coordinates: feature.geometry.coordinates,
    };
  } else {
    console.warn(`Platform ${platformId} not found in station data`);
  }
});

console.log("Generating coaches for all platforms...");

console.log("Removing old coach and engine data...");
const initialFeatureCount = stationData.features.length;
stationData.features = stationData.features.filter(
  (f) =>
    f.properties.category !== "coach" &&
    f.properties.type !== "coach" &&
    !f.properties.id?.includes("_coach_") &&
    f.properties.category !== "engine" &&
    f.properties.type !== "engine" &&
    !f.properties.id?.includes("_engine_")
);
const removedCount = initialFeatureCount - stationData.features.length;
console.log(`Removed ${removedCount} old coach and engine-related features`);

const allCoachFeatures = [];
const allEngineFeatures = [];
const allNavNodes = [];
const allNavEdges = [];

Object.entries(platformData).forEach(([platformId, data]) => {
  console.log(`Generating ${data.numCoaches} coaches for ${data.name}...`);
  const coaches = generateCoaches(
    data.coordinates,
    data.numCoaches,
    platformId,
    data.name,
    data.navNodeId
  );

  coaches.forEach((coach) => {
    allCoachFeatures.push(coach.coachFeature);
    allNavNodes.push(coach.navNode);
  });

  const edges = generateCoachNavEdges(coaches, data.navNodeId, data.name);
  allNavEdges.push(...edges);

  console.log(`Generating 1 engine (before C1) for ${data.name}...`);
  const engine = generateEngine(
    data.coordinates,
    platformId,
    data.name,
    data.numCoaches
  );
  allEngineFeatures.push(engine);
});

console.log(`\nGenerated ${allCoachFeatures.length} coach features`);
console.log(`Generated ${allEngineFeatures.length} engine features`);
console.log(`Generated ${allNavNodes.length} navigation nodes`);
console.log(`Generated ${allNavEdges.length} navigation edges`);

stationData.features.push(...allCoachFeatures);
stationData.features.push(...allEngineFeatures);
stationData.features.push(...allNavNodes);
stationData.features.push(...allNavEdges);

fs.writeFileSync(stationDataPath, JSON.stringify(stationData, null, 2));
console.log(`\nSuccessfully updated ${stationDataPath}`);
console.log(`Total features: ${stationData.features.length}`);
console.log("\n✅ Coach and Engine generation complete!");
