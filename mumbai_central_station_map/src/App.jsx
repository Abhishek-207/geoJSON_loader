import React, { useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Source, Popup } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import structuresRaw from "./data/structures.json";
import { processStructures } from "./utils/structureProcessor";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Center of Mumbai Central Station — derived from the bounding box of every
// polygon in the source GeoJSON. Default bearing rotates the camera by 270°
// (90° from earlier + another 180°) so the station's long N-S axis lies
// horizontally on screen with north pointing to the right.
const INITIAL_VIEW_STATE = {
  longitude: 72.81960,
  latitude: 18.97192,
  zoom: 18,
  pitch: 45,
  bearing: 270,
};

// Soft camera lock — ~300m breathing room on most sides, with extra slack on
// the east (PRS / Ticket Booking Office) side so panning toward those
// amenities doesn't hit the wall.
const MUMBAI_CENTRAL_BOUNDS = [
  72.81534, // West  (~330m beyond footprint)
  18.96631, // South (~315m beyond footprint)
  72.82465, // East  (~400m beyond footprint — PRS Office side)
  18.97748, // North (~310m beyond footprint)
];

// Station footprint (snug). Used as the inner ring of the surroundings mask —
// everything outside this rectangle is painted over so the map stays focused
// on the station.
const STATION_BBOX = {
  west: 72.81834,
  south: 18.96916,
  east: 72.82085,
  north: 18.97468,
};

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

// MapLibre expression: true when a feature's name represents an important
// station landmark — Platforms, FOBs, Booking Office, Toilets, Lifts, Entries,
// Exits, plus the named Mumbai Central buildings (Dispensary, Police Station,
// Dormetry, Restroom, Washroom, Urban Pod). These render in bold + larger +
// pure black so they stand out against the regular coach/staircase labels.
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
  ["in", "lift", NAME_LC],
  ["in", "entry", NAME_LC],
  ["in", "exit", NAME_LC],
  ["in", "dispensary", NAME_LC],
  ["in", "police", NAME_LC],
  ["in", "dormetry", NAME_LC],
  ["in", "dormitory", NAME_LC],
  ["in", "restroom", NAME_LC],
  ["in", "washroom", NAME_LC],
  ["in", "urban pod", NAME_LC],
];

