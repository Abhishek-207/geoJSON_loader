import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Map, { Layer, Source, Marker, Popup } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import lineStringsRaw from "./data/lineStrings.json";
import structuresRaw from "./data/structures.json";
import { processStructures } from "./utils/structureProcessor";
import { buildNavigationGraph, haversine } from "./utils/navigationGraph";
import { findKAlternatives, pathsToRoutes } from "./utils/pathfinding";
import {
  detectVerticalCirculation,
  generateDirections,
  summarizeVerticalCirculation,
} from "./utils/directions";
import SearchableSelect from "./components/SearchableSelect";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Approximate location of the kiosk inside Marine Lines station. The closest
// graph node becomes the routing start.
const KIOSK_COORD = [72.82433, 18.94455];

const INITIAL_VIEW_STATE = {
  // Match the kiosk-on-left horizontal station orientation from the design
  // reference: bearing ≈ 250° rotates the camera so the station's long axis
  // (kiosk → FOB North) lies left → right on screen.
  longitude: 72.8240,
  latitude: 18.9457,
  zoom: 18,
  pitch: 45,
  bearing: 250,
};

// Soft lock — users can pan around the station with some breathing room but
// can't drift far away from it. ~150m buffer on each side of the station
// footprint (72.8228..72.8250 lon, 18.9444..18.9471 lat).
const MARINE_LINES_BOUNDS = [
  72.8215, // West
  18.9430, // South
  72.8265, // East
  18.9490, // North
];

// Station footprint (≈250m × 300m). Used for the surroundings mask, NOT for
// pan/zoom — the user can freely move the camera; only tiles outside this
// polygon get hidden so we keep visual focus on Marine Lines.
const STATION_BBOX = {
  west: 72.8222,
  south: 18.9438,
  east: 72.8254,
  north: 18.9476,
};

// A polygon that covers the world with a hole over the station — used as the
// "everything outside the station is masked" overlay.
const STATION_MASK_FEATURE = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      // Outer ring (world)
      [
        [-180, -85],
        [180, -85],
        [180, 85],
        [-180, 85],
        [-180, -85],
      ],
      // Inner ring (station = hole). MUST be wound opposite to the outer ring.
      [
        [STATION_BBOX.west, STATION_BBOX.south],
        [STATION_BBOX.west, STATION_BBOX.north],
        [STATION_BBOX.east, STATION_BBOX.north],
        [STATION_BBOX.east, STATION_BBOX.south],
        [STATION_BBOX.west, STATION_BBOX.south],
      ],
    ],
  },
};

