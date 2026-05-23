// Point-to-point predefined routes

/**
 * Calculate distance between two coordinates in meters
 */
function calculateDistance(coord1, coord2) {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;

  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Find the closest point on a LineString to a given coordinate
 */
function findClosestPointOnLineString(coordinates, targetCoord) {
  let minDistance = Infinity;
  let closestIndex = -1;

  coordinates.forEach((coord, index) => {
    const distance = calculateDistance(coord, targetCoord);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = index;
    }
  });

  return { distance: minDistance, index: closestIndex };
}

/**
 * Predefined routes for specific point pairs
 
 */
const pointToPointRoutes = [
  {
    start: [72.81999896531295, 18.970293825261322],
    end: [72.81974042838092, 18.970516104922012],
    route1: {
      type: "Feature",
      properties: {
        routeNumber: 1,
        // Vertical circulation elements for Route 1
        verticalCirculation: [
          {
            // Going up to FOB: Can take Lift-2 OR Staircase-16 OR Escalator-4
            type: "up",
            options: [
              { type: "elevator", name: "Lift 2", id: "lift_2" },
              { type: "stairs", name: "Staircase 16", id: "staircase_16" },
              { type: "escalator", name: "Escalator 4", id: "escalator_4" },
            ],
            description: "Climb up to FOB Center",
          },
          {
            // Coming down from FOB: Can take Staircase-2 OR Escalator-1
            type: "down",
            options: [
              { type: "stairs", name: "Staircase 2", id: "staircase_2" },
              { type: "escalator", name: "Escalator 1", id: "escalator_1" },
            ],
            description: "Come down from FOB Center to Platform 5",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81999896531295, 18.970293825261322],
          [72.82005315872775, 18.9708066730352],
          [72.819697099595, 18.970837352891678],
          [72.81970834736413, 18.97099653489066],
          [72.81978842677037, 18.970992640131072],
          [72.81974042838092, 18.970516104922012],
        ],
      },
    },
    route2: {
      type: "Feature",
      properties: {
        routeNumber: 2,
        // Vertical circulation elements for Route 2
        verticalCirculation: [
          {
            // Enter Main Central Building by Entrance
            type: "walk",
            description: "Enter the Main Central Building by Entrance",
          },
          {
            // Go to Platform Main 5
            type: "walk",
            description: "Go to Platform Main 5",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81999896531295, 18.970293825261322],
          [72.8199865044468, 18.970167646643986],
          [72.81992091875728, 18.96953904019574],
          [72.81961991938778, 18.96956165293848],
          [72.8196741537059, 18.970105450276463],
          [72.81974042838092, 18.970516104922012],
        ],
      },
    },
  },
  {
    // Kiosk Screen to BCT Main Platform 1
    start: [72.8200095020151, 18.970338097340203], // Kiosk Screen
    end: [72.81922107138058, 18.97053272585545], // BCT Main Platform 1
    route1: {
      type: "Feature",
      properties: {
        routeNumber: 1,
        // Vertical circulation elements for Route 1
        verticalCirculation: [
          {
            // Going up to FOB: Can take Lift-2 OR Staircase-16 OR Escalator-4
            type: "up",
            options: [
              { type: "elevator", name: "Lift 2", id: "lift_2" },
              { type: "stairs", name: "Staircase 16", id: "staircase_16" },
              { type: "escalator", name: "Escalator 4", id: "escalator_4" },
            ],
            description: "Climb up to FOB",
            fobName: "FOB",
          },
          {
            // Coming down from FOB: Can take Staircases OR Escalators
            type: "down",
            options: [
              { type: "stairs", name: "Staircases", id: "staircases" },
              { type: "escalator", name: "Escalators", id: "escalators" },
            ],
            description: "Come down from FOB to Platform 1",
            fobName: "FOB",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.8200095020151, 18.970338097340203],
          [72.82006706738972, 18.97080824238118],
          [72.81924220181003, 18.97088000067893],
          [72.81922107138058, 18.97053272585545],
        ],
      },
    },
    route2: {
      type: "Feature",
      properties: {
        routeNumber: 2,
        // Vertical circulation elements for Route 2
        verticalCirculation: [
          {
            // Enter Main Central Building by Entrance
            type: "walk",
            description: "Enter the Main Central Building by Entrance",
          },
          {
            // Go through Main Building to Waiting Area
            type: "walk",
            description: "Go through Main Building to Waiting Area",
          },
          {
            // Go to Platform Main 1
            type: "walk",
            description: "Go to Platform Main 1",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.8200095020151, 18.970338097340203],
          [72.81992855001235, 18.969550838299142],
          [72.81915510202305, 18.969594592252434],
          [72.81922107138058, 18.97053272585545],
        ],
      },
    },
  },
  {
    // Kiosk Screen to BCT Local Platform 1
    start: [72.82000085324776, 18.970342374444996], // Kiosk Screen
    end: [72.81874159909876, 18.970715718780355], // BCT Local Platform 1
    route1: {
      type: "Feature",
      properties: {
        routeNumber: 1,
        // Vertical circulation elements for Route 1
        verticalCirculation: [
          {
            // Going up to FOB center: Can take Lift OR Staircase OR Escalator
            type: "up",
            options: [
              { type: "elevator", name: "Lift", id: "lift" },
              { type: "stairs", name: "Staircase", id: "staircase" },
              { type: "escalator", name: "Escalator", id: "escalator" },
            ],
            description: "Climb up to FOB Center",
            fobName: "FOB Center",
          },
          {
            // Coming down from FOB center: Can take Staircase 22 or Escalator 1
            type: "down",
            options: [
              { type: "stairs", name: "Staircase 22", id: "staircase_22" },
            ],
            description: "Come down from FOB Center to Local Platform 1",
            fobName: "FOB Center",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.82000085324776, 18.970342374444996],
          [72.8200429913496, 18.970815338198705],
          [72.81876197770328, 18.970912910795903],
          [72.81874159909876, 18.970715718780355],
        ],
      },
    },
    route2: {
      type: "Feature",
      properties: {
        routeNumber: 2,
        // Vertical circulation elements for Route 2
        verticalCirculation: [
          {
            // Going up to SKYwalk: Can take Lift OR Staircase 16 OR Escalator
            type: "up",
            options: [
              { type: "elevator", name: "Lift", id: "lift" },
              { type: "stairs", name: "Staircase 16", id: "staircase_16" },
              { type: "escalator", name: "Escalator", id: "escalator" },
            ],
            description: "Climb up to SKYwalk",
            fobName: "SKYwalk",
          },
          {
            // Coming down from SKYwalk to Local Platform 1
            type: "down",
            options: [{ type: "elevator", name: "Lift 3", id: "lift_3" }],
            description:
              "Come down from SKYwalk to Local Platform 1 via Lift 3 from FOB South",
            fobName: "FOB South",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.82000085324776, 18.970342374444996],
          [72.81999160200189, 18.97034388595948],
          [72.82003664423118, 18.97080766099053],
          [72.81929223567258, 18.97086874671676],
          [72.81916618237662, 18.97087680325663],
          [72.8191666795993, 18.970871835745683],
          [72.81911217394253, 18.970169751841084],
          [72.8189139455726, 18.970281023894245],
          [72.81871401649349, 18.970297248479298],
          [72.81873147368185, 18.970461765588553],
          [72.81874159909876, 18.970715718780355],
        ],
      },
    },
  },
  {
    // Kiosk Screen to BCT Main Platform 3
    start: [72.8200012724381, 18.970357500940864], // Kiosk Screen
    end: [72.81946456893095, 18.970513469120988], // BCT Main Platform 3
    route1: {
      type: "Feature",
      properties: {
        routeNumber: 1,
        // Vertical circulation elements for Route 1
        verticalCirculation: [
          {
            // Going up to FOB center: Can take Lift OR Staircase OR Escalator
            type: "up",
            options: [
              { type: "elevator", name: "Lift", id: "lift" },
              { type: "stairs", name: "Staircase", id: "staircase" },
              { type: "escalator", name: "Escalator", id: "escalator" },
            ],
            description: "Climb up to FOB Center",
            fobName: "FOB Center",
          },
          {
            // Coming down from FOB center: Can take Lift 8 OR Staircase
            type: "down",
            options: [
              { type: "elevator", name: "Lift 8", id: "lift_8" },
              { type: "stairs", name: "Staircase", id: "staircase" },
            ],
            description: "Come down from FOB Center to Platform 3",
            fobName: "FOB Center",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.8200012724381, 18.970357500940864],
          [72.82005938519052, 18.970803674598287],
          [72.81949017201126, 18.970860727156207],
          [72.81946456893095, 18.970513469120988],
        ],
      },
    },
    route2: {
      type: "Feature",
      properties: {
        routeNumber: 2,
        // Vertical circulation elements for Route 2
        verticalCirculation: [
          {
            // Enter Main Central Building by Entrance
            type: "walk",
            description: "Enter the Main Central Building by Entrance",
          },
          {
            // Go through Main Building to Waiting Area
            type: "walk",
            description: "Go through Main Building to Waiting Area",
          },
          {
            // Go to Platform Main 3
            type: "walk",
            description: "Go to Platform Main 3",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.8200012724381, 18.970357500940864],
          [72.81999014040682, 18.970191011735665],
          [72.81993597387464, 18.969567501511236],
          [72.81937316950814, 18.96960540052808],
          [72.81942640274843, 18.970108809622275],
          [72.81946456893095, 18.970513469120988],
        ],
      },
    },
    route3: {
      type: "Feature",
      properties: {
        routeNumber: 3,
        // Vertical circulation elements for Route 3
        verticalCirculation: [
          {
            // Going up to FOB North: Can take Staircase 25 OR Lift 6
            type: "up",
            options: [
              { type: "stairs", name: "Staircase 25", id: "staircase_25" },
              { type: "elevator", name: "Lift 6", id: "lift_6" },
            ],
            description: "Climb up to FOB North",
            fobName: "FOB North",
          },
          {
            // Coming down from FOB North: Can take Staircase 26 OR Lift 6
            type: "down",
            options: [
              { type: "stairs", name: "Staircase 26", id: "staircase_26" },
              { type: "elevator", name: "Lift 6", id: "lift_6" },
            ],
            description: "Come down from FOB North to Platform 3",
            fobName: "FOB North",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.8200012724381, 18.970357500940864],
          [72.81997086613092, 18.970294729488344],
          [72.81982699403332, 18.970306540131148],
          [72.81993905248865, 18.971760089647645],
          [72.8198459523116, 18.97176783397029],
          [72.81985276503156, 18.97186781978472],
          [72.81960347744146, 18.971888991428003],
          [72.81958533429955, 18.97160023965074],
          [72.81946456893095, 18.970513469120988],
        ],
      },
    },
  },
  {
    // Kiosk Screen to Waiting Area
    start: [72.81999950915696, 18.970301971795223], // Kiosk Screen
    end: [72.8191480361098, 18.969671539111502], // Waiting Area
    route1: {
      type: "Feature",
      properties: {
        routeNumber: 1,
        verticalCirculation: [
          {
            type: "walk",
            description: "Enter the Main Building from Main Entrance",
          },
          {
            type: "walk",
            description: "Walk inside the building to reach the Waiting Area",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81999950915696, 18.970301971795223],
          [72.819935573446, 18.969562249920514],
          [72.81913778905479, 18.96959891183573],
          [72.8191480361098, 18.969671539111502],
        ],
      },
    },
  },
  {
    // Kiosk Screen to Entrance & Exit
    start: [72.82001044759264, 18.970227338556484], // Kiosk Screen
    end: [72.81900673130835, 18.969397720591417], // Entrance & Exit
    route1: {
      type: "Feature",
      properties: {
        routeNumber: 1,
        verticalCirculation: [
          {
            type: "walk",
            description: "Walk from Kiosk Screen towards the station entrance",
          },
          {
            type: "walk",
            description: "Follow the path to reach the Entrance & Exit",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.82001044759264, 18.970227338556484],
          [72.81996561492633, 18.969558707257747],
          [72.81972751702602, 18.969570852210907],
          [72.81970906545851, 18.96936846546508],
          [72.81900673130835, 18.969397720591417],
        ],
      },
    },
  },
  {
    // Kiosk Screen to BCT Main Platform 3 Coach 12
    start: [72.82000720644771, 18.9703164806386], // Kiosk Screen
    end: [72.81958628143896, 18.972232994744356], // BCT Main Platform 3 Coach 12
    route1: {
      type: "Feature",
      properties: {
        routeNumber: 1,
        verticalCirculation: [
          {
            // Going up to FOB North: Can take Lift OR Escalator OR Staircase
            type: "up",
            options: [
              { type: "elevator", name: "Lift", id: "lift" },
              { type: "escalator", name: "Escalator", id: "escalator" },
              { type: "stairs", name: "Staircase", id: "staircase" },
            ],
            description: "Climb up to FOB North",
            fobName: "FOB North",
          },
          {
            // Coming down from FOB North: Can take Staircase
            type: "down",
            options: [{ type: "stairs", name: "Staircase", id: "staircase" }],
            description: "Come down from FOB North to BCT Main Platform 3",
            fobName: "FOB North",
          },
          {
            type: "walk",
            description: "Continue to Coach 12 near FOB North",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.82000720644771, 18.9703164806386],
          [72.82004499361952, 18.97081015192481],
          [72.81949305846362, 18.970854429732825],
          [72.81961874535094, 18.972206478427807],
          [72.81958628143896, 18.972232994744356],
        ],
      },
    },
    route2: {
      type: "Feature",
      properties: {
        routeNumber: 2,
        verticalCirculation: [
          {
            type: "walk",
            description: "Enter the Main Building from Entrance",
          },
          {
            type: "walk",
            description: "Walk through Main Building to BCT Main Platform 3",
          },
          {
            type: "walk",
            description: "Use Staircase 26 near Platform 3 to reach Coach 12",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.82000720644771, 18.9703164806386],
          [72.81999148309728, 18.970182595846964],
          [72.81993899747141, 18.969555895181728],
          [72.8193721590082, 18.969585081692188],
          [72.81959150493938, 18.972145751818033],
          [72.81958628143896, 18.972232994744356],
        ],
      },
    },
    route3: {
      type: "Feature",
      properties: {
        routeNumber: 3,
        verticalCirculation: [
          {
            // Going up to FOB Center: Can take Escalator 4 OR Staircase 16 OR Lift
            type: "up",
            options: [
              { type: "escalator", name: "Escalator 4", id: "escalator_4" },
              { type: "stairs", name: "Staircase 16", id: "staircase_16" },
              { type: "elevator", name: "Lift", id: "lift" },
            ],
            description: "Climb up to FOB Center",
            fobName: "FOB Center",
          },
          {
            // Coming down from FOB Center: Can take Lift OR Staircase
            type: "down",
            options: [
              { type: "elevator", name: "Lift", id: "lift" },
              { type: "stairs", name: "Staircase", id: "staircase" },
            ],
            description: "Come down from FOB Center near Staircase 26",
            fobName: "FOB Center",
          },
          {
            type: "walk",
            description: "Use Staircase 26 to reach Coach 12",
          },
        ],
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.82000720644771, 18.9703164806386],
          [72.819970094828, 18.970245214388598],
          [72.81981922976027, 18.970255609527356],
          [72.81994803852723, 18.971702846679207],
          [72.81988998338565, 18.97171228836082],
          [72.81990906791134, 18.971871006116018],
          [72.81961951736716, 18.971888838513237],
          [72.81964846200344, 18.972190576706154],
          [72.81958628143896, 18.972232994744356],
        ],
      },
    },
  },
];

