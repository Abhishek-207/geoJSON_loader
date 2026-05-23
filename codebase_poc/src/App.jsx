import React, { useState, useMemo, useRef, useEffect } from "react";
import Map, {
  Source,
  Layer,
  Popup,
  NavigationControl,
  Marker,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import "./App.css";
import * as turf from "@turf/turf";
import stationData from "./data/station_data.json";
import { getNavigationNodes } from "./utils/navigationGraph";
import {
  findMatchingRoutes,
  calculateRouteDistance,
  getBestRoute,
  generateDirections,
} from "./utils/predefinedRoutes";
import { processStaircases } from "./utils/createStairSteps";
import SearchableSelect from "./components/SearchableSelect";
import {
  filterCoachesAndEngines,
  hasValidCoachProps,
} from "./utils/filterCoachesAndEngines";

const INITIAL_VIEW_STATE = {
  longitude: 72.8193,
  latitude: 18.9688,
  zoom: 18,
  pitch: 45,
  bearing: 270,
};

// Restrict the map to Mumbai Central Station area
// [west, south, east, north] - [minLng, minLat, maxLng, maxLat]
const MUMBAI_CENTRAL_BOUNDS = [
  72.817, // West longitude (left boundary) - restricted
  18.97, // South latitude (bottom boundary) - restricted
  72.8225, // East longitude (right boundary) - restricted
  18.9741, // North latitude (top boundary) - restricted
];

const BASE_MAPS = {
  OpenStreetMap: {
    url: `https://api.maptiler.com/maps/openstreetmap/style.json?key=${
      import.meta.env.VITE_MAPTILER_API_KEY
    }`,
    description: "Classic OSM style",
    label: "Detailed",
  },
  "CartoDB Positron": {
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    description: "Light, minimal style",
    label: "Standard",
  },
};

// Only allow predefined route locations in dropdowns
const ALLOWED_LOCATION_IDS = [
  "n_kiosk_screen", // Kiosk Screen
  "n_platform_5", // BCT Main Platform 5
  "n_platform_1", // BCT Main Platform 1
  "n_local_platform_1", // BCT Local Platform 1
  "n_platform_3", // BCT Main Platform 3
  "n_waiting_area", // Waiting Area
  "n_entrance_2", // Entrance & Exit
  "platform_3_coach_12", // BCT Main Platform 3 Coach 12
];

/**

 * To show coaches and engines for a specific platform, pass props:
 * @param {Object} props - Component props
 * @param {string} props.platform - Platform ID (e.g., "platform_1", "local_platform_1")
 *                                  If empty or not provided, coaches and engines will be hidden
 * @param {number} props.coachNumber - (Optional) Coach number to highlight in green
 *                                     If provided, this coach will be highlighted and made bigger
 * @param {boolean} props.showAllCoaches - (Optional) If true, shows all coaches on all platforms
 *                                          When true, platform prop is ignored

 * PLATFORM ID FORMATS:
 * - Main platforms: "platform_1", "platform_2", "platform_3", etc.
 * - Local platforms: "local_platform_1", "local_platform_2", etc.
 */
export default function App({ platform = "", coachNumber = null, showAllCoaches = false } = {}) {
  const mapRef = useRef(null);

  const [hoverInfo, setHoverInfo] = useState(null);
  const [showDirections, setShowDirections] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [showQuickAccess, setShowQuickAccess] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedBaseMap, setSelectedBaseMap] = useState("OpenStreetMap");
  const [is3DView, setIs3DView] = useState(true);

  const [startNode, setStartNode] = useState("n_kiosk_screen"); // Default to Kiosk Screen
  const [endNode, setEndNode] = useState("");
  const [routeGeoJSON, setRouteGeoJSON] = useState(null);
  const [routeDistance, setRouteDistance] = useState(0);
  const [directions, setDirections] = useState([]);
  const [alternativeRoutes, setAlternativeRoutes] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  const [selectionMode, setSelectionMode] = useState(null);
  const [selectionMessage, setSelectionMessage] = useState(null);
  const [clickedStartNode, setClickedStartNode] = useState(null);
  const [clickedEndNode, setClickedEndNode] = useState(null);
  
  // State for displaying coaches when a coach destination is selected
  const [displayPlatform, setDisplayPlatform] = useState("");
  const [displayCoachNumber, setDisplayCoachNumber] = useState(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const processedStationData = useMemo(() => {
    return processStaircases(stationData, 8);
  }, []);

  // Mask polygon: hides the base map everywhere except a buffered envelope
  // around the station GeoJSON. The mask is a big outer rectangle with a
  // hole cut out for the station area + a small "around" buffer.
  const mapMaskGeoJSON = useMemo(() => {
    const geomFeatures = stationData.features.filter(
      (f) => f && f.geometry && f.geometry.coordinates
    );
    const fc = turf.featureCollection(geomFeatures);
    const stationBbox = turf.bbox(fc);
    const stationPoly = turf.bboxPolygon(stationBbox);
    const buffered = turf.buffer(stationPoly, 20, { units: "meters" });
    const outer = turf.bboxPolygon([72.5, 18.8, 73.1, 19.1]);
    const mask = turf.difference(turf.featureCollection([outer, buffered]));
    return mask
      ? { type: "FeatureCollection", features: [mask] }
      : { type: "FeatureCollection", features: [] };
  }, []);

  // Update display platform and coach number when destination is a coach
  useEffect(() => {
    if (endNode && endNode.includes("_coach_")) {
      // Extract platform and coach number from node ID (e.g., "platform_3_coach_12" or "local_platform_1_coach_12")
      let match = endNode.match(/^(platform_\d+)_coach_(\d+)$/);
      if (match) {
        const [, platformId, coachNum] = match;
        console.log("🎯 Setting display platform:", platformId, "coach:", coachNum);
        setDisplayPlatform(platformId);
        setDisplayCoachNumber(parseInt(coachNum, 10));
        return;
      }
      
      match = endNode.match(/^(local_platform_\d+)_coach_(\d+)$/);
      if (match) {
        const [, platformId, coachNum] = match;
        console.log("🎯 Setting display platform:", platformId, "coach:", coachNum);
        setDisplayPlatform(platformId);
        setDisplayCoachNumber(parseInt(coachNum, 10));
        return;
      }
    }
    
    // Clear display when destination is not a coach
    if (endNode && !endNode.includes("_coach_")) {
      console.log("🎯 Clearing display platform (not a coach)");
      setDisplayPlatform("");
      setDisplayCoachNumber(null);
    }
  }, [endNode]);

  // Filter coaches and engines based on display state or props
  // Only show coaches and engines if platform is provided or showAllCoaches is true
  const filteredCoachesAndEngines = useMemo(() => {
    const platformToUse = displayPlatform || platform;
    const coachNumberToUse = displayCoachNumber !== null ? displayCoachNumber : coachNumber;
    
    console.log("📊 Filtering coaches - platformToUse:", platformToUse, "coachNumberToUse:", coachNumberToUse);
    
    const result = filterCoachesAndEngines(stationData, {
      platform: platformToUse,
      coachNumber: coachNumberToUse,
      showAllCoaches,
    });
    console.log("📊 Filtered coaches/engines result:", result);
    console.log("📊 Number of features:", result.features.length);
    if (result.features.length > 0) {
      console.log("📊 First feature sample:", result.features[0]);
    }
    return result;
  }, [displayPlatform, displayCoachNumber, platform, coachNumber, showAllCoaches]);

  // "I am here" location GeoJSON - only label, no line/polygon
  const iAmHereGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            name: "(You are here)",
            type: "location_marker",
            category: "location_marker",
          },
          geometry: {
            type: "Point",
            coordinates: [72.81996318830932, 18.970205498135257],
          },
        },
      ],
    }),
    []
  );

  // Navigation nodes for dropdown selection

  // Get all navigation nodes for dropdowns
  const navigationNodes = useMemo(() => {
    return getNavigationNodes(stationData);
  }, []);

  // Set clicked start node for default Kiosk Screen selection
  useEffect(() => {
    if (startNode === "n_kiosk_screen" && !clickedStartNode) {
      const kioskNode = navigationNodes.find((n) => n.id === "n_kiosk_screen");
      if (kioskNode) {
        setClickedStartNode(kioskNode);
      }
    }
  }, [navigationNodes, startNode, clickedStartNode]);

  // Auto-select Kiosk Screen as start location and coach as destination when platform props are provided
  useEffect(() => {
    if (platform && platform.trim() !== "") {
      // Set start location to Kiosk Screen
      const kioskScreenNodeId = "n_kiosk_screen";
      setStartNode(kioskScreenNodeId);

      // Find and set the clicked start node for display
      const kioskNode = navigationNodes.find((n) => n.id === kioskScreenNodeId);
      if (kioskNode) {
        setClickedStartNode(kioskNode);
      }

      // Set destination to the specified coach if coachNumber is provided
      if (coachNumber !== null && coachNumber !== undefined) {
        // Coach node ID format: platform_1_coach_3 (no "n_" prefix for coaches)
        const coachNodeId = `${platform}_coach_${coachNumber}`;

        // Find the coach node in navigationNodes by ID
        const coachNode = navigationNodes.find((n) => n.id === coachNodeId);

        if (coachNode) {
          setEndNode(coachNodeId);
          setClickedEndNode(coachNode);
        } else {
          // Fallback: search in stationData for the coach nav_node
          const coachNavNode = stationData.features.find(
            (f) =>
              f.properties?.type === "nav_node" &&
              f.properties?.id === coachNodeId &&
              f.properties?.coachNumber === coachNumber &&
              f.properties?.platform === platform
          );

          if (coachNavNode) {
            setEndNode(coachNodeId);
            // Create a node object matching the navigationNodes format
            setClickedEndNode({
              id: coachNavNode.properties.id,
              name: coachNavNode.properties.name,
              floor: coachNavNode.properties.floor || 0,
              coordinates: coachNavNode.geometry.coordinates,
            });
          }
        }
      }
    }
  }, [platform, coachNumber, navigationNodes]);

  // Automatically calculate route when both start and end nodes are set via props
  useEffect(() => {
    // Only auto-calculate if platform prop is provided (indicating props-based selection)
    // and both start and end nodes are set
    if (
      platform &&
      platform.trim() !== "" &&
      coachNumber !== null &&
      coachNumber !== undefined &&
      startNode &&
      endNode &&
      startNode === "n_kiosk_screen" &&
      endNode.startsWith(`${platform}_coach_`)
    ) {
      // Small delay to ensure state is fully updated
      const timer = setTimeout(() => {
        if (startNode && endNode && startNode !== endNode) {
          calculateRouteFromNodes(startNode, endNode);
        }
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [platform, coachNumber, startNode, endNode]);

  const locationOptions = useMemo(() => {
    return navigationNodes
      .filter((node) => ALLOWED_LOCATION_IDS.includes(node.id))
      .map((node) => ({
        value: node.id,
        label: `${node.name}${node.floor > 0 ? ` (Floor ${node.floor})` : ""}`,
        floor: node.floor,
      }));
  }, [navigationNodes]);

  const calculateRoute = () => {
    if (!startNode || !endNode) {
      alert("Please select both start and destination points");
      return;
    }

    if (startNode === endNode) {
      alert("Start and destination cannot be the same");
      return;
    }

    calculateRouteFromNodes(startNode, endNode);
  };

  const selectRoute = (index) => {
    console.log("selectRoute called with index:", index);
    console.log("alternativeRoutes:", alternativeRoutes);
    if (alternativeRoutes[index]) {
      console.log("Setting route to:", alternativeRoutes[index]);
      setSelectedRouteIndex(index);
      setRouteGeoJSON(alternativeRoutes[index].geoJSON);
      setRouteDistance(alternativeRoutes[index].distance);
      setDirections(alternativeRoutes[index].directions);
    } else {
      console.log("No route found at index:", index);
    }
  };

  const clearRoute = () => {
    setRouteGeoJSON(null);
    setStartNode("n_kiosk_screen");
    setEndNode("");
    setRouteDistance(0);
    setDirections([]);
    setShowDirections(false);
    setSelectionMode(null);
    setSelectionMessage(null);
    setClickedStartNode(null);
    setClickedEndNode(null);
    setAlternativeRoutes([]);
    setSelectedRouteIndex(0);
    // Reset display platform and coach number
    setDisplayPlatform("");
    setDisplayCoachNumber(null);
  };

  //Escape key to clear navigation selection
  useEffect(() => {
    const handleEscapeKey = (event) => {
      if (event.key === "Escape" && (startNode || endNode || routeGeoJSON)) {
        clearRoute();
      }
    };

    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [startNode, endNode, routeGeoJSON, clearRoute]);

  const enableClickSelection = () => {
    // Keep startNode as Kiosk Screen (cannot be changed)
    setStartNode("n_kiosk_screen");
    setEndNode("");
    setRouteGeoJSON(null);
    // Set clicked start node to Kiosk Screen
    const kioskNode = navigationNodes.find((n) => n.id === "n_kiosk_screen");
    if (kioskNode) {
      setClickedStartNode(kioskNode);
    }
    setClickedEndNode(null);
    setSelectionMode("end"); // Only allow selecting destination
    setSelectionMessage(
      "🎯 Click on a building or location to select the destination"
    );
  };

  const findNearestNavNode = (lng, lat) => {
    let minDistance = Infinity;
    let nearestNode = null;

    navigationNodes.forEach((node) => {
      const [nodeLng, nodeLat] = node.coordinates;
      const distance = Math.sqrt(
        Math.pow(
          (nodeLng - lng) * 111320 * Math.cos((nodeLat * Math.PI) / 180),
          2
        ) + Math.pow((nodeLat - lat) * 110540, 2)
      );
      if (distance < minDistance) {
        minDistance = distance;
        nearestNode = node;
      }
    });

    return nearestNode;
  };

  const findNavNodeByFeature = (feature) => {
    const featureName = feature.properties.name?.toLowerCase() || "";
    const featureId = feature.properties.id?.toLowerCase() || "";
    const featureType = feature.properties.type?.toLowerCase() || "";
    const featureCategory = feature.properties.category?.toLowerCase() || "";

    // First, try to match by ID pattern (e.g., main_entrance -> n_main_entrance)
    if (featureId) {
      // Check if feature ID matches a nav node ID pattern
      const navNodeId = `n_${featureId}`;
      let matchedNode = navigationNodes.find((node) => node.id === navNodeId);
      if (matchedNode) {
        return matchedNode;
      }

      // Also try matching entrance IDs specifically
      if (featureId === "main_entrance") {
        matchedNode = navigationNodes.find((n) => n.id === "n_main_entrance");
        if (matchedNode) return matchedNode;
      }
      if (featureId === "entrance_exit_2" || featureId === "entrance_2") {
        matchedNode = navigationNodes.find((n) => n.id === "n_entrance_2");
        if (matchedNode) return matchedNode;
      }
    }

    // Handle coaches - find the platform navigation node
    if (featureType === "coach" || featureCategory === "coach") {
      const platformId = feature.properties.platform;
      if (platformId) {
        // Check if it's a local platform
        if (platformId.startsWith("local_platform_")) {
          const platformNum = platformId.replace("local_platform_", "");
          const matchedNode = navigationNodes.find(
            (n) => n.id === `n_local_platform_${platformNum}`
          );
          if (matchedNode) return matchedNode;
        } else if (platformId.startsWith("platform_")) {
          // Main platform
          const platformNum = platformId.replace("platform_", "");
          const matchedNode = navigationNodes.find(
            (n) => n.id === `n_platform_${platformNum}`
          );
          if (matchedNode) return matchedNode;
        }

        // Fallback: try to extract platform number from any format
        const platformMatch = platformId.match(
          /(?:local_)?platform[_\s]*(\d+)/i
        );
        if (platformMatch) {
          const platformNum = platformMatch[1];
          const isLocal = platformId.toLowerCase().includes("local");

          // Try matching by ID first
          let matchedNode = navigationNodes.find(
            (n) =>
              n.id ===
              (isLocal
                ? `n_local_platform_${platformNum}`
                : `n_platform_${platformNum}`)
          );
          if (matchedNode) return matchedNode;

          // Fallback: try matching by name
          matchedNode = navigationNodes.find((n) => {
            const nodeName = n.name.toLowerCase();
            if (isLocal) {
              return nodeName.includes(`local platform ${platformNum}`);
            } else {
              return (
                nodeName.includes(`main platform ${platformNum}`) ||
                nodeName.includes(`platform ${platformNum}`)
              );
            }
          });
          if (matchedNode) return matchedNode;
        }
      }
    }

    // Try matching by name
    let matchedNode = navigationNodes.find((node) => {
      const nodeName = node.name.toLowerCase();
      return (
        nodeName === featureName ||
        nodeName.includes(featureName) ||
        featureName.includes(nodeName)
      );
    });

    // If it's a platform, try matching platform numbers
    if (
      !matchedNode &&
      (featureName.includes("platform") ||
        featureId.includes("pf_") ||
        featureId.includes("platform_"))
    ) {
      const platformMatch =
        featureName.match(/platform\s*(\d+)/i) ||
        featureId.match(/pf_(\d+)/) ||
        featureId.match(/platform[_\s]*(\d+)/i);
      if (platformMatch) {
        const platformNum = platformMatch[1];
        matchedNode = navigationNodes.find((n) =>
          n.name.toLowerCase().includes(`platform ${platformNum}`)
        );
      }
    }

    // For toilets, food court, etc., find exact matches
    const specialLocations = {
      toilet_m: "Gents Toilet",
      toilet_f: "Ladies Toilet",
      food_court: "Food Court",
      parcel_office: "Parcel Office",
      waiting_area: "Waiting Area",
      ticket_counter: "Ticket Counter",
      kiosk_screen: "Kiosk Screen",
      prs_ticket_booking_office: "PRS/Ticket Booking Office",
      vehicle_parking_area: "Vehicle Parking Area",
      park_1: "Kalingana Park",
      park_2: "Park",
      first_aid: "First Aid Room",
      reservation_office: "Reservation Office",
      inquiry_counter: "Inquiry Counter",
    };

    if (!matchedNode && specialLocations[featureId]) {
      matchedNode = navigationNodes.find(
        (n) => n.name === specialLocations[featureId]
      );
    }

    // Also try matching by category
    if (!matchedNode) {
      const categoryMap = {
        parcel_office: "Parcel Office",
        waiting_area: "Waiting Area",
        ticket_counter: "Ticket Counter",
        booking_office: "PRS/Ticket Booking Office",
        parking: "Vehicle Parking Area",
        park: featureName.toLowerCase().includes("kalingana")
          ? "Kalingana Park"
          : "Park",
      };

      if (categoryMap[featureCategory]) {
        matchedNode = navigationNodes.find(
          (n) => n.name === categoryMap[featureCategory]
        );
      }
    }

    // For entrances, try more specific matching
    if (
      !matchedNode &&
      (featureCategory === "entrance" || featureName.includes("entrance"))
    ) {
      // Try to match by checking if the feature name contains "entrance" and find the closest match
      if (featureName.includes("main") || featureId.includes("main")) {
        matchedNode = navigationNodes.find((n) =>
          n.name.toLowerCase().includes("main entrance")
        );
      } else if (featureName.includes("2") || featureId.includes("2")) {
        matchedNode = navigationNodes.find((n) =>
          n.name.toLowerCase().includes("entrance 2")
        );
      } else {
        // Fallback: find any entrance node
        matchedNode = navigationNodes.find((n) =>
          n.name.toLowerCase().includes("entrance")
        );
      }
    }

    return matchedNode;
  };

  const handleMapClick = (event) => {
    const feature = event.features && event.features[0];
    let selectedNode = null;

    if (feature) {
      console.log("Clicked feature:", feature.properties);

      // If clicking on a coach or entrance, enable selection mode if not already active
      const isCoach =
        feature.properties.type === "coach" ||
        feature.properties.category === "coach";
      const isEntrance =
        feature.properties.category === "entrance" ||
        feature.properties.name?.toLowerCase().includes("entrance");

      if ((isCoach || isEntrance) && !selectionMode) {
        setSelectionMode("start");
        setSelectionMessage(
          "🎯 Click on a building or location to select the starting point"
        );
      }

      if (feature.properties.type === "nav_node") {
        selectedNode = navigationNodes.find(
          (n) => n.id === feature.properties.id
        );
      } else if (feature.properties.id || feature.properties.name) {
        selectedNode = findNavNodeByFeature(feature);

        if (!selectedNode) {
          const geometry = feature.geometry;
          let centerLng, centerLat;

          if (geometry.type === "Point") {
            [centerLng, centerLat] = geometry.coordinates;
          } else if (geometry.type === "Polygon" && geometry.coordinates[0]) {
            const coords = geometry.coordinates[0];
            centerLng =
              coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
            centerLat =
              coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
          } else {
            centerLng = event.lngLat.lng;
            centerLat = event.lngLat.lat;
          }

          selectedNode = findNearestNavNode(centerLng, centerLat);
        }
      }
    } else {
      // Only allow clicking empty space if in selection mode
      if (!selectionMode) return;
      selectedNode = findNearestNavNode(event.lngLat.lng, event.lngLat.lat);
    }

    if (!selectedNode) {
      console.log("No node found for selection");
      return;
    }

    console.log("Selected node:", selectedNode);

    // Start location is always Kiosk Screen - cannot be changed via map click
    // Ensure startNode is always set to Kiosk Screen
    if (!startNode || startNode !== "n_kiosk_screen") {
      setStartNode("n_kiosk_screen");
      const kioskNode = navigationNodes.find((n) => n.id === "n_kiosk_screen");
      if (kioskNode) {
        setClickedStartNode(kioskNode);
      }
    }

    // If selectionMode is "start", change it to "end" since we only allow destination selection
    if (selectionMode === "start") {
      setSelectionMode("end");
    }

    // Only allow selecting destination
    if (startNode && !endNode) {
      if (selectedNode.id === startNode) {
        setSelectionMessage(
          "⚠️ Start and destination cannot be the same. Please select a different location."
        );
        setTimeout(() => {
          const startNodeObj = navigationNodes.find((n) => n.id === startNode);
          if (startNodeObj) {
            setSelectionMessage(
              `✓ Start: ${startNodeObj.name}. Now click to select destination`
            );
          }
        }, 2000);
        return;
      }
      setEndNode(selectedNode.id);
      setClickedEndNode(selectedNode);
      setSelectionMode(null);
      setSelectionMessage(
        `✓ Destination: ${selectedNode.name}. Click "Get Directions" to see the route.`
      );

      // Don't calculate route automatically - wait for "Get Directions" button click
      setTimeout(() => {
        setSelectionMessage(null);
      }, 3000);
    }
    // If both are selected, reset destination only (start always stays as Kiosk Screen)
    else if (startNode && endNode) {
      // Reset destination only, keep start as Kiosk Screen
      setEndNode("");
      setClickedEndNode(null);
      setRouteGeoJSON(null);
      setSelectionMode("end");
      setSelectionMessage(
        "🎯 Click on a building or location to select the destination"
      );
    }
  };

  const handleQuickAccessClick = (startId, endId) => {
    setStartNode(startId);
    setEndNode(endId);

    // Find and set clicked nodes for display
    const startNodeObj = navigationNodes.find((n) => n.id === startId);
    const endNodeObj = navigationNodes.find((n) => n.id === endId);
    if (startNodeObj) setClickedStartNode(startNodeObj);
    if (endNodeObj) setClickedEndNode(endNodeObj);

    // Calculate route after a brief delay to ensure state is updated
    setTimeout(() => {
      calculateRouteFromNodes(startId, endId);
    }, 150);
  };

  const calculateRouteFromNodes = (start, end) => {
    if (!start || !end || start === end) return;

    const startNodeObj = navigationNodes.find((n) => n.id === start);
    const endNodeObj = navigationNodes.find((n) => n.id === end);

    if (!startNodeObj || !endNodeObj) {
      setSelectionMessage("Could not find start or end location!");
      setTimeout(() => setSelectionMessage(null), 3000);
      setRouteGeoJSON(null);
      setRouteDistance(0);
      setDirections([]);
      setAlternativeRoutes([]);
      return;
    }

    const startCoord = startNodeObj.coordinates;
    const endCoord = endNodeObj.coordinates;

    console.log("📍 Route calculation:", {
      startNode: startNodeObj.name,
      startCoord,
      endNode: endNodeObj.name,
      endCoord,
    });

    // Find matching routes from predefined GeoJSON (strict endpoint matching)
    // Pass stationData to enable vertical circulation detection
    const matchingRoutes = findMatchingRoutes(
      startCoord,
      endCoord,
      200,
      stationData
    );

    if (matchingRoutes.length === 0) {
      console.warn("❌ No matching routes found");
      setSelectionMessage("No route found between these locations!");
      setTimeout(() => setSelectionMessage(null), 3000);
      setRouteGeoJSON(null);
      setRouteDistance(0);
      setDirections([]);
      setAlternativeRoutes([]);
      return;
    }

    console.log("✅ Found routes:", matchingRoutes.length);

    // If multiple routes found, show alternatives
    if (matchingRoutes.length > 1) {
      const processedRoutes = matchingRoutes.map((match, index) => {
        const routeCoords = match.route.geometry.coordinates;
        const directions = generateDirections(
          routeCoords,
          startNodeObj.name,
          endNodeObj.name,
          stationData,
          match.route.properties
        );

        const routeNumber = match.route.properties?.routeNumber || index + 1;

        return {
          geoJSON: match.route,
          distance: match.distance,
          routeType: `Route ${routeNumber}`,
          directions,
        };
      });

      processedRoutes.sort((a, b) => a.distance - b.distance);

      setAlternativeRoutes(processedRoutes);
      setSelectedRouteIndex(0);

      if (processedRoutes.length > 0) {
        const selectedRoute = processedRoutes[0].geoJSON;
        console.log("🎯 Setting route from alternatives:", selectedRoute);
        if (
          selectedRoute &&
          selectedRoute.geometry &&
          selectedRoute.geometry.coordinates
        ) {
          setRouteGeoJSON(selectedRoute);
          setRouteDistance(processedRoutes[0].distance);
          setDirections(processedRoutes[0].directions);
        } else {
          console.error("❌ Invalid route format:", selectedRoute);
        }
      }
    } else {
      // Single route found
      const route = matchingRoutes[0].route;
      console.log("🎯 Setting single route:", route);
      if (
        route &&
        route.geometry &&
        route.geometry.coordinates &&
        route.geometry.coordinates.length >= 2
      ) {
        const routeCoords = route.geometry.coordinates;
        const directions = generateDirections(
          routeCoords,
          startNodeObj.name,
          endNodeObj.name,
          stationData,
          route.properties
        );

        setRouteGeoJSON(route);
        setRouteDistance(matchingRoutes[0].distance);
        setDirections(directions);
        setAlternativeRoutes([]);
        console.log("✅ Route set successfully");
      } else {
        console.error("❌ Invalid route format:", route);
        setSelectionMessage("Invalid route format!");
        setTimeout(() => setSelectionMessage(null), 3000);
      }
    }

    setShowDirections(true);
  };

  const markerData = useMemo(() => {
    const features = [];

    if (routeGeoJSON) {
      if (startNode) {
        const node = navigationNodes.find((n) => n.id === startNode);
        if (node) {
          features.push({
            type: "Feature",
            properties: { type: "start", name: node.name },
            geometry: { type: "Point", coordinates: node.coordinates },
          });
        }
      }

      if (endNode) {
        const node = navigationNodes.find((n) => n.id === endNode);
        if (node) {
          features.push({
            type: "Feature",
            properties: { type: "end", name: node.name },
            geometry: { type: "Point", coordinates: node.coordinates },
          });
        }
      }
    }

    return {
      type: "FeatureCollection",
      features,
    };
  }, [startNode, endNode, navigationNodes, routeGeoJSON]);

  const handleMapPan = (direction) => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const panAmount = 0.001;

    const center = map.getCenter();
    switch (direction) {
      case "up":
        // Pan up = go west = decrease longitude
        map.panTo([center.lng - panAmount, center.lat], { duration: 300 });
        break;
      case "down":
        // Pan down = go east = increase longitude
        map.panTo([center.lng + panAmount, center.lat], { duration: 300 });
        break;
      case "left":
        // Pan left = go south = decrease latitude
        map.panTo([center.lng, center.lat - panAmount], { duration: 300 });
        break;
      case "right":
        // Pan right = go north = increase latitude
        map.panTo([center.lng, center.lat + panAmount], { duration: 300 });
        break;
    }
  };

  const handleZoom = (direction) => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const currentZoom = map.getZoom();

    if (direction === "in") {
      map.zoomTo(currentZoom + 0.5, { duration: 300 });
    } else {
      map.zoomTo(currentZoom - 0.5, { duration: 300 });
    }
  };

  const resetMapView = () => {
    if (!mapRef.current) return;
    setIsResetting(true);
    const map = mapRef.current.getMap();
    map.flyTo({
      center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
      zoom: INITIAL_VIEW_STATE.zoom,
      pitch: 0,
      bearing: 270,
      duration: 1000,
      essential: true,
    });
    setIs3DView(false);
    setTimeout(() => {
      setIsResetting(false);
    }, 1000);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
        })
        .catch((err) => {
          console.error("Error attempting to enable fullscreen:", err);
        });
    } else {
      document
        .exitFullscreen()
        .then(() => {
          setIsFullscreen(false);
        })
        .catch((err) => {
          console.error("Error attempting to exit fullscreen:", err);
        });
    }
  };

  const toggle3DView = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (is3DView) {
      // Switch to 2D view - tilted to 270 degrees
      map.easeTo({
        pitch: 0,
        bearing: 270,
        duration: 1000,
      });
      setIs3DView(false);
    } else {
      // Switch to 3D view - tilted to 270 degrees with pitch
      map.easeTo({
        pitch: 45,
        bearing: 270,
        duration: 1000,
      });
      setIs3DView(true);
    }
  };

  const pathwayData = useMemo(() => {
    const pathways = [];

    pathways.push({
      type: "Feature",
      properties: {
        type: "pathway",
        name: "Main Central Corridor",
        width: 6,
        accessible: true,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81997, 18.96873],
          [72.81877, 18.96873],
        ],
      },
    });

    pathways.push({
      type: "Feature",
      properties: {
        type: "pathway",
        name: "South Side Corridor",
        width: 5,
        accessible: true,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81997, 18.96813],
          [72.81867, 18.96813],
        ],
      },
    });

    pathways.push({
      type: "Feature",
      properties: {
        type: "pathway",
        name: "Platform Access Corridor",
        width: 5,
        accessible: true,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81977, 18.96913],
          [72.81847, 18.96913],
        ],
      },
    });

    pathways.push({
      type: "Feature",
      properties: {
        type: "pathway",
        name: "East Connector",
        width: 4,
        accessible: true,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81967, 18.96913],
          [72.81967, 18.96813],
        ],
      },
    });

    pathways.push({
      type: "Feature",
      properties: {
        type: "pathway",
        name: "Mid Connector",
        width: 5,
        accessible: true,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81917, 18.96913],
          [72.81917, 18.96813],
        ],
      },
    });

    pathways.push({
      type: "Feature",
      properties: {
        type: "pathway",
        name: "West Connector",
        width: 4,
        accessible: true,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.81887, 18.96913],
          [72.81887, 18.96813],
        ],
      },
    });

    return {
      type: "FeatureCollection",
      features: pathways,
    };
  }, []);

  return (
    <div className="map-container">
      {!showPanel && (
        <button
          onClick={() => setShowPanel(true)}
          className="absolute top-4 left-4 z-10 bg-white p-3 rounded-lg shadow-xl hover:shadow-2xl transition"
          style={{ border: "1px solid #DADCE0" }}
          title="Show Navigator"
        >
          <span className="text-2xl">🚉</span>
        </button>
      )}

      {showPanel && (
        <div className="absolute top-4 left-4 z-10 bg-white p-4 rounded-lg shadow-xl w-80 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2
              className="text-xl font-bold text-gray-800"
              style={{ letterSpacing: "-0.5px" }}
            >
              🚉 Station Navigator
            </h2>
            <button
              onClick={() => setShowPanel(false)}
              className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition"
              title="Hide Navigator"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {(clickedStartNode || clickedEndNode) && !routeGeoJSON && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="text-xs font-semibold text-blue-700 mb-2">
                Selected Locations:
              </div>
              {clickedStartNode && (
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-blue-600">🚶</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-700">
                      Start:
                    </div>
                    <div className="text-sm text-gray-800">
                      {clickedStartNode.name}
                    </div>
                  </div>
                </div>
              )}
              {clickedEndNode && (
                <div className="flex items-start gap-2">
                  <span className="text-red-600">📍</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-700">
                      Destination:
                    </div>
                    <div className="text-sm text-gray-800">
                      {clickedEndNode.name}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3 mb-4">
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-1">
                Start Location
              </label>
              <input
                type="text"
                value="Kiosk Screen"
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-700 cursor-not-allowed"
                readOnly
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-1">
                Destination
              </label>
              <SearchableSelect
                options={[
                  { value: "", label: "Select destination..." },
                  ...locationOptions,
                ]}
                value={endNode}
                onChange={(value) => {
                  setEndNode(value);
                  // Find and set the clicked end node for display
                  const selectedNode = navigationNodes.find((n) => n.id === value);
                  if (selectedNode) {
                    setClickedEndNode(selectedNode);
                  } else {
                    setClickedEndNode(null);
                  }
                }}
                placeholder="Select destination..."
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={calculateRoute}
                disabled={!startNode || !endNode}
                className="flex-1 bg-green-600 text-white py-2 px-4 rounded font-semibold hover:bg-green-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Get Directions
              </button>
              {routeGeoJSON && (
                <button
                  onClick={clearRoute}
                  className="px-4 py-2 bg-red-500 text-white rounded font-semibold hover:bg-red-600 transition"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="mt-3 pt-3 border-t">
              {!selectionMode ? (
                <button
                  onClick={enableClickSelection}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2"
                >
                  <span>📍</span>
                  Select Location on Map
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    disabled
                    className="w-full bg-blue-400 text-white py-2 px-4 rounded font-semibold cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <span>📍</span>
                    Selecting..
                  </button>
                  <button
                    onClick={() => {
                      setSelectionMode(null);
                      setSelectionMessage(null);
                    }}
                    className="w-full bg-red-500 text-white py-2 px-4 rounded font-semibold hover:bg-red-600 transition"
                  >
                    ✕ Cancel Selection
                  </button>
                </div>
              )}
            </div>
          </div>

          {routeGeoJSON && routeDistance > 0 && (
            <div
              className="mb-1 p-3 bg-blue-50 rounded-lg"
              style={{ border: "1px solid #DADCE0" }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs text-gray-500">Walking Distance</div>
                  <div className="text-2lg font-bold text-gray-800">
                    {routeDistance}m
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Estimated Time</div>
                  <div className="text-2lg font-bold text-blue-600">
                    {Math.ceil(routeDistance / 1.4 / 60)} min
                  </div>
                </div>
              </div>
              {alternativeRoutes.length > 0 &&
                alternativeRoutes[selectedRouteIndex]?.routeType && (
                  <div className="text-xs text-gray-600 mt-1 flex items-center gap-1">
                    <span>🚶</span>
                    <span>
                      {alternativeRoutes[selectedRouteIndex].routeType}
                    </span>
                  </div>
                )}
            </div>
          )}

          {alternativeRoutes.length > 1 && (
            <div className="mb-3 p-3 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200">
              <div className="text-xs font-bold text-indigo-800 mb-2 flex items-center gap-1">
                <span>🔀</span>
                <span>
                  Route Options ({alternativeRoutes.length} available)
                </span>
              </div>
              <div className="space-y-2">
                {alternativeRoutes.map((route, index) => {
                  const isRoute1 = route.geoJSON?.properties?.routeNumber === 1;
                  const vc = route.geoJSON?.properties?.verticalCirculation;
                  const upStep = vc?.find((step) => step.type === "up");
                  const downStep = vc?.find((step) => step.type === "down");

                  const hasUpLift =
                    upStep?.options?.some((opt) => opt.type === "elevator") ||
                    false;
                  const hasUpEscalator =
                    upStep?.options?.some((opt) => opt.type === "escalator") ||
                    false;
                  const hasUpStaircase =
                    upStep?.options?.some((opt) => opt.type === "stairs") ||
                    false;

                  const hasDownLift =
                    downStep?.options?.some((opt) => opt.type === "elevator") ||
                    false;
                  const hasDownEscalator =
                    downStep?.options?.some(
                      (opt) => opt.type === "escalator"
                    ) || false;
                  const hasDownStaircase =
                    downStep?.options?.some((opt) => opt.type === "stairs") ||
                    false;

                  return (
                    <div
                      key={index}
                      className={`w-full rounded-lg text-left transition-all ${
                        selectedRouteIndex === index
                          ? "bg-white border border-gray-200 shadow-md"
                          : "bg-white border border-gray-200"
                      }`}
                    >
                      <button
                        onClick={() => selectRoute(index)}
                        className={`w-full p-2 rounded-lg ${
                          selectedRouteIndex === index
                            ? "bg-indigo-600 text-white"
                            : "bg-white text-gray-700 hover:bg-indigo-100"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-lg ${
                                selectedRouteIndex === index
                                  ? "text-white"
                                  : "text-indigo-600"
                              }`}
                            >
                              🚶
                            </span>
                            <div>
                              <div
                                className={`text-sm font-semibold ${
                                  selectedRouteIndex === index
                                    ? "text-white"
                                    : "text-gray-700"
                                }`}
                              >
                                {route.routeType || "Direct Route"}
                              </div>
                              <div
                                className={`text-xs ${
                                  selectedRouteIndex === index
                                    ? "text-indigo-200"
                                    : "text-gray-500"
                                }`}
                              >
                                {route.distance}m • ~
                                {Math.ceil(route.distance / 1.4 / 60)} min
                              </div>
                            </div>
                          </div>
                          {selectedRouteIndex === index && (
                            <span className="text-xs bg-white text-indigo-600 px-2 py-0.5 rounded-full font-semibold">
                              Selected
                            </span>
                          )}
                        </div>
                      </button>

                      {/* Route 1 Options inside the card */}
                      {selectedRouteIndex === index && isRoute1 && vc && (
                        <div
                          className={`px-2 pb-2 border-t ${
                            selectedRouteIndex === index
                              ? "border-gray-300"
                              : "border-gray-200"
                          }`}
                        >
                          <div className="pt-2">
                            <div className="flex gap-3">
                              {/* UP Section */}
                              <div className="flex-1">
                                <div
                                  className={`text-xs font-bold mb-2 flex items-center gap-1 ${
                                    selectedRouteIndex === index
                                      ? "text-gray-800"
                                      : "text-gray-800"
                                  }`}
                                >
                                  <span className="text-sm">↑</span>
                                  <span>Up</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  <div
                                    className={`flex items-center justify-between p-2 rounded border ${
                                      selectedRouteIndex === index
                                        ? "bg-white border-gray-300"
                                        : "bg-gray-50 border-gray-200"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm">🛗</span>
                                      <span
                                        className={`text-xs font-semibold ${
                                          selectedRouteIndex === index
                                            ? "text-gray-700"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        Lift
                                      </span>
                                    </div>
                                    <div className="text-sm font-bold">
                                      {hasUpLift ? (
                                        <span className="text-green-500">
                                          ✓
                                        </span>
                                      ) : (
                                        <span className="text-red-600">✕</span>
                                      )}
                                    </div>
                                  </div>
                                  <div
                                    className={`flex items-center justify-between p-2 rounded border ${
                                      selectedRouteIndex === index
                                        ? "bg-white border-gray-300"
                                        : "bg-gray-50 border-gray-200"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm">⬆️</span>
                                      <span
                                        className={`text-xs font-semibold ${
                                          selectedRouteIndex === index
                                            ? "text-gray-700"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        Esc
                                      </span>
                                    </div>
                                    <div className="text-sm font-bold">
                                      {hasUpEscalator ? (
                                        <span className="text-green-500">
                                          ✓
                                        </span>
                                      ) : (
                                        <span className="text-red-600">✕</span>
                                      )}
                                    </div>
                                  </div>
                                  <div
                                    className={`flex items-center justify-between p-2 rounded border ${
                                      selectedRouteIndex === index
                                        ? "bg-white border-gray-300"
                                        : "bg-gray-50 border-gray-200"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm">🪜</span>
                                      <span
                                        className={`text-xs font-semibold ${
                                          selectedRouteIndex === index
                                            ? "text-gray-700"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        Stair
                                      </span>
                                    </div>
                                    <div className="text-sm font-bold">
                                      {hasUpStaircase ? (
                                        <span className="text-green-500">
                                          ✓
                                        </span>
                                      ) : (
                                        <span className="text-red-600">✕</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* DOWN Section */}
                              <div className="flex-1">
                                <div
                                  className={`text-xs font-bold mb-2 flex items-center gap-1 ${
                                    selectedRouteIndex === index
                                      ? "text-gray-800"
                                      : "text-gray-800"
                                  }`}
                                >
                                  <span className="text-sm">↓</span>
                                  <span>Down</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  <div
                                    className={`flex items-center justify-between p-2 rounded border ${
                                      selectedRouteIndex === index
                                        ? "bg-white border-gray-300"
                                        : "bg-gray-50 border-gray-200"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm">🛗</span>
                                      <span
                                        className={`text-xs font-semibold ${
                                          selectedRouteIndex === index
                                            ? "text-gray-700"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        Lift
                                      </span>
                                    </div>
                                    <div className="text-sm font-bold">
                                      {hasDownLift ? (
                                        <span className="text-green-500">
                                          ✓
                                        </span>
                                      ) : (
                                        <span className="text-red-600">✕</span>
                                      )}
                                    </div>
                                  </div>
                                  <div
                                    className={`flex items-center justify-between p-2 rounded border ${
                                      selectedRouteIndex === index
                                        ? "bg-white border-gray-300"
                                        : "bg-gray-50 border-gray-200"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm">⬆️</span>
                                      <span
                                        className={`text-xs font-semibold ${
                                          selectedRouteIndex === index
                                            ? "text-gray-700"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        Esc
                                      </span>
                                    </div>
                                    <div className="text-sm font-bold">
                                      {hasDownEscalator ? (
                                        <span className="text-green-500">
                                          ✓
                                        </span>
                                      ) : (
                                        <span className="text-red-600">✕</span>
                                      )}
                                    </div>
                                  </div>
                                  <div
                                    className={`flex items-center justify-between p-2 rounded border ${
                                      selectedRouteIndex === index
                                        ? "bg-white border-gray-300"
                                        : "bg-gray-50 border-gray-200"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm">🪜</span>
                                      <span
                                        className={`text-xs font-semibold ${
                                          selectedRouteIndex === index
                                            ? "text-gray-700"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        Stair
                                      </span>
                                    </div>
                                    <div className="text-sm font-bold">
                                      {hasDownStaircase ? (
                                        <span className="text-green-500">
                                          ✓
                                        </span>
                                      ) : (
                                        <span className="text-red-600">✕</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Route 2 Options inside the card */}
                      {selectedRouteIndex === index &&
                        route.geoJSON?.properties?.routeNumber === 2 &&
                        vc && (
                          <div
                            className={`px-2 pb-2 border-t ${
                              selectedRouteIndex === index
                                ? "border-gray-300"
                                : "border-gray-200"
                            }`}
                          >
                            <div className="pt-2">
                              <div className="flex gap-3">
                                {/* UP Section */}
                                <div className="flex-1">
                                  <div
                                    className={`text-xs font-bold mb-2 flex items-center gap-1 ${
                                      selectedRouteIndex === index
                                        ? "text-gray-800"
                                        : "text-gray-800"
                                    }`}
                                  >
                                    <span className="text-sm">↑</span>
                                    <span>Up</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1">
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">🛗</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Lift
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasUpLift ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">⬆️</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Esc
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasUpEscalator ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">🪜</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Stair
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasUpStaircase ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* DOWN Section */}
                                <div className="flex-1">
                                  <div
                                    className={`text-xs font-bold mb-2 flex items-center gap-1 ${
                                      selectedRouteIndex === index
                                        ? "text-gray-800"
                                        : "text-gray-800"
                                    }`}
                                  >
                                    <span className="text-sm">↓</span>
                                    <span>Down</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1">
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">🛗</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Lift
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasDownLift ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">⬆️</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Esc
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasDownEscalator ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">🪜</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Stair
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasDownStaircase ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                      {/* Route 3 Options inside the card */}
                      {selectedRouteIndex === index &&
                        route.geoJSON?.properties?.routeNumber === 3 &&
                        vc && (
                          <div
                            className={`px-2 pb-2 border-t ${
                              selectedRouteIndex === index
                                ? "border-gray-300"
                                : "border-gray-200"
                            }`}
                          >
                            <div className="pt-2">
                              <div className="flex gap-3">
                                {/* UP Section */}
                                <div className="flex-1">
                                  <div
                                    className={`text-xs font-bold mb-2 flex items-center gap-1 ${
                                      selectedRouteIndex === index
                                        ? "text-gray-800"
                                        : "text-gray-800"
                                    }`}
                                  >
                                    <span className="text-sm">↑</span>
                                    <span>Up</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1">
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">🛗</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Lift
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasUpLift ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">⬆️</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Esc
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasUpEscalator ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">🪜</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Stair
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasUpStaircase ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* DOWN Section */}
                                <div className="flex-1">
                                  <div
                                    className={`text-xs font-bold mb-2 flex items-center gap-1 ${
                                      selectedRouteIndex === index
                                        ? "text-gray-800"
                                        : "text-gray-800"
                                    }`}
                                  >
                                    <span className="text-sm">↓</span>
                                    <span>Down</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1">
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">🛗</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Lift
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasDownLift ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">⬆️</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Esc
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasDownEscalator ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        selectedRouteIndex === index
                                          ? "bg-white border-gray-300"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm">🪜</span>
                                        <span
                                          className={`text-xs font-semibold ${
                                            selectedRouteIndex === index
                                              ? "text-gray-700"
                                              : "text-gray-700"
                                          }`}
                                        >
                                          Stair
                                        </span>
                                      </div>
                                      <div className="text-sm font-bold">
                                        {hasDownStaircase ? (
                                          <span className="text-green-500">✓</span>
                                        ) : (
                                          <span className="text-red-600">✕</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Turn-by-Turn Directions */}
          {showDirections && directions.length > 0 && (
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-800">
                  Turn-by-Turn Directions
                </h3>
                <button
                  onClick={() => setShowDirections(false)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Hide
                </button>
              </div>
              <ol className="space-y-2 text-sm">
                {directions.map((dir, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold mr-2 flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="text-gray-700">{dir}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Quick Access */}
          {!endNode && (
            <div className="border-t pt-3 mt-3">
              <button
                onClick={() => setShowQuickAccess(!showQuickAccess)}
                className="w-full flex items-center justify-between text-sm font-bold text-gray-800 mb-2 hover:bg-gray-50 p-2 rounded transition"
              >
                <span>Quick Access</span>
                <svg
                  className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${
                    showQuickAccess ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {showQuickAccess && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() =>
                      handleQuickAccessClick("n_kiosk_screen", "n_platform_5")
                    }
                    className="text-xs py-2 px-2 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition h-8 flex items-center justify-center text-center"
                  >
                    Kiosk → Main Pf 5
                  </button>
                  <button
                    onClick={() =>
                      handleQuickAccessClick("n_kiosk_screen", "n_platform_1")
                    }
                    className="text-xs py-2 px-2 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition h-8 flex items-center justify-center text-center"
                  >
                    Kiosk → Main Pf 1
                  </button>
                  <button
                    onClick={() =>
                      handleQuickAccessClick("n_kiosk_screen", "n_local_platform_1")
                    }
                    className="text-xs py-2 px-2 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition h-8 flex items-center justify-center text-center"
                  >
                    Kiosk → Local Pf 1
                  </button>
                  <button
                    onClick={() =>
                      handleQuickAccessClick("n_kiosk_screen", "n_platform_3")
                    }
                    className="text-xs py-2 px-2 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition h-8 flex items-center justify-center text-center"
                  >
                    Kiosk → Main Pf 3
                  </button>
                  <button
                    onClick={() =>
                      handleQuickAccessClick("n_kiosk_screen", "n_waiting_area")
                    }
                    className="text-xs py-2 px-2 bg-teal-100 text-teal-700 rounded hover:bg-teal-200 transition h-8 flex items-center justify-center text-center"
                  >
                    Kiosk → Waiting Area
                  </button>
                  <button
                    onClick={() =>
                      handleQuickAccessClick("n_kiosk_screen", "n_entrance_2")
                    }
                    className="text-xs py-2 px-2 bg-teal-100 text-teal-700 rounded hover:bg-teal-200 transition h-8 flex items-center justify-center text-center"
                  >
                    Kiosk → Entrance & Exit
                  </button>
                  <button
                    onClick={() =>
                      handleQuickAccessClick("n_kiosk_screen", "platform_3_coach_12")
                    }
                    className="text-xs py-2 px-2 bg-cyan-100 text-cyan-700 rounded hover:bg-cyan-200 transition h-8 flex items-center justify-center text-center"
                  >
                    Kiosk → Pf 3 Coach 12
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selection Message Banner / Toast */}
      {selectionMessage && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-2xl max-w-md text-center text-sm font-semibold animate-fade-in">
          {selectionMessage}
        </div>
      )}

      {/* Circular Navigation Pad */}
      <div className="map-control-pad">
        <div className="control-pad-container">
          {/* Up Button */}
          <button
            className="control-btn control-up"
            onClick={() => handleMapPan("up")}
            title="Pan Up"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14l5-5 5 5z" />
            </svg>
          </button>

          {/* Right Button */}
          <button
            className="control-btn control-right"
            onClick={() => handleMapPan("right")}
            title="Pan Right"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 7l5 5-5 5z" />
            </svg>
          </button>

          {/* Down Button */}
          <button
            className="control-btn control-down"
            onClick={() => handleMapPan("down")}
            title="Pan Down"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>

          {/* Left Button */}
          <button
            className="control-btn control-left"
            onClick={() => handleMapPan("left")}
            title="Pan Left"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 7l-5 5 5 5z" />
            </svg>
          </button>

          {/* Center Zoom Controls */}
          <div className="zoom-controls">
            <button
              className="zoom-btn zoom-in"
              onClick={() => handleZoom("in")}
              title="Zoom In"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <div className="zoom-divider"></div>
            <button
              className="zoom-btn zoom-out"
              onClick={() => handleZoom("out")}
              title="Zoom Out"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <path d="M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Reset Map View Button */}
      <button
        onClick={resetMapView}
        className={`reset-map-btn ${isResetting ? "is-resetting" : ""}`}
        title="Recentre Map"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </button>

      {/* Fullscreen Toggle Button */}
      <button
        onClick={toggleFullscreen}
        className="fullscreen-btn"
        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      >
        {isFullscreen ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M8 3v3a2 2 0 0 1-2 2H3" />
            <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
            <path d="M3 16h3a2 2 0 0 1 2 2v3" />
            <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        )}
      </button>

      {/* 2D/3D View Toggle Button */}
      <button
        onClick={toggle3DView}
        className="view-toggle-btn"
        title={is3DView ? "Switch to 2D View" : "Switch to 3D View"}
      >
        {is3DView ? (
          // Icon for 3D mode (showing cube/3D symbol)
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        ) : (
          // Icon for 2D mode (showing map/layers symbol)
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        )}
      </button>

      {/* Base Map Selector - Chips */}
      <div className="base-map-chips">
        {Object.keys(BASE_MAPS).map((name) => (
          <button
            key={name}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelectedBaseMap(name);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelectedBaseMap(name);
            }}
            className={`base-map-chip ${
              selectedBaseMap === name ? "active" : ""
            }`}
            title={BASE_MAPS[name].description}
          >
            {BASE_MAPS[name].label}
          </button>
        ))}
      </div>

      {/* Map Component */}
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        style={{ width: "100%", height: "100%" }}
        mapStyle={BASE_MAPS[selectedBaseMap].url}
        minPitch={is3DView ? 0 : 0}
        maxPitch={is3DView ? 85 : 0}
        minZoom={17}
        maxZoom={20}
        maxBounds={MUMBAI_CENTRAL_BOUNDS}
        onMouseMove={(event) => {
          const feature = event.features && event.features[0];
          if (feature && feature.properties.name) {
            setHoverInfo({
              longitude: event.lngLat.lng,
              latitude: event.lngLat.lat,
              name: feature.properties.name,
              type: feature.properties.type,
              category: feature.properties.category,
            });
          } else {
            setHoverInfo(null);
          }
        }}
        onClick={handleMapClick}
        interactiveLayerIds={[
          "3d-buildings-base",
          "3d-amenities",
          "3d-entrances-sides",
          "3d-entrances-top",
          "3d-coaches-filtered",
          "3d-coaches-highlighted",
          "3d-engines-filtered",
          "3d-vertical-circulation",
          "3d-stair-steps",
          "3d-escalator-steps",
          "room-labels",
          "coach-labels-filtered",
          "engine-labels-filtered",
          "platform-node-labels",
          "fob-labels",
          "entrance-exit-labels",
        ]}
        cursor={selectionMode || !startNode || !endNode ? "crosshair" : "auto"}
      >
        {/* Navigation Controls */}
        <NavigationControl position="bottom-right" />

        {/* Mask: hide base map outside the station footprint */}
        <Source id="map-mask" type="geojson" data={mapMaskGeoJSON}>
          <Layer
            id="map-mask-fill"
            type="fill"
            paint={{
              "fill-color": "#f5f5f5",
              "fill-opacity": 1,
            }}
          />
        </Source>

        <Source id="pathways" type="geojson" data={pathwayData}>
          {/* Pathway outer border */}
          <Layer
            id="pathway-outer"
            type="line"
            paint={{
              "line-color": "#ffffff",
              "line-width": ["*", ["coalesce", ["get", "width"], 5], 2.5],
              "line-opacity": 0.9,
            }}
          />
          {/* Pathway background */}
          <Layer
            id="pathway-background"
            type="line"
            paint={{
              "line-color": "#e8e8e8",
              "line-width": ["*", ["coalesce", ["get", "width"], 5], 2],
              "line-opacity": 0.7,
            }}
          />
          {/* Pathway border */}
          <Layer
            id="pathway-border"
            type="line"
            paint={{
              "line-color": "#bdbdbd",
              "line-width": ["*", ["coalesce", ["get", "width"], 5], 2.2],
              "line-opacity": 0.4,
              "line-gap-width": 0,
            }}
          />
          {/* Dashed center line for pathways */}
          <Layer
            id="pathway-centerline"
            type="line"
            paint={{
              "line-color": "#9e9e9e",
              "line-width": 1,
              "line-dasharray": [3, 3],
              "line-opacity": 0.3,
            }}
          />
        </Source>

        <Source id="station-data" type="geojson" data={processedStationData}>
          <Layer
            id="3d-buildings-base"
            type="fill-extrusion"
            filter={[
              "all",
              ["!=", "type", "nav_node"],
              ["!=", "type", "track"],
              ["!=", "type", "amenity"],
              ["!=", "type", "elevator"],
              ["!=", "type", "stairs"],
              ["!=", "type", "escalator"],
              ["!=", "type", "coach"], // Exclude coaches (handled separately)
              ["!=", "type", "engine"], // Exclude engines (handled separately)
            ]}
            paint={{
              "fill-extrusion-color": ["get", "color"],
              "fill-extrusion-height": ["get", "height"],
              "fill-extrusion-base": ["coalesce", ["get", "base"], 0],
              "fill-extrusion-opacity": 1,
            }}
          />
          <Layer
            id="3d-amenities"
            type="fill-extrusion"
            filter={[
              "all",
              ["==", "type", "amenity"],
              ["!=", "category", "entrance"],
            ]}
            paint={{
              "fill-extrusion-color": ["get", "color"],
              "fill-extrusion-height": ["+", ["get", "height"], 0.05],
              "fill-extrusion-base": 0.05,
              "fill-extrusion-opacity": 1,
            }}
          />
          {/* Dedicated layer for entrance/exit - sides with Mumbai Central color */}
          <Layer
            id="3d-entrances-sides"
            type="fill-extrusion"
            filter={[
              "all",
              ["==", "type", "amenity"],
              ["==", "category", "entrance"],
            ]}
            paint={{
              "fill-extrusion-color": "#ededed", // Mumbai Central building color for sides
              "fill-extrusion-height": ["+", ["get", "height"], 0.1],
              "fill-extrusion-base": 0.1,
              "fill-extrusion-opacity": 1,
            }}
          />

          <Layer
            id="3d-entrances-top"
            type="fill-extrusion"
            filter={[
              "all",
              ["==", "type", "amenity"],
              ["==", "category", "entrance"],
            ]}
            paint={{
              "fill-extrusion-color": ["get", "color"],
              "fill-extrusion-height": ["+", ["get", "height"], 0.1],
              "fill-extrusion-base": ["-", ["+", ["get", "height"], 0.1], 0.01], // Extremely thin layer (0.01 units)
              "fill-extrusion-opacity": 1,
            }}
          />
          {/* Coaches and engines are now handled separately via filtered source */}

          <Layer
            id="3d-stair-steps"
            type="fill-extrusion"
            filter={["==", ["get", "isStairStep"], true]}
            paint={{
              "fill-extrusion-color": ["get", "color"],
              "fill-extrusion-height": ["get", "height"],
              "fill-extrusion-base": ["coalesce", ["get", "base"], 0],
              "fill-extrusion-opacity": 1,
            }}
          />
          {/* Escalator steps - rendered separately to show stepped appearance */}
          <Layer
            id="3d-escalator-steps"
            type="fill-extrusion"
            filter={["==", ["get", "isEscalatorStep"], true]}
            paint={{
              "fill-extrusion-color": ["get", "color"],
              "fill-extrusion-height": ["get", "height"],
              "fill-extrusion-base": ["coalesce", ["get", "base"], 0],
              "fill-extrusion-opacity": 1,
            }}
          />
          {/* Other vertical circulation (elevators) */}
          <Layer
            id="3d-vertical-circulation"
            type="fill-extrusion"
            filter={["in", ["get", "type"], ["literal", ["elevator"]]]}
            paint={{
              "fill-extrusion-color": ["get", "color"],
              "fill-extrusion-height": ["+", ["get", "height"], 0.1],
              "fill-extrusion-base": [
                "+",
                ["coalesce", ["get", "base"], 0],
                0.1,
              ],
              "fill-extrusion-opacity": 1,
            }}
          />
          <Layer
            id="room-labels"
            type="symbol"
            filter={[
              "all",
              [
                "in",
                ["get", "type"],
                [
                  "literal",
                  [
                    "room",
                    "platform",
                    "amenity",
                    "stairs",
                    "bridge",
                    "elevator",
                    "escalator",
                    "ramp",
                    "accessibility",
                  ],
                ],
              ],
              [
                "any",
                ["!=", ["get", "isStairStep"], true],
                ["==", ["get", "stepIndex"], 0],
              ],
              [
                "any",
                ["!=", ["get", "isEscalatorStep"], true],
                ["==", ["get", "stepIndex"], 0],
              ],
              ["!=", ["get", "category"], "parcel_office"],
              ["!=", ["get", "category"], "booking_office"],
              ["!=", ["get", "category"], "parking"],
              ["!=", ["get", "category"], "park"],
              ["!=", ["get", "category"], "waiting_area"],
              ["!=", ["get", "category"], "ticket_counter"],
              ["!=", ["get", "category"], "kiosk_screen"],
              ["!=", ["get", "category"], "engine"],
              ["!=", ["get", "type"], "coach"],
              ["!=", ["get", "type"], "engine"],
              [
                "!",
                [
                  "all",
                  ["==", ["get", "type"], "bridge"],
                  ["==", ["get", "category"], "walkway"],
                ],
              ],
              [
                "!",
                [
                  "all",
                  ["==", ["get", "type"], "platform"],
                  [
                    "in",
                    ["downcase", ["get", "name"]],
                    [
                      "literal",
                      [
                        "bct main platform 1",
                        "bct main platform 2",
                        "bct main platform 3",
                        "bct main platform 4",
                        "bct main platform 5",
                        "bct local platform 1",
                        "bct local platform 2",
                        "bct local platform 3",
                      ],
                    ],
                  ],
                ],
              ],
            ]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "center",
              "text-offset": [0, 0],
              "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
              "text-optional": false,
            }}
            paint={{
              "text-color": "#333",
              "text-halo-color": "#fff",
              "text-halo-width": 2,
              "text-opacity": 1,
            }}
          />
          <Layer
            id="platform-node-labels"
            type="symbol"
            filter={[
              "all",
              ["==", ["get", "type"], "nav_node"],
              [
                "match",
                ["downcase", ["get", "name"]],
                [
                  "bct main platform 1",
                  "bct main platform 2",
                  "bct main platform 3",
                  "bct main platform 4",
                  "bct main platform 5",
                  "bct local platform 1",
                  "bct local platform 2",
                  "bct local platform 3",
                  "bct local platform 4",
                ],
                true,
                false,
              ],
            ]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "center",
              "text-offset": [0, 0],
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-optional": false,
            }}
            paint={{
              "text-color": "#1a1a1a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 3,
              "text-opacity": 1,
            }}
          />
          <Layer
            id="fob-labels"
            type="symbol"
            filter={[
              "all",
              ["==", ["get", "type"], "bridge"],
              ["==", ["get", "category"], "fob"],
            ]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "center",
              "text-offset": [0, 0],
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-optional": false,
            }}
            paint={{
              "text-color": "#1a1a1a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 3,
              "text-opacity": 1,
            }}
          />
          <Layer
            id="skywalk-labels"
            type="symbol"
            filter={[
              "all",
              ["==", ["get", "type"], "bridge"],
              ["==", ["get", "category"], "walkway"],
            ]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "center",
              "text-offset": [0, 0],
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-optional": false,
            }}
            paint={{
              "text-color": "#1a1a1a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 3,
              "text-opacity": 1,
            }}
          />
          <Layer
            id="entrance-exit-labels"
            type="symbol"
            filter={[
              "all",
              [
                "any",
                ["==", ["get", "category"], "entrance"],
                [
                  "all",
                  [
                    "in",
                    ["downcase", ["get", "name"]],
                    [
                      "literal",
                      [
                        "entrance",
                        "exit",
                        "entrance & exit",
                        "entrance and exit",
                        "mumbai central",
                        "main entrance",
                        "parcel office",
                        "prs/ticket booking office",
                        "waiting area",
                        "ticket counter",
                        "kiosk screen",
                      ],
                    ],
                  ],
                  ["!=", ["get", "type"], "nav_node"],
                ],
                ["==", ["get", "category"], "waiting_area"],
              ],
              ["!=", ["get", "type"], "coach"],
              ["!=", ["get", "type"], "engine"],
            ]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "center",
              "text-offset": [0, 0],
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-optional": false,
            }}
            paint={{
              "text-color": "#1a1a1a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 3,
              "text-opacity": 1,
            }}
          />
          <Layer
            id="parking-area-label"
            type="symbol"
            filter={[
              "any",
              [
                "all",
                ["==", ["get", "category"], "parking"],
                ["==", ["downcase", ["get", "name"]], "vehicle parking area"],
              ],
              ["==", ["get", "category"], "park"],
            ]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "center",
              "text-offset": [0, 0],
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-optional": false,
              "text-allow-overlap": false,
              "text-ignore-placement": false,
            }}
            paint={{
              "text-color": "#1a1a1a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 3,
              "text-opacity": 1,
            }}
          />
        </Source>

        {/* "I am here" location label - only label, no line/polygon */}
        <Source id="i-am-here" type="geojson" data={iAmHereGeoJSON}>
          <Layer
            id="i-am-here-label"
            type="symbol"
            filter={["==", ["get", "type"], "location_marker"]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "center",
              "text-offset": [0, 0],
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-optional": false,
            }}
            paint={{
              "text-color": "#1a1a1a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 3,
              "text-opacity": 1,
            }}
          />
        </Source>

        {hasValidCoachProps({ platform: displayPlatform || platform, showAllCoaches }) && (
          <Source
            id="filtered-coaches-engines"
            type="geojson"
            data={filteredCoachesAndEngines}
          >
            <Layer
              id="3d-coaches-filtered"
              type="fill-extrusion"
              filter={[
                "all",
                ["==", "type", "coach"],
                ["!has", "isHighlighted"],
              ]}
              paint={{
                "fill-extrusion-color": ["get", "color"],
                "fill-extrusion-height": ["get", "height"],
                "fill-extrusion-base": 0,
                "fill-extrusion-opacity": 0.9,
              }}
            />
            <Layer
              id="3d-coaches-highlighted"
              type="fill-extrusion"
              filter={[
                "all",
                ["==", "type", "coach"],
                ["has", "isHighlighted"],
              ]}
              paint={{
                "fill-extrusion-color": "#00FF00",
                "fill-extrusion-height": ["*", ["get", "height"], 1.5],
                "fill-extrusion-base": 0,
                "fill-extrusion-opacity": 0.95,
              }}
            />
            {/* Engines */}
            <Layer
              id="3d-engines-filtered"
              type="fill-extrusion"
              filter={["==", "type", "engine"]}
              paint={{
                "fill-extrusion-color": ["get", "color"],
                "fill-extrusion-height": ["get", "height"],
                "fill-extrusion-base": 0,
                "fill-extrusion-opacity": 0.9,
              }}
            />
            {/* Coach labels */}
            <Layer
              id="coach-labels-filtered"
              type="symbol"
              filter={["==", "type", "coach"]}
              layout={{
                "text-field": ["concat", "C", ["get", "coachNumber"]],
                "text-size": [
                  "case",
                  ["==", ["get", "isHighlighted"], true],
                  14,
                  10,
                ],
                "text-anchor": "center",
                "text-offset": [0, 0],
                "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
                "text-optional": false,
              }}
              paint={{
                "text-color": "#000000",
                "text-halo-color": "#FFFFFF",
                "text-halo-width": [
                  "case",
                  ["==", ["get", "isHighlighted"], true],
                  3,
                  2.5,
                ],
                "text-halo-blur": 1,
                "text-opacity": 1,
              }}
            />
            {/* Engine labels */}
            <Layer
              id="engine-labels-filtered"
              type="symbol"
              filter={["==", "type", "engine"]}
              layout={{
                "text-field": "Engine",
                "text-size": 10,
                "text-anchor": "center",
                "text-offset": [0, 0],
                "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
                "text-optional": false,
              }}
              paint={{
                "text-color": "#000",
                "text-halo-color": "#FFFFFF",
                "text-halo-width": 2.5,
                "text-halo-blur": 1,
                "text-opacity": 1,
              }}
            />
          </Source>
        )}

        {/* Route Visualization */}
        {routeGeoJSON && (
          <Source
            key={`route-${selectedRouteIndex}`}
            id="route-data"
            type="geojson"
            data={routeGeoJSON}
          >
            <Layer
              id="route-glow"
              type="line"
              paint={{
                "line-color": "#4285F4",
                "line-width": 16,
                "line-opacity": 0.2,
                "line-blur": 4,
              }}
            />

            <Layer
              id="route-outline"
              type="line"
              paint={{
                "line-color": "#ffffff",
                "line-width": 12,
                "line-opacity": 1,
              }}
            />

            <Layer
              id="route-line"
              type="line"
              paint={{
                "line-color": "#4285F4",
                "line-width": 8,
                "line-opacity": 1,
              }}
            />

            <Layer
              id="route-animated"
              type="line"
              paint={{
                "line-color": "#ffffff",
                "line-width": 2,
                "line-opacity": 0.6,
                "line-dasharray": [0, 4, 3],
              }}
            />

            <Layer
              id="route-arrows"
              type="symbol"
              layout={{
                "symbol-placement": "line",
                "text-field": "▶",
                "text-size": 16,
                "symbol-spacing": 50,
                "text-keep-upright": false,
                "text-rotation-alignment": "map",
              }}
              paint={{
                "text-color": "#ffffff",
                "text-halo-color": "#4285F4",
                "text-halo-width": 2,
              }}
            />
          </Source>
        )}

        {clickedStartNode && !routeGeoJSON && (
          <Marker
            longitude={clickedStartNode.coordinates[0]}
            latitude={clickedStartNode.coordinates[1]}
            anchor="center"
          >
            <div style={{ position: "relative" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: "#4285F4",
                  border: "4px solid white",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  animation: "pulse 2s infinite",
                }}
              >
                🚶
              </div>
              <div
                style={{
                  position: "absolute",
                  top: "45px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "#4285F4",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  whiteSpace: "nowrap",
                  fontSize: "11px",
                  fontWeight: "600",
                  fontFamily:
                    "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
                }}
              >
                START: {clickedStartNode.name}
              </div>
            </div>
          </Marker>
        )}

        {clickedEndNode && !routeGeoJSON && (
          <Marker
            longitude={clickedEndNode.coordinates[0]}
            latitude={clickedEndNode.coordinates[1]}
            anchor="center"
          >
            <div style={{ position: "relative" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: "#EA4335",
                  border: "4px solid white",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  animation: "pulse 2s infinite",
                }}
              >
                📍
              </div>
              <div
                style={{
                  position: "absolute",
                  top: "45px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "#EA4335",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  whiteSpace: "nowrap",
                  fontSize: "11px",
                  fontWeight: "600",
                  fontFamily:
                    "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
                }}
              >
                END: {clickedEndNode.name}
              </div>
            </div>
          </Marker>
        )}

        {routeGeoJSON &&
          startNode &&
          (() => {
            const node = navigationNodes.find((n) => n.id === startNode);
            if (!node) return null;
            return (
              <Marker
                longitude={node.coordinates[0]}
                latitude={node.coordinates[1]}
                anchor="bottom"
              >
                <div style={{ position: "relative" }}>
                  <svg
                    width="40"
                    height="50"
                    viewBox="0 0 40 50"
                    style={{
                      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
                      cursor: "pointer",
                    }}
                  >
                    <circle cx="20" cy="20" r="18" fill="#4285F4" />
                    <circle
                      cx="20"
                      cy="20"
                      r="18"
                      fill="none"
                      stroke="white"
                      strokeWidth="3"
                    />

                    <g transform="translate(20, 20)" fill="white">
                      <circle cx="0" cy="-6" r="4" />
                      <path d="M -5 8 L -5 0 L -3 -2 L 3 -2 L 5 0 L 5 8 L 3 8 L 3 2 L -3 2 L -3 8 Z" />
                    </g>

                    <circle cx="20" cy="38" r="3" fill="#4285F4" />
                  </svg>

                  <div
                    style={{
                      position: "absolute",
                      top: "52px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      backgroundColor: "white",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                      whiteSpace: "nowrap",
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "#202124",
                    }}
                  >
                    {node.name}
                  </div>
                </div>
              </Marker>
            );
          })()}

        {routeGeoJSON &&
          startNode &&
          selectedBaseMap === "CartoDB Positron" &&
          (() => {
            const node = navigationNodes.find((n) => n.id === startNode);
            if (!node) return null;

            let rotation = 0;
            let arrowLng = node.coordinates[0];
            let arrowLat = node.coordinates[1];

            if (routeGeoJSON?.geometry?.coordinates?.length >= 2) {
              const coords = routeGeoJSON.geometry.coordinates;
              const startCoord = coords[0];
              const nextCoord = coords[1];

              arrowLng = startCoord[0] + (nextCoord[0] - startCoord[0]) * 0.37;
              arrowLat = startCoord[1] + (nextCoord[1] - startCoord[1]) * 0.37;

              // Calculate bearing angle (geographic bearing)
              const dLon = ((nextCoord[0] - startCoord[0]) * Math.PI) / 180;
              const lat1 = (startCoord[1] * Math.PI) / 180;
              const lat2 = (nextCoord[1] * Math.PI) / 180;
              const y = Math.sin(dLon) * Math.cos(lat2);
              const x =
                Math.cos(lat1) * Math.sin(lat2) -
                Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
              // Convert to degrees and adjust: bearing is clockwise from north,
              // but our arrow points up (north) at 0deg, so we need to convert
              const bearing = (Math.atan2(y, x) * 180) / Math.PI;
              // Adjust rotation: bearing 0=East in atan2, we need 0=North
              rotation = bearing;
            }

            return (
              <Marker longitude={arrowLng} latitude={arrowLat} anchor="center">
                <div className="navigation-arrow-container">
                  <svg
                    className="navigation-arrow"
                    width="36"
                    height="36"
                    viewBox="0 0 48 48"
                    style={{
                      transform: `rotate(${rotation - 90}deg)`,
                      cursor: "pointer",
                    }}
                  >
                    <circle cx="24" cy="24" r="22" fill="white" />
                    <circle cx="24" cy="24" r="20" fill="#4285F4" />
                    <path
                      d="M24 10 L32 30 L24 25 L16 30 Z"
                      fill="white"
                      stroke="white"
                      strokeWidth="1"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </Marker>
            );
          })()}

        {routeGeoJSON &&
          endNode &&
          (() => {
            const node = navigationNodes.find((n) => n.id === endNode);
            if (!node) return null;
            return (
              <Marker
                longitude={node.coordinates[0]}
                latitude={node.coordinates[1]}
                anchor="bottom"
              >
                <div style={{ position: "relative" }}>
                  <svg
                    width="40"
                    height="50"
                    viewBox="0 0 40 50"
                    style={{
                      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
                      cursor: "pointer",
                    }}
                  >
                    <path
                      d="M 20 2 C 11 2 4 9 4 18 C 4 28 20 46 20 46 C 20 46 36 28 36 18 C 36 9 29 2 20 2 Z"
                      fill="#EA4335"
                      stroke="white"
                      strokeWidth="2"
                    />

                    <circle cx="20" cy="18" r="6" fill="white" />
                    <circle cx="20" cy="18" r="4" fill="#EA4335" />
                  </svg>

                  <div
                    style={{
                      position: "absolute",
                      top: "52px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      backgroundColor: "white",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                      whiteSpace: "nowrap",
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "#202124",
                    }}
                  >
                    {node.name}
                  </div>
                </div>
              </Marker>
            );
          })()}

        {hoverInfo && (
          <Popup
            longitude={hoverInfo.longitude}
            latitude={hoverInfo.latitude}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={[0, -10]}
          >
            <div className="popup-content p-2">
              <div className="font-bold text-sm">{hoverInfo.name}</div>
              {hoverInfo.category && (
                <div className="text-xs text-gray-600 capitalize">
                  {hoverInfo.category}
                </div>
              )}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