// Bilingual map legend. Each row binds an item type to:
//   • icon  — emoji shown inside the color chip
//   • color — the fill color used for that type on the 3D map, so the user
//             can match the legend swatch to the polygon on screen
//   • en/hi — English + Hindi labels
const LEGEND_ITEMS = [
  { en: "Platform",              hi: "प्लेटफार्म",            icon: "🚉", color: "#b0b0b0" },
  { en: "Foot Overbridge (FOB)", hi: "पैदल पुल",                icon: "🌉", color: "#59717d" },
  { en: "Staircase",             hi: "सीढ़ी",                   icon: "🪜", color: "#089c8d" },
  { en: "Escalator",             hi: "एस्केलेटर",              icon: "⤴",  color: "#006400" },
  { en: "Lift / Elevator",       hi: "लिफ्ट / उद्वाहक",         icon: "🛗", color: "#4169E1" },
  { en: "Train Coach",           hi: "रेल कोच",                 icon: "🚃", color: "#9E9E9E" },
  { en: "Entry",                 hi: "प्रवेश",                   icon: "➡",  color: "#43A047" },
  { en: "Exit",                  hi: "निकास",                    icon: "🚪", color: "#E53935" },
  { en: "Booking Office (PRS)",  hi: "बुकिंग कार्यालय",         icon: "🎫", color: "#d9d0c9" },
  { en: "Mumbai Central Building", hi: "मुख्य भवन",             icon: "🏢", color: "#ededed" },
  { en: "Passenger Facilitation", hi: "यात्री सुविधा केंद्र",    icon: "ℹ",  color: "#ededed" },
  { en: "Waiting Area / Hall",   hi: "प्रतीक्षा कक्ष",          icon: "💺", color: "#4CAF50" },
  { en: "Taxi Stand",            hi: "टैक्सी स्टैंड",            icon: "🚖", color: "#4CAF50" },
  { en: "Car Parking",           hi: "कार पार्किंग",            icon: "🅿",  color: "#4CAF50" },
  { en: "Two Wheeler Parking",   hi: "दोपहिया पार्किंग",        icon: "🛵", color: "#4CAF50" },
  { en: "Parcel Office",         hi: "पार्सल कार्यालय",         icon: "📦", color: "#4CAF50" },
  { en: "Sky Walk",              hi: "स्काई वॉक",                icon: "🚶", color: "#9C27B0" },
  { en: "Ramp",                  hi: "रैंप",                     icon: "♿", color: "#FF9800" },
  { en: "Stall",                 hi: "स्टॉल",                    icon: "🛍", color: "#4CAF50" },
  { en: "Dispensary",            hi: "औषधालय",                  icon: "⚕",  color: "#C62828" },
  { en: "Police (RPF / GRP)",    hi: "आर.पी.एफ / जी.आर.पी",    icon: "👮", color: "#1565C0" },
  { en: "Dormitory",             hi: "विश्रामगृह",              icon: "🛏", color: "#EF6C00" },
  { en: "Restroom",              hi: "विश्राम कक्ष",            icon: "🛌", color: "#6A1B9A" },
  { en: "Washroom",              hi: "शौचालय",                  icon: "🚻", color: "#4CAF50" },
  { en: "Urban Pod",             hi: "अर्बन पॉड",                icon: "🏨", color: "#4CAF50" },
  { en: "WH Smith Shop",         hi: "डब्ल्यू एच स्मिथ दुकान",   icon: "🛒", color: "#4CAF50" },
];

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const mapRef = useRef(null);

  const processedStructures = useMemo(
    () => processStructures(structuresRaw).processed,
    [],
  );

  const [hoverInfo, setHoverInfo] = useState(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedBaseMap, setSelectedBaseMap] = useState("OpenStreetMap");
  const [is3DView, setIs3DView] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(true);

  // ---- Map controls ----
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

  return (
    <div className="map-container">
      {/* Station title pill */}
      <div className="station-title">
        <span className="station-title-icon">🚉</span>
        <div>
          <div className="station-title-name">Mumbai Central</div>
          <div className="station-title-sub">Mumbai · BCT</div>
        </div>
      </div>

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

      {/* Map Legend (bottom-right, collapsible) */}
      {isLegendOpen ? (
        <div className="map-legend">
          <div className="map-legend-header">
            <div className="map-legend-title">
              <span className="map-legend-title-en">Map Legend</span>
              <span className="map-legend-title-hi">मानचित्र संकेत</span>
            </div>
            <button
              className="map-legend-close"
              onClick={() => setIsLegendOpen(false)}
              title="Hide Legend"
              aria-label="Hide Legend"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
          <div className="map-legend-body">
            {LEGEND_ITEMS.map((item) => (
              <div key={item.en} className="map-legend-item">
                <div
                  className="map-legend-swatch"
                  style={{ background: item.color }}
                  aria-hidden
                >
                  <span className="map-legend-icon">{item.icon}</span>
                </div>
                <div className="map-legend-labels">
                  <div className="map-legend-en">{item.en}</div>
                  <div className="map-legend-hi">{item.hi}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          className="map-legend-fab"
          onClick={() => setIsLegendOpen(true)}
          title="Show Legend"
          aria-label="Show Legend"
        >
          <svg
            className="map-legend-fab-icon"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            {/* Three legend rows: colored square + line, matching the panel design */}
            <rect x="3" y="5"  width="4" height="4" rx="1" fill="#4285F4" />
            <rect x="3" y="11" width="4" height="4" rx="1" fill="#34A853" />
            <rect x="3" y="17" width="4" height="4" rx="1" fill="#EA4335" />
            <rect x="10" y="6"  width="11" height="2" rx="1" fill="#5f6368" />
            <rect x="10" y="12" width="11" height="2" rx="1" fill="#5f6368" />
            <rect x="10" y="18" width="11" height="2" rx="1" fill="#5f6368" />
          </svg>
          <span className="map-legend-fab-label">Legend</span>
        </button>
      )}

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
        minZoom={15}
        maxZoom={21}
        maxBounds={MUMBAI_CENTRAL_BOUNDS}
        interactiveLayerIds={["structure-fill-extrusion"]}
        onMouseMove={(event) => {
          const f = event.features?.[0];
          if (f && f.properties?.name) {
            // Don't show the hover popup for individual stair-step /
            // escalator-step polygons — they're rendering artifacts of the
            // stepped extrusion, not real destinations.
            if (
              f.properties.isStairStep ||
              f.properties.isEscalatorStep
            ) {
              setHoverInfo(null);
              return;
            }
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
          {/* Important labels: Platforms (excl. coach) / FOBs / Booking Office
              / Toilets / Lifts / Entries / Exits / named buildings — always
              visible, bold black. */}
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

          {/* Secondary labels: coaches / staircases / stalls / etc. — only
              appear when zoomed in close. */}
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