/**
 * Find matching routes for a start and end coordinate pair
 * Returns up to 3 route options if a matching point pair is found
 */
export function findMatchingRoutes(
  startCoord,
  endCoord,
  threshold = 50,
  stationData = null
) {
  const thresholdMeters = threshold; // threshold in meters

  console.log("🔍 Finding routes for:", {
    start: startCoord,
    end: endCoord,
    threshold: thresholdMeters,
  });

  const matchingRoutes = [];

  // Find the closest matching route entry (check both forward and reverse directions)
  let bestMatch = null;
  let minDistance = Infinity;
  let isReversed = false;

  pointToPointRoutes.forEach((routeEntry) => {
    // Check forward direction (start → end)
    const forwardStartDistance = calculateDistance(
      startCoord,
      routeEntry.start
    );
    const forwardEndDistance = calculateDistance(endCoord, routeEntry.end);

    if (
      forwardStartDistance <= thresholdMeters &&
      forwardEndDistance <= thresholdMeters
    ) {
      const totalDistance = forwardStartDistance + forwardEndDistance;
      if (totalDistance < minDistance) {
        minDistance = totalDistance;
        bestMatch = routeEntry;
        isReversed = false;
      }
    }

    // Check reverse direction (end → start)
    const reverseStartDistance = calculateDistance(startCoord, routeEntry.end);
    const reverseEndDistance = calculateDistance(endCoord, routeEntry.start);

    if (
      reverseStartDistance <= thresholdMeters &&
      reverseEndDistance <= thresholdMeters
    ) {
      const totalDistance = reverseStartDistance + reverseEndDistance;
      if (totalDistance < minDistance) {
        minDistance = totalDistance;
        bestMatch = routeEntry;
        isReversed = true;
      }
    }
  });

  if (bestMatch) {
    console.log("✅ Found matching route entry", { isReversed });

    // Helper function to reverse vertical circulation steps
    const reverseVerticalCirculation = (vc) => {
      if (!vc || vc.length === 0) return [];
      return vc
        .slice()
        .reverse()
        .map((step) => {
          if (step.type === "up") {
            // Reverse "up" to "down" and update description
            let reversedDescription = step.description;
            if (step.description.includes("Climb up to")) {
              // "Climb up to FOB Center" -> "Come down from FOB Center"
              reversedDescription = step.description.replace(
                "Climb up to",
                "Come down from"
              );
            } else if (step.description.includes("up to")) {
              reversedDescription = step.description.replace(
                "up to",
                "down from"
              );
            }
            return { ...step, type: "down", description: reversedDescription };
          } else if (step.type === "down") {
            // Reverse "down" to "up" and update description
            let reversedDescription = step.description;
            if (step.description.includes("Come down from")) {
              // "Come down from FOB Center to Platform 5" -> "Climb up to FOB Center from Platform 5"
              if (step.description.includes(" to ")) {
                // Handle "Come down from X to Y" -> "Climb up to X from Y"
                const match = step.description.match(
                  /Come down from (.+?) to (.+)/
                );
                if (match) {
                  reversedDescription = `Climb up to ${match[1]} from ${match[2]}`;
                } else {
                  reversedDescription = step.description.replace(
                    "Come down from",
                    "Climb up to"
                  );
                }
              } else {
                reversedDescription = step.description.replace(
                  "Come down from",
                  "Climb up to"
                );
              }
            } else if (step.description.includes("down from")) {
              reversedDescription = step.description.replace(
                "down from",
                "up to"
              );
            }
            return { ...step, type: "up", description: reversedDescription };
          } else if (step.type === "walk") {
            // For walk steps, reverse the order and update descriptions if needed
            let reversedDescription = step.description;
            if (step.description.includes("Enter")) {
              reversedDescription = step.description.replace("Enter", "Exit");
            } else if (step.description.includes("Go to")) {
              reversedDescription = step.description.replace(
                "Go to",
                "Go from"
              );
            }
            return { ...step, description: reversedDescription };
          }
          return step;
        });
    };

    // Process Route 1
    let route1Coords = bestMatch.route1.geometry.coordinates;
    if (isReversed) {
      route1Coords = [...route1Coords].reverse();
    }
    const route1WithEndpoints = [
      startCoord,
      ...route1Coords.slice(1, -1),
      endCoord,
    ];

    const route1VerticalCirculation = isReversed
      ? reverseVerticalCirculation(
          bestMatch.route1.properties.verticalCirculation || []
        )
      : bestMatch.route1.properties.verticalCirculation || [];

    const route1 = {
      type: "Feature",
      properties: {
        pathType: "route",
        routeNumber: 1,
        verticalCirculation: route1VerticalCirculation,
      },
      geometry: {
        type: "LineString",
        coordinates: route1WithEndpoints,
      },
    };

    const route1Distance = calculateRouteDistance(route1WithEndpoints);

    matchingRoutes.push({
      route: route1,
      distance: route1Distance,
      startMatchDistance: isReversed
        ? calculateDistance(startCoord, bestMatch.end)
        : calculateDistance(startCoord, bestMatch.start),
      endMatchDistance: isReversed
        ? calculateDistance(endCoord, bestMatch.start)
        : calculateDistance(endCoord, bestMatch.end),
    });

    // Process Route 2 if it exists
    if (bestMatch.route2) {
      let route2Coords = bestMatch.route2.geometry.coordinates;
      if (isReversed) {
        route2Coords = [...route2Coords].reverse();
      }
      const route2WithEndpoints = [
        startCoord,
        ...route2Coords.slice(1, -1),
        endCoord,
      ];

      const route2VerticalCirculation = isReversed
        ? reverseVerticalCirculation(
            bestMatch.route2.properties.verticalCirculation || []
          )
        : bestMatch.route2.properties.verticalCirculation || [];

      const route2 = {
        type: "Feature",
        properties: {
          pathType: "route",
          routeNumber: 2,
          verticalCirculation: route2VerticalCirculation,
        },
        geometry: {
          type: "LineString",
          coordinates: route2WithEndpoints,
        },
      };

      const route2Distance = calculateRouteDistance(route2WithEndpoints);

      matchingRoutes.push({
        route: route2,
        distance: route2Distance,
        startMatchDistance: isReversed
          ? calculateDistance(startCoord, bestMatch.end)
          : calculateDistance(startCoord, bestMatch.start),
        endMatchDistance: isReversed
          ? calculateDistance(endCoord, bestMatch.start)
          : calculateDistance(endCoord, bestMatch.end),
      });
    }

    // Process Route 3 if it exists
    if (bestMatch.route3) {
      let route3Coords = bestMatch.route3.geometry.coordinates;
      if (isReversed) {
        route3Coords = [...route3Coords].reverse();
      }
      const route3WithEndpoints = [
        startCoord,
        ...route3Coords.slice(1, -1),
        endCoord,
      ];

      const route3VerticalCirculation = isReversed
        ? reverseVerticalCirculation(
            bestMatch.route3.properties.verticalCirculation || []
          )
        : bestMatch.route3.properties.verticalCirculation || [];

      const route3 = {
        type: "Feature",
        properties: {
          pathType: "route",
          routeNumber: 3,
          verticalCirculation: route3VerticalCirculation,
        },
        geometry: {
          type: "LineString",
          coordinates: route3WithEndpoints,
        },
      };

      const route3Distance = calculateRouteDistance(route3WithEndpoints);

      matchingRoutes.push({
        route: route3,
        distance: route3Distance,
        startMatchDistance: isReversed
          ? calculateDistance(startCoord, bestMatch.end)
          : calculateDistance(startCoord, bestMatch.start),
        endMatchDistance: isReversed
          ? calculateDistance(endCoord, bestMatch.start)
          : calculateDistance(endCoord, bestMatch.end),
      });
    }

    // Sort by distance
    matchingRoutes.sort((a, b) => a.distance - b.distance);
  } else {
    console.log("❌ No matching route entry found");
  }

  console.log(`📊 Found ${matchingRoutes.length} matching routes`);

  return matchingRoutes;
}