// Free, no-API-key OSM raster style — used when MapTiler key is missing so
// the "Detailed" chip still produces a real detailed map.
// IMPORTANT: includes a `glyphs` URL — without it, custom symbol/text layers
// (our station labels) can't load font glyphs and silently fail to render.
const OSM_RASTER_STYLE = {
  version: 8,
  // orangemug's hosted glyphs include Open Sans Bold/Regular/Italic — needed
  // because MapLibre's demo glyphs only have Regular.
  glyphs: "https://orangemug.github.io/font-glyphs/glyphs/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
};

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY || "";
const detailedStyle = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/openstreetmap/style.json?key=${MAPTILER_KEY}`
  : OSM_RASTER_STYLE;

const BASE_MAPS = {
  OpenStreetMap: {
    url: detailedStyle,
    description: "Classic OSM style",
    label: "Detailed",
  },
  "CartoDB Positron": {
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    description: "Light, minimal style",
    label: "Standard",
  },
};

// Quick-access destinations.
const QUICK_ACCESS = [
  { name: "Platform 1", color: "purple" },
  { name: "Platform 2", color: "purple" },
  { name: "Platform 3", color: "indigo" },
  { name: "Platform 4", color: "indigo" },
  { name: "Booking Office", color: "teal" },
  { name: "Toilets", color: "teal" },
  { name: "Exit 1", color: "cyan" },
  { name: "Entry 1", color: "cyan" },
];

const ROUTE_COLORS = ["#1976D2", "#7E57C2", "#26A69A"];

// MapLibre expression: true when a feature's name represents a Platform / FOB
// / Flyover / Booking Office / Toilet. These render bold, black, larger and
// always show. Coaches / staircases / escalators / lifts / entries / exits
// keep the regular label style.
const NAME_LC = ["downcase", ["coalesce", ["get", "name"], ""]];
const IS_IMPORTANT_LABEL = [
  "any",
  // "platform" but exclude coach names like "Platform 1 Coach 5"
  ["all", ["in", "platform", NAME_LC], ["!", ["in", "coach", NAME_LC]]],
  ["in", "fob", NAME_LC],
  ["in", "flyover", NAME_LC],
  ["in", "booking", NAME_LC],
  ["in", "office", NAME_LC],
  ["in", "toilet", NAME_LC],
  ["in", "entry", NAME_LC],
  ["in", "exit", NAME_LC],
];

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const mapRef = useRef(null);

  // Build graph + processed structures (memoized)
  const nav = useMemo(
    () =>
      buildNavigationGraph(lineStringsRaw, structuresRaw, {
        kioskCoord: KIOSK_COORD,
      }),
    [],
  );
  const processedStructures = useMemo(
    () => processStructures(structuresRaw).processed,
    [],
  );

  // ---- UI state (mirrors POC) ----
  const [hoverInfo, setHoverInfo] = useState(null);
  const [showPanel, setShowPanel] = useState(true);
  const [showQuickAccess, setShowQuickAccess] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedBaseMap, setSelectedBaseMap] = useState("OpenStreetMap");
  const [is3DView, setIs3DView] = useState(true);

  const [endNode, setEndNode] = useState("");
  const [selectionMode, setSelectionMode] = useState(null);
  const [selectionMessage, setSelectionMessage] = useState(null);

  const destinations = nav.destinations;

  // Sorted destination dropdown options
  const locationOptions = useMemo(
    () =>
      destinations
        .filter((d) => d.nodeId)
        .map((d) => ({ value: d.id, label: d.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [destinations],
  );

  const selectedDest = useMemo(
    () => destinations.find((d) => d.id === endNode) || null,
    [destinations, endNode],
  );

  // Compute routes when destination changes
  const routes = useMemo(() => {
    if (!nav.kioskNodeId || !selectedDest?.nodeId) return [];
    if (nav.kioskNodeId === selectedDest.nodeId) return [];
    const paths = findKAlternatives(
      nav.graph,
      nav.kioskNodeId,
      selectedDest.nodeId,
      2,
    );
    const baseRoutes = pathsToRoutes(paths);
    // Enrich each route with vertical-circulation info + directions text.
    return baseRoutes.map((r) => {
      const verticals = detectVerticalCirculation(r.coords, structuresRaw);
      const vc = summarizeVerticalCirculation(verticals);
      const directions = generateDirections({
        pathCoords: r.coords,
        destinationName: selectedDest.name,
        verticals,
      });
      return { ...r, verticals, vc, directions };
    });
  }, [nav, selectedDest]);

  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  useEffect(() => {
    setSelectedRouteIndex(0);
    setShowDirections(!!endNode); // auto-show when a destination is picked
  }, [endNode]);

  const activeRoute = routes[selectedRouteIndex] || null;

  // Routes as a FeatureCollection for map rendering
  const routesFC = useMemo(
    () => ({
      type: "FeatureCollection",
      features: routes.map((r, i) => ({
        type: "Feature",
        properties: {
          id: r.id,
          color: ROUTE_COLORS[i % ROUTE_COLORS.length],
          isActive: i === selectedRouteIndex,
        },
        geometry: { type: "LineString", coordinates: r.coords },
      })),
    }),
    [routes, selectedRouteIndex],
  );

  // Active route only — used by the multi-layer "arrowed" rendering path.
  const activeRouteFC = useMemo(() => {
    const r = routes[selectedRouteIndex];
    if (!r) return null;
    return {
      type: "Feature",
      properties: { id: r.id },
      geometry: { type: "LineString", coordinates: r.coords },
    };
  }, [routes, selectedRouteIndex]);

  // ---- Map controls (POC parity) ----
  const handleMapPan = (direction) => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const panAmount = 0.0007;
    const center = map.getCenter();
    switch (direction) {
      case "up":
        map.panTo([center.lng, center.lat + panAmount], { duration: 300 });
        break;
      case "down":
        map.panTo([center.lng, center.lat - panAmount], { duration: 300 });
        break;
      case "left":
        map.panTo([center.lng - panAmount, center.lat], { duration: 300 });
        break;
      case "right":
        map.panTo([center.lng + panAmount, center.lat], { duration: 300 });
        break;
      default:
        break;
    }
  };

  const handleZoom = (direction) => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const z = map.getZoom();
    map.zoomTo(direction === "in" ? z + 0.5 : z - 0.5, { duration: 300 });
  };

  const resetMapView = () => {
    if (!mapRef.current) return;
    setIsResetting(true);
    const map = mapRef.current.getMap();
    map.flyTo({
      center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
      zoom: INITIAL_VIEW_STATE.zoom,
      pitch: INITIAL_VIEW_STATE.pitch,
      bearing: INITIAL_VIEW_STATE.bearing,
      duration: 1000,
      essential: true,
    });
    setTimeout(() => setIsResetting(false), 1000);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggle3DView = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (is3DView) {
      map.easeTo({ pitch: 0, duration: 1000 });
      setIs3DView(false);
    } else {
      map.easeTo({ pitch: 45, duration: 1000 });
      setIs3DView(true);
    }
  };

  // ---- Click on map → select destination ----
  const interactiveLayerIds = useMemo(
    () => ["structure-fill-extrusion"],
    [],
  );

  const enableClickSelection = () => {
    setSelectionMode("destination");
    setSelectionMessage("📍 Tap any location on the map to set as destination");
  };

  const handleMapClick = useCallback(
    (event) => {
      // Click behaviour: any click on the map (feature or empty space) picks
      // the closest destination. Mirrors Mumbai Central — destination only.
      const f = event.features?.[0];
      let target = null;

      // 1. Direct feature hit by name match
      if (f?.properties?.name) {
        target = destinations.find((d) => d.name === f.properties.name);
      }
      // 2. Snap clicked coordinate to nearest destination (within 40m)
      if (!target) {
        const [lng, lat] = [event.lngLat.lng, event.lngLat.lat];
        target = pickClosestDestination(destinations, lng, lat, 40);
      }
      if (target) {
        setEndNode(target.id);
        setSelectionMode(null);
        setSelectionMessage(`✓ Destination: ${target.name}`);
        setTimeout(() => setSelectionMessage(null), 1800);
      } else if (selectionMode) {
        // Only show "no match" toast when the user explicitly enabled the picker.
        setSelectionMessage("⚠️ No destination found near that point");
        setTimeout(() => setSelectionMessage(null), 1800);
      }
    },
    [destinations, selectionMode],
  );

  // ---- Quick access ----
  const handleQuickAccessClick = (destName) => {
    const d = destinations.find((x) => x.name === destName);
    if (d) setEndNode(d.id);
  };

  const clearRoute = () => {
    setEndNode("");
    setSelectionMessage(null);
  };

  // ---- Kiosk marker coord ----
  const kioskNode = nav.graph.getNode(nav.kioskNodeId)?.data;

  const distanceM = activeRoute ? Math.round(activeRoute.distanceM) : 0;

  return (
    <div className="map-container">
      {/* Toggle button when panel hidden */}
      {!showPanel && (
        <button
          onClick={() => setShowPanel(true)}
          className="absolute top-4 left-4 z-10 bg-white p-3 rounded-lg shadow-xl hover:bg-gray-50 transition"
          style={{ border: "1px solid #DADCE0" }}
          title="Show Navigator"
        >
          <span className="text-2xl">🚉</span>
        </button>
      )}

      {/* Navigator Panel */}
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
              className="text-gray-500 hover:bg-gray-100 p-1 rounded transition"
              title="Hide Navigator"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          <div className="mb-3 text-xs text-gray-500">
            Marine Lines · Mumbai
          </div>

          {/* Selected locations preview */}
          {selectedDest && !activeRoute && (
            <div
              className="mb-4 p-3 bg-blue-50 rounded-lg"
              style={{ border: "1px solid #bfdbfe" }}
            >
              <div className="text-xs font-semibold text-blue-700 mb-2">
                Selected Locations:
              </div>
              <div className="flex items-start gap-2 mb-2">
                <span className="text-blue-600">🚶</span>
                <div>
                  <div className="text-xs font-semibold text-gray-700">Start:</div>
                  <div className="text-sm text-gray-800">Kiosk Screen</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-red-600">📍</span>
                <div>
                  <div className="text-xs font-semibold text-gray-700">
                    Destination:
                  </div>
                  <div className="text-sm text-gray-800">{selectedDest.name}</div>
                </div>
              </div>
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
                className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-100 text-gray-700 cursor-not-allowed"
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
                onChange={(v) => setEndNode(v)}
                placeholder="Select destination..."
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {}}
                disabled={!endNode}
                className="flex-1 bg-green-600 text-white py-2 px-4 rounded font-semibold hover:bg-green-700 transition"
                style={!endNode ? { background: "#9ca3af", cursor: "not-allowed" } : undefined}
              >
                Get Directions
              </button>
              {activeRoute && (
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
                    className="w-full bg-blue-400 text-white py-2 px-4 rounded font-semibold flex items-center justify-center gap-2"
                    style={{ cursor: "not-allowed" }}
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

          {/* Distance & Time card */}
          {activeRoute && distanceM > 0 && (
            <div
              className="mb-1 p-3 bg-blue-50 rounded-lg"
              style={{ border: "1px solid #DADCE0" }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs text-gray-500">Walking Distance</div>
                  <div className="text-2lg font-bold text-gray-800">
                    {distanceM} m
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Estimated Time</div>
                  <div className="text-2lg font-bold text-blue-600">
                    {Math.max(1, Math.ceil(distanceM / 1.4 / 60))} min
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Route Options */}
          {routes.length > 1 && (
            <div
              className="mb-3 mt-3 p-3 rounded-lg"
              style={{
                background: "linear-gradient(to right, #eef2ff, #faf5ff)",
                border: "1px solid #c7d2fe",
              }}
            >
              <div className="text-xs font-bold text-indigo-800 mb-2 flex items-center gap-2">
                <span>🔀</span>
                <span>Route Options ({routes.length} available)</span>
              </div>
              <div className="space-y-2">
                {routes.map((route, index) => (
                  <div
                    key={route.id}
                    className="w-full rounded-lg bg-white"
                    style={{
                      border:
                        selectedRouteIndex === index
                          ? "1px solid #4f46e5"
                          : "1px solid #e5e7eb",
                      boxShadow:
                        selectedRouteIndex === index
                          ? "0 4px 6px -1px rgba(0,0,0,0.1)"
                          : "none",
                    }}
                  >
                    <button
                      onClick={() => setSelectedRouteIndex(index)}
                      className={`w-full p-2 rounded-lg text-left transition ${
                        selectedRouteIndex === index
                          ? "bg-indigo-600 text-white"
                          : "bg-white text-gray-700 hover:bg-indigo-100"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-lg"
                            style={{
                              color:
                                selectedRouteIndex === index ? "#fff" : "#4f46e5",
                            }}
                          >
                            🚶
                          </span>
                          <div>
                            <div className="text-sm font-semibold">
                              {route.label}
                            </div>
                            <div
                              className="text-xs"
                              style={{
                                color:
                                  selectedRouteIndex === index
                                    ? "#c7d2fe"
                                    : "#6b7280",
                              }}
                            >
                              {Math.round(route.distanceM)}m · ~
                              {Math.max(1, Math.ceil(route.distanceM / 1.4 / 60))} min
                            </div>
                          </div>
                        </div>
                        {selectedRouteIndex === index && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{ background: "#fff", color: "#4f46e5" }}
                          >
                            Selected
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Up/Down vertical-circulation grid (when this card is selected) */}
                    {selectedRouteIndex === index && (
                      <div
                        className="px-2 pb-2 border-t"
                        style={{ borderTopColor: "#d1d5db" }}
                      >
                        <div className="pt-2">
                          <div className="flex gap-3">
                            <VerticalColumn
                              direction="up"
                              hasLift={route.vc.upLift}
                              hasEscalator={route.vc.upEscalator}
                              hasStairs={route.vc.upStairs}
                            />
                            <VerticalColumn
                              direction="down"
                              hasLift={route.vc.downLift}
                              hasEscalator={route.vc.downEscalator}
                              hasStairs={route.vc.downStairs}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Turn-by-Turn Directions */}
          {showDirections && activeRoute?.directions?.length > 0 && (
            <div className="border-t pt-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-800">
                  Turn-by-Turn Directions
                </h3>
                <button
                  onClick={() => setShowDirections(false)}
                  className="text-xs text-gray-500 hover:bg-gray-100 px-2 py-1 rounded transition"
                >
                  Hide
                </button>
              </div>
              <ol className="directions-list">
                {activeRoute.directions.map((step, idx) => (
                  <li
                    key={idx}
                    className={`direction-step direction-${step.type}`}
                  >
                    <div className="direction-step-index">{idx + 1}</div>
                    <div className="direction-step-icon" aria-hidden>
                      {stepIcon(step.type)}
                    </div>
                    <div className="direction-step-body">
                      <div className="direction-step-title">{step.title}</div>
                      {step.detail && (
                        <div className="direction-step-detail">
                          {step.detail}
                        </div>
                      )}
                      {step.distanceM != null && (
                        <div className="direction-step-distance">
                          {step.distanceM} m
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {!showDirections && activeRoute?.directions?.length > 0 && (
            <div className="border-t pt-3 mt-3">
              <button
                onClick={() => setShowDirections(true)}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded font-semibold hover:bg-blue-700 transition"
              >
                Show Turn-by-Turn Directions
              </button>
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
                  {QUICK_ACCESS.filter((q) =>
                    destinations.some((d) => d.name === q.name),
                  ).map((q) => (
                    <button
                      key={q.name}
                      onClick={() => handleQuickAccessClick(q.name)}
                      className={`text-xs py-2 px-2 rounded transition h-8 flex items-center justify-center text-center ${quickAccessClass(
                        q.color,
                      )}`}
                    >
                      Kiosk → {q.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selection Message Banner */}
      {selectionMessage && (
        <div
          className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-2xl max-w-md text-center text-sm font-semibold"
          style={{ background: "#4285F4" }}
        >
          {selectionMessage}
        </div>
      )}

      {/* Circular Navigation Pad */}
      <div className="map-control-pad">
        <div className="control-pad-container">
          <button
            className="control-btn control-up"
            onClick={() => handleMapPan("up")}
            title="Pan Up"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14l5-5 5 5z" />
            </svg>
          </button>
          <button
            className="control-btn control-right"
            onClick={() => handleMapPan("right")}
            title="Pan Right"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 7l5 5-5 5z" />
            </svg>
          </button>
          <button
            className="control-btn control-down"
            onClick={() => handleMapPan("down")}
            title="Pan Down"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>
          <button
            className="control-btn control-left"
            onClick={() => handleMapPan("left")}
            title="Pan Left"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 7l-5 5 5 5z" />
            </svg>
          </button>

          <div className="zoom-controls">
            <button
              className="zoom-btn zoom-in"
              onClick={() => handleZoom("in")}
              title="Zoom In"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <div className="zoom-divider"></div>
            <button
              className="zoom-btn zoom-out"
              onClick={() => handleZoom("out")}
              title="Zoom Out"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Reset Map View */}
      <button
        onClick={resetMapView}
        className={`reset-map-btn ${isResetting ? "is-resetting" : ""}`}
        title="Recentre Map"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </button>

      {/* Fullscreen Toggle */}
      <button
        onClick={toggleFullscreen}
        className="fullscreen-btn"
        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      >
        {isFullscreen ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v3a2 2 0 0 1-2 2H3" />
            <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
            <path d="M3 16h3a2 2 0 0 1 2 2v3" />
            <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        )}
      </button>

      {/* 2D/3D View Toggle */}
      <button
        onClick={toggle3DView}
        className="view-toggle-btn"
        title={is3DView ? "Switch to 2D View" : "Switch to 3D View"}
      >
        {is3DView ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        )}
      </button>

      {/* Base Map Selector Chips */}
      <div className="base-map-chips">
        {Object.keys(BASE_MAPS).map((name) => (
          <button
            key={name}
            onClick={(e) => {
              e.preventDefault();
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

      {/* Map */}
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW_STATE}
        style={{ width: "100%", height: "100%" }}
        mapStyle={BASE_MAPS[selectedBaseMap].url}
        minPitch={0}
        maxPitch={is3DView ? 85 : 0}
        minZoom={17}
        maxZoom={21}
        maxBounds={MARINE_LINES_BOUNDS}
        cursor={selectionMode ? "crosshair" : "grab"}
        interactiveLayerIds={interactiveLayerIds}
        onClick={handleMapClick}
        onMouseMove={(event) => {
          const f = event.features?.[0];
          if (f && f.properties?.name) {
            setHoverInfo({
              longitude: event.lngLat.lng,
              latitude: event.lngLat.lat,
              name: f.properties.name,
              type: f.properties.type,
              category: f.properties.category,
            });
          } else {
            setHoverInfo(null);
          }
        }}
      >
        {/* Surroundings mask — hides base-map tiles outside the station area
            while keeping the map fully pan/zoomable. */}
        <Source id="station-mask" type="geojson" data={STATION_MASK_FEATURE}>
          <Layer
            id="station-mask-fill"
            type="fill"
            paint={{
              "fill-color": "#f1f5f9",
              "fill-opacity": 1,
            }}
          />
          <Layer
            id="station-mask-edge"
            type="line"
            paint={{
              "line-color": "#cbd5e1",
              "line-width": 1.5,
              "line-opacity": 0.7,
            }}
          />
        </Source>

        {/* Background line-string network */}
        <Source id="lines-bg" type="geojson" data={lineStringsRaw}>
          <Layer
            id="lines-bg-line"
            type="line"
            paint={{
              "line-color": "#9CA3AF",
              "line-width": 2,
              "line-dasharray": [2, 1.5],
              "line-opacity": 0.55,
            }}
          />
        </Source>

        {/* Station structures (3D) */}
        <Source id="structures" type="geojson" data={processedStructures}>
          <Layer
            id="structure-fill-extrusion"
            type="fill-extrusion"
            paint={{
              "fill-extrusion-color": [
                "case",
                ["has", "color"],
                ["get", "color"],
                "#a3a3a3",
              ],
              "fill-extrusion-height": [
                "case",
                ["has", "height"],
                ["to-number", ["get", "height"]],
                2,
              ],
              "fill-extrusion-base": [
                "case",
                ["has", "base"],
                ["to-number", ["get", "base"]],
                0,
              ],
              "fill-extrusion-opacity": 0.92,
            }}
          />
          <Layer
            id="structure-outline"
            type="line"
            paint={{
              "line-color": "#374151",
              "line-width": 0.6,
              "line-opacity": 0.45,
            }}
          />
          {/* Important labels: Platforms (excl. coach) / FOBs / Flyovers /
              Booking Office / Toilets — always visible, bold. */}
          <Layer
            id="structure-label-important"
            type="symbol"
            filter={[
              "all",
              ["!=", ["coalesce", ["get", "name"], ""], ""],
              IS_IMPORTANT_LABEL,
            ]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "center",
              "text-offset": [
                "case",
                ["==", ["get", "name"], "Platform 2"],
                ["literal", [0, -1.6]],
                ["==", ["get", "name"], "Platform 3"],
                ["literal", [0, 1.6]],
                ["literal", [0, 0]],
              ],
              // Primary: Manrope Bold. MapLibre falls back per-glyph to the next
              // font in the list when a glyph isn't on the active glyphs server.
              "text-font": [
                "literal",
                ["Manrope Bold", "Open Sans Bold", "Arial Unicode MS Bold"],
              ],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
              "text-optional": false,
              "symbol-placement": "point",
            }}
            paint={{
              "text-color": "#1a1a1a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 3,
            }}
          />

          {/* Secondary labels: coaches / staircases / lifts / escalators /
              entries / exits — only appear when zoomed in close (≥ 19). */}
          <Layer
            id="structure-label-secondary"
            type="symbol"
            minzoom={19}
            filter={[
              "all",
              ["!=", ["coalesce", ["get", "name"], ""], ""],
              ["!", IS_IMPORTANT_LABEL],
            ]}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 10,
              "text-anchor": "center",
              "text-font": [
                "literal",
                ["Manrope Regular", "Open Sans Regular", "Arial Unicode MS Regular"],
              ],
              "text-allow-overlap": false,
              "text-optional": true,
              "symbol-placement": "point",
            }}
            paint={{
              "text-color": "#374151",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.5,
            }}
          />
        </Source>

        {/* Alternative (non-selected) routes — drawn first, beneath active */}
        <Source id="routes-alt" type="geojson" data={routesFC}>
          <Layer
            id="routes-alt-line"
            type="line"
            filter={["!", ["get", "isActive"]]}
            paint={{
              "line-color": ["get", "color"],
              "line-width": 4,
              "line-opacity": 0.55,
              "line-dasharray": [1, 0.8],
            }}
          />
        </Source>

        {/* Active route — multi-layer arrowed path (POC parity) */}
        {activeRouteFC && (
          <Source
            key={`route-${selectedRouteIndex}`}
            id="route-active"
            type="geojson"
            data={activeRouteFC}
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
              id="route-stripe"
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

        {/* Kiosk marker — pill style */}
        {kioskNode && (
          <Marker
            longitude={kioskNode.lng}
            latitude={kioskNode.lat}
            anchor="bottom"
          >
            <div className="custom-marker custom-marker-kiosk">📍 Kiosk</div>
          </Marker>
        )}

        {/* Destination marker — pill style with continuous pulsing ring */}
        {selectedDest && (
          <Marker
            longitude={selectedDest.lng}
            latitude={selectedDest.lat}
            anchor="bottom"
          >
            <div className="custom-marker custom-marker-dest">
              📍 {selectedDest.name}
            </div>
          </Marker>
        )}

        {/* Hover popup */}
        {hoverInfo && (
          <Popup
            longitude={hoverInfo.longitude}
            latitude={hoverInfo.latitude}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={12}
          >
            <div style={{ padding: "4px 8px", fontWeight: 600 }}>
              {hoverInfo.name}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickClosestDestination(destinations, lng, lat, maxDistanceM) {
  let best = null;
  let bestDist = Infinity;
  for (const d of destinations) {
    if (!d.nodeId) continue;
    const dist = haversine([lng, lat], [d.lng, d.lat]);
    if (dist < bestDist && dist <= maxDistanceM) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

function stepIcon(type) {
  switch (type) {
    case "start":
      return "📍";
    case "walk":
      return "🚶";
    case "turn-left":
      return "↰";
    case "turn-right":
      return "↱";
    case "turn-sharp-left":
      return "⇤";
    case "turn-sharp-right":
      return "⇥";
    case "stairs":
      return "🪜";
    case "lift":
      return "🛗";
    case "escalator":
      return "⬆️";
    case "arrive":
      return "🏁";
    default:
      return "•";
  }
}

function VerticalColumn({ direction, hasLift, hasEscalator, hasStairs }) {
  const arrow = direction === "up" ? "↑" : "↓";
  const label = direction === "up" ? "Up" : "Down";
  const Tile = ({ icon, name, present }) => (
    <div
      className="flex items-center justify-between p-2 rounded bg-white"
      style={{ border: "1px solid #d1d5db" }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-gray-700">{name}</span>
      </div>
      <div className="text-sm font-bold">
        {present ? (
          <span style={{ color: "#22c55e" }}>✓</span>
        ) : (
          <span style={{ color: "#dc2626" }}>✕</span>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex-1">
      <div className="text-xs font-bold mb-2 flex items-center gap-1 text-gray-800">
        <span className="text-sm">{arrow}</span>
        <span>{label}</span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Tile icon="🛗" name="Lift" present={hasLift} />
        <Tile icon="⬆️" name="Esc" present={hasEscalator} />
        <Tile icon="🪜" name="Stair" present={hasStairs} />
      </div>
    </div>
  );
}

function quickAccessClass(color) {
  switch (color) {
    case "purple":
      return "bg-purple-100 text-purple-700 hover:bg-purple-100";
    case "indigo":
      return "bg-indigo-100 text-indigo-700 hover:bg-indigo-200";
    case "teal":
      return "bg-teal-100 text-teal-700 hover:bg-teal-200";
    case "cyan":
      return "bg-cyan-100 text-cyan-700 hover:bg-cyan-100";
    default:
      return "bg-gray-100 text-gray-700 hover:bg-gray-200";
  }
}