/**
 * Calculate total distance of a route
 */
export function calculateRouteDistance(coordinates) {
  if (!coordinates || coordinates.length < 2) {
    return 0;
  }

  let totalDistance = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    totalDistance += calculateDistance(coordinates[i], coordinates[i + 1]);
  }

  return Math.round(totalDistance);
}

/**
 * Find the best matching route for start and end coordinates
 */
export function getBestRoute(startCoord, endCoord) {
  const matches = findMatchingRoutes(startCoord, endCoord);
  if (matches.length > 0) {
    return matches[0].route;
  }
  return null;
}

/**
 * Generate turn-by-turn directions for a route, using manually specified vertical circulation elements
 */
export function generateDirections(
  routeCoords,
  startNodeName,
  endNodeName,
  stationData,
  routeProperties = null
) {
  if (!routeCoords || routeCoords.length < 2) {
    return [`Start at ${startNodeName}`, `Arrive at ${endNodeName}`];
  }

  const directions = [];
  directions.push(`Start at ${startNodeName}`);

  const verticalCirculation = routeProperties?.verticalCirculation || [];

  if (verticalCirculation.length > 0) {
    verticalCirculation.forEach((vcStep, idx) => {
      const { type, options, description } = vcStep;

      // Handle walk type (for Route 2 - direct path through building)
      if (type === "walk" && description) {
        directions.push(`🚶 ${description}`);
      } else if (options && options.length > 0) {
        // Format options as "Option1 OR Option2 OR Option3"
        const optionStrings = options.map((opt) => {
          if (opt.type === "elevator") {
            return `🛗 ${opt.name}`;
          } else if (opt.type === "escalator") {
            return `⬆️ ${opt.name}`;
          } else if (opt.type === "stairs") {
            return `🪜 ${opt.name}`;
          }
          return opt.name;
        });

        const optionsText = optionStrings.join(" OR ");

        if (type === "up") {
          directions.push(`${optionsText} - ${description}`);
        } else if (type === "down") {
          directions.push(`${optionsText} - ${description}`);
        } else {
          directions.push(`${optionsText}`);
        }
      }

      const nextStep = verticalCirculation[idx + 1];
      if (idx < verticalCirculation.length - 1) {
        if (type !== "walk" || (nextStep && nextStep.type !== "walk")) {
          directions.push(`🚶 Continue along the route`);
        }
      }
    });
  } else {
    directions.push(`🚶 Follow the route`);
  }

  directions.push(`📍 Arrive at ${endNodeName}`);

  return directions;
}
