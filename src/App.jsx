import React, { useState, useRef, useEffect, useCallback } from "react";
import Map, {
  Source,
  Layer,
  Popup,
  NavigationControl,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import "./App.css";

const INITIAL_VIEW_STATE = {
  longitude: 78.9,
  latitude: 22,
  zoom: 4.2,
  pitch: 0,
  bearing: 0,
};

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

// Color palette for loaded GeoJSON layers
const LAYER_COLORS = [
  "#4285F4", // Blue
  "#EA4335", // Red
  "#34A853", // Green
  "#FBBC05", // Yellow
  "#FF6D01", // Orange
  "#46BDC6", // Teal
  "#7B1FA2", // Purple
  "#E91E63", // Pink
  "#00BCD4", // Cyan
  "#8BC34A", // Light Green
  "#FF5722", // Deep Orange
  "#607D8B", // Blue Grey
  "#9C27B0", // Deep Purple
  "#3F51B5", // Indigo
  "#009688", // Teal Dark
];

let layerIdCounter = 0;

export default function App() {
  const mapRef = useRef(null);
  const fileInputRef = useRef(null);

  const [showPanel, setShowPanel] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedBaseMap, setSelectedBaseMap] = useState("OpenStreetMap");
  const [is3DView, setIs3DView] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);

  // GeoJSON layers state
  const [geoJSONLayers, setGeoJSONLayers] = useState([]);
  const [geoJSONInput, setGeoJSONInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [layerName, setLayerName] = useState("");

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Calculate bounds of a FeatureCollection and fly to it
  const flyToBounds = useCallback((featureCollection) => {
    if (!mapRef.current) return;

    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;

    const processCoords = (coords) => {
      if (typeof coords[0] === "number") {
        minLng = Math.min(minLng, coords[0]);
        maxLng = Math.max(maxLng, coords[0]);
        minLat = Math.min(minLat, coords[1]);
        maxLat = Math.max(maxLat, coords[1]);
      } else {
        coords.forEach(processCoords);
      }
    };

    featureCollection.features.forEach((feature) => {
      if (feature.geometry && feature.geometry.coordinates) {
        processCoords(feature.geometry.coordinates);
      }
    });

    if (
      minLng === Infinity ||
      minLat === Infinity ||
      maxLng === -Infinity ||
      maxLat === -Infinity
    ) {
      return;
    }

    const map = mapRef.current.getMap();
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: 60,
        duration: 1000,
        maxZoom: 18,
      },
    );
  }, []);

  // Parse and validate GeoJSON, then add as a layer
  const addGeoJSONLayer = useCallback(() => {
    setInputError("");

    if (!geoJSONInput.trim()) {
      setInputError("Please paste GeoJSON data.");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(geoJSONInput.trim());
    } catch (e) {
      setInputError("Invalid JSON. Please check your input.");
      return;
    }

    if (!parsed.type) {
      setInputError('Invalid GeoJSON: missing "type" property.');
      return;
    }

    // Normalize to FeatureCollection
    let featureCollection;
    if (parsed.type === "FeatureCollection") {
      featureCollection = parsed;
    } else if (parsed.type === "Feature") {
      featureCollection = {
        type: "FeatureCollection",
        features: [parsed],
      };
    } else if (
      [
        "Point",
        "MultiPoint",
        "LineString",
        "MultiLineString",
        "Polygon",
        "MultiPolygon",
        "GeometryCollection",
      ].includes(parsed.type)
    ) {
      featureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: parsed,
          },
        ],
      };
    } else {
      setInputError(`Unsupported GeoJSON type: "${parsed.type}".`);
      return;
    }

    if (
      !featureCollection.features ||
      featureCollection.features.length === 0
    ) {
      setInputError("GeoJSON contains no features.");
      return;
    }

    const validFeatures = featureCollection.features.filter(
      (f) => f && f.geometry && f.geometry.type && f.geometry.coordinates,
    );
    if (validFeatures.length === 0) {
      setInputError("No valid features with geometry found.");
      return;
    }
    featureCollection.features = validFeatures;

    const geometryTypes = new Set(validFeatures.map((f) => f.geometry.type));

    const colorIndex = geoJSONLayers.length % LAYER_COLORS.length;
    const color = LAYER_COLORS[colorIndex];
    const id = `geojson-layer-${++layerIdCounter}`;
    const name = layerName.trim() || `Layer ${geoJSONLayers.length + 1}`;

    const newLayer = {
      id,
      name,
      color,
      data: featureCollection,
      visible: true,
      geometryTypes: Array.from(geometryTypes),
      featureCount: validFeatures.length,
    };

    setGeoJSONLayers((prev) => [...prev, newLayer]);
    setGeoJSONInput("");
    setLayerName("");

    // Auto-enable 3D view when polygons are loaded so extrusions are visible
    const hasPolygons = Array.from(geometryTypes).some(
      (t) => t === "Polygon" || t === "MultiPolygon",
    );
    if (hasPolygons && !is3DView) {
      setIs3DView(true);
      const map = mapRef.current?.getMap();
      if (map) {
        map.easeTo({ pitch: 45, duration: 1000 });
      }
    }

    flyToBounds(featureCollection);
  }, [geoJSONInput, geoJSONLayers, layerName, flyToBounds, is3DView]);

  // Handle file upload
  const handleFileUpload = useCallback(
    (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        setGeoJSONInput(e.target.result);
        const fname = file.name.replace(/\.(geo)?json$/i, "");
        if (!layerName.trim()) {
          setLayerName(fname);
        }
      };
      reader.onerror = () => {
        setInputError("Failed to read file.");
      };
      reader.readAsText(file);
      event.target.value = "";
    },
    [layerName],
  );

  const removeLayer = useCallback((layerId) => {
    setGeoJSONLayers((prev) => prev.filter((l) => l.id !== layerId));
  }, []);

  const toggleLayerVisibility = useCallback((layerId) => {
    setGeoJSONLayers((prev) =>
      prev.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l)),
    );
  }, []);

  const clearAllLayers = useCallback(() => {
    setGeoJSONLayers([]);
  }, []);

  const flyToLayer = useCallback(
    (layerId) => {
      const layer = geoJSONLayers.find((l) => l.id === layerId);
      if (layer) {
        flyToBounds(layer.data);
      }
    },
    [geoJSONLayers, flyToBounds],
  );

  // Map control handlers
  const handleMapPan = (direction) => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const panAmount = 100;
    switch (direction) {
      case "up":
        map.panBy([0, -panAmount], { duration: 300 });
        break;
      case "down":
        map.panBy([0, panAmount], { duration: 300 });
        break;
      case "left":
        map.panBy([-panAmount, 0], { duration: 300 });
        break;
      case "right":
        map.panBy([panAmount, 0], { duration: 300 });
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

    if (geoJSONLayers.length > 0) {
      const allFeatures = geoJSONLayers.flatMap((l) => l.data.features);
      flyToBounds({ features: allFeatures });
    } else {
      map.flyTo({
        center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
        zoom: INITIAL_VIEW_STATE.zoom,
        pitch: 0,
        bearing: 0,
        duration: 1000,
        essential: true,
      });
    }
    setTimeout(() => setIsResetting(false), 1000);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch((err) => console.error("Error enabling fullscreen:", err));
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch((err) => console.error("Error exiting fullscreen:", err));
    }
  };

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

  // Build interactive layer IDs for hover
  const interactiveLayerIds = geoJSONLayers
    .filter((l) => l.visible)
    .flatMap((l) => [`${l.id}-fill`, `${l.id}-line`, `${l.id}-circle`]);

  return (
    <div className="map-container">
      {/* Toggle Panel Button */}
      {!showPanel && (
        <button
          onClick={() => setShowPanel(true)}
          className="panel-toggle-btn"
          title="Show GeoJSON Loader"
        >
          <span style={{ fontSize: "1.5rem" }}>🗺️</span>
        </button>
      )}

      {/* GeoJSON Loader Panel */}
      {showPanel && (
        <div className="loader-panel">
          {/* Header */}
          <div className="panel-header">
            <h2 className="panel-title">🗺️ GeoJSON Loader</h2>
            <button
              onClick={() => setShowPanel(false)}
              className="panel-close-btn"
              title="Hide Panel"
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

          {/* Layer Name */}
          <div className="input-group">
            <label className="input-label">Layer Name (optional)</label>
            <input
              type="text"
              value={layerName}
              onChange={(e) => setLayerName(e.target.value)}
              placeholder={`Layer ${geoJSONLayers.length + 1}`}
              className="text-input"
            />
          </div>

          {/* GeoJSON Input */}
          <div className="input-group">
            <label className="input-label">GeoJSON Data</label>
            <textarea
              value={geoJSONInput}
              onChange={(e) => {
                setGeoJSONInput(e.target.value);
                setInputError("");
              }}
              placeholder="Paste GeoJSON here!
              
(Feature, FeatureCollection, or raw geometry like LineString, Polygon, Point, etc.)"
              className="geojson-textarea"
              rows={6}
            />
          </div>

          {/* Error */}
          {inputError && <div className="error-message">⚠️ {inputError}</div>}

          {/* Action Buttons */}
          <div className="action-buttons">
            <button onClick={addGeoJSONLayer} className="btn btn-primary">
              十 Add Layer
            </button>
            <label className="btn btn-success file-upload-label">
              📁 Upload File
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.geojson,.txt,.docx"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
            </label>
          </div>

          {/* Quick Samples */}
          <div className="samples-section">
            <div className="samples-heading">Quick Samples:</div>
            <div className="samples-grid">
              <button
                onClick={() => {
                  setLayerName("Sample Polygon");
                  setGeoJSONInput(
                    JSON.stringify(
                      {
                        type: "Feature",
                        properties: { name: "Sample Polygon" },
                        geometry: {
                          type: "Polygon",
                          coordinates: [
                            [
                              [72.8777, 19.076],
                              [72.8797, 19.076],
                              [72.8797, 19.078],
                              [72.8777, 19.078],
                              [72.8777, 19.076],
                            ],
                          ],
                        },
                      },
                      null,
                      2,
                    ),
                  );
                }}
                className="sample-btn sample-polygon"
              >
                Polygon
              </button>
              <button
                onClick={() => {
                  setLayerName("Sample LineString");
                  setGeoJSONInput(
                    JSON.stringify(
                      {
                        type: "Feature",
                        properties: { name: "Sample Line" },
                        geometry: {
                          type: "LineString",
                          coordinates: [
                            [72.8777, 19.075],
                            [72.8787, 19.076],
                            [72.8797, 19.0755],
                            [72.8807, 19.077],
                          ],
                        },
                      },
                      null,
                      2,
                    ),
                  );
                }}
                className="sample-btn sample-line"
              >
                LineString
              </button>
              <button
                onClick={() => {
                  setLayerName("Sample Points");
                  setGeoJSONInput(
                    JSON.stringify(
                      {
                        type: "FeatureCollection",
                        features: [
                          {
                            type: "Feature",
                            properties: { name: "Point A" },
                            geometry: {
                              type: "Point",
                              coordinates: [72.8777, 19.076],
                            },
                          },
                          {
                            type: "Feature",
                            properties: { name: "Point B" },
                            geometry: {
                              type: "Point",
                              coordinates: [72.8797, 19.078],
                            },
                          },
                          {
                            type: "Feature",
                            properties: { name: "Point C" },
                            geometry: {
                              type: "Point",
                              coordinates: [72.8817, 19.077],
                            },
                          },
                        ],
                      },
                      null,
                      2,
                    ),
                  );
                }}
                className="sample-btn sample-points"
              >
                Points
              </button>
              <button
                onClick={() => {
                  setLayerName("Mixed Features");
                  setGeoJSONInput(
                    JSON.stringify(
                      {
                        type: "FeatureCollection",
                        features: [
                          {
                            type: "Feature",
                            properties: { name: "Zone A" },
                            geometry: {
                              type: "Polygon",
                              coordinates: [
                                [
                                  [72.875, 19.076],
                                  [72.877, 19.076],
                                  [72.877, 19.0775],
                                  [72.875, 19.0775],
                                  [72.875, 19.076],
                                ],
                              ],
                            },
                          },
                          {
                            type: "Feature",
                            properties: { name: "Connector" },
                            geometry: {
                              type: "LineString",
                              coordinates: [
                                [72.877, 19.0768],
                                [72.878, 19.077],
                                [72.879, 19.0765],
                              ],
                            },
                          },
                          {
                            type: "Feature",
                            properties: { name: "Checkpoint" },
                            geometry: {
                              type: "Point",
                              coordinates: [72.879, 19.0765],
                            },
                          },
                        ],
                      },
                      null,
                      2,
                    ),
                  );
                }}
                className="sample-btn sample-mixed"
              >
                Mixed
              </button>
            </div>
          </div>

          {/* Loaded Layers List */}
          {geoJSONLayers.length > 0 && (
            <div className="layers-section">
              <div className="layers-header">
                <h3 className="layers-title">
                  Loaded Layers ({geoJSONLayers.length})
                </h3>
                <button onClick={clearAllLayers} className="clear-all-btn">
                  Clear All
                </button>
              </div>
              <div className="layers-list">
                {geoJSONLayers.map((layer) => (
                  <div
                    key={layer.id}
                    className={`layer-card ${!layer.visible ? "layer-hidden" : ""}`}
                  >
                    <div className="layer-info">
                      <div
                        className="layer-color-dot"
                        style={{ backgroundColor: layer.color }}
                      />
                      <div className="layer-text">
                        <div className="layer-name">{layer.name}</div>
                        <div className="layer-meta">
                          {layer.featureCount} feature
                          {layer.featureCount !== 1 ? "s" : ""} •{" "}
                          {layer.geometryTypes.join(", ")}
                        </div>
                      </div>
                    </div>
                    <div className="layer-actions">
                      <button
                        onClick={() => flyToLayer(layer.id)}
                        className="layer-action-btn"
                        title="Zoom to layer"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#4285F4"
                          strokeWidth="2"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <path d="M21 21l-4.35-4.35" />
                        </svg>
                      </button>
                      <button
                        onClick={() => toggleLayerVisibility(layer.id)}
                        className="layer-action-btn"
                        title={layer.visible ? "Hide layer" : "Show layer"}
                      >
                        {layer.visible ? (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#666"
                            strokeWidth="2"
                          >
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        ) : (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#999"
                            strokeWidth="2"
                          >
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={() => removeLayer(layer.id)}
                        className="layer-action-btn"
                        title="Remove layer"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#EA4335"
                          strokeWidth="2"
                        >
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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

      {/* Reset Map View */}
      <button
        onClick={resetMapView}
        className={`reset-map-btn ${isResetting ? "is-resetting" : ""}`}
        title="Reset Map View"
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

      {/* Fullscreen */}
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

      {/* 2D/3D Toggle */}
      <button
        onClick={toggle3DView}
        className="view-toggle-btn"
        title={is3DView ? "Switch to 2D View" : "Switch to 3D View"}
      >
        {is3DView ? (
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

      {/* Base Map Chips */}
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
            className={`base-map-chip ${selectedBaseMap === name ? "active" : ""}`}
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
        onMouseMove={(event) => {
          const feature = event.features && event.features[0];
          if (feature && feature.properties) {
            const name =
              feature.properties.name ||
              feature.properties.title ||
              feature.properties.id ||
              feature.properties.description;
            if (name) {
              setHoverInfo({
                longitude: event.lngLat.lng,
                latitude: event.lngLat.lat,
                properties: feature.properties,
                name,
              });
            } else {
              setHoverInfo(null);
            }
          } else {
            setHoverInfo(null);
          }
        }}
        interactiveLayerIds={interactiveLayerIds}
      >
        <NavigationControl position="bottom-right" />

        {/* Render each GeoJSON layer */}
        {geoJSONLayers
          .filter((layer) => layer.visible)
          .map((layer) => (
            <Source
              key={layer.id}
              id={layer.id}
              type="geojson"
              data={layer.data}
            >
              {/* Polygon 3D extrusion - lifted from the ground */}
              <Layer
                id={`${layer.id}-fill`}
                type="fill-extrusion"
                filter={[
                  "any",
                  ["==", ["geometry-type"], "Polygon"],
                  ["==", ["geometry-type"], "MultiPolygon"],
                ]}
                paint={{
                  "fill-extrusion-color": layer.color,
                  "fill-extrusion-height": 30,
                  "fill-extrusion-base": 0,
                  "fill-extrusion-opacity": 0.7,
                }}
              />
              {/* Polygon outline at ground level */}
              <Layer
                id={`${layer.id}-fill-outline`}
                type="line"
                filter={[
                  "any",
                  ["==", ["geometry-type"], "Polygon"],
                  ["==", ["geometry-type"], "MultiPolygon"],
                ]}
                paint={{
                  "line-color": layer.color,
                  "line-width": 2,
                  "line-opacity": 0.8,
                }}
              />
              {/* LineString - lifted slightly */}
              <Layer
                id={`${layer.id}-line`}
                type="line"
                filter={[
                  "any",
                  ["==", ["geometry-type"], "LineString"],
                  ["==", ["geometry-type"], "MultiLineString"],
                ]}
                paint={{
                  "line-color": layer.color,
                  "line-width": 4,
                  "line-opacity": 0.9,
                  "line-translate": [0, -8],
                  "line-translate-anchor": "viewport",
                }}
              />
              {/* LineString shadow/ground reference */}
              <Layer
                id={`${layer.id}-line-shadow`}
                type="line"
                filter={[
                  "any",
                  ["==", ["geometry-type"], "LineString"],
                  ["==", ["geometry-type"], "MultiLineString"],
                ]}
                paint={{
                  "line-color": layer.color,
                  "line-width": 6,
                  "line-opacity": 0.15,
                }}
              />
              {/* Point - lifted slightly (less than lines) */}
              <Layer
                id={`${layer.id}-circle`}
                type="circle"
                filter={[
                  "any",
                  ["==", ["geometry-type"], "Point"],
                  ["==", ["geometry-type"], "MultiPoint"],
                ]}
                paint={{
                  "circle-color": layer.color,
                  "circle-radius": 8,
                  "circle-stroke-color": "#fff",
                  "circle-stroke-width": 2.5,
                  "circle-opacity": 0.9,
                  "circle-translate": [0, -4],
                  "circle-translate-anchor": "viewport",
                }}
              />
              {/* Point shadow on ground */}
              <Layer
                id={`${layer.id}-circle-shadow`}
                type="circle"
                filter={[
                  "any",
                  ["==", ["geometry-type"], "Point"],
                  ["==", ["geometry-type"], "MultiPoint"],
                ]}
                paint={{
                  "circle-color": layer.color,
                  "circle-radius": 10,
                  "circle-opacity": 0.15,
                  "circle-blur": 1,
                }}
              />
              {/* Labels for points */}
              <Layer
                id={`${layer.id}-label`}
                type="symbol"
                filter={[
                  "any",
                  ["==", ["geometry-type"], "Point"],
                  ["==", ["geometry-type"], "MultiPoint"],
                ]}
                layout={{
                  "text-field": [
                    "coalesce",
                    ["get", "name"],
                    ["get", "title"],
                    "",
                  ],
                  "text-size": 11,
                  "text-anchor": "top",
                  "text-offset": [0, 1],
                  "text-optional": true,
                }}
                paint={{
                  "text-color": "#333",
                  "text-halo-color": "#fff",
                  "text-halo-width": 1.5,
                }}
              />
            </Source>
          ))}

        {/* Hover Popup */}
        {hoverInfo && (
          <Popup
            longitude={hoverInfo.longitude}
            latitude={hoverInfo.latitude}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={[0, -10]}
          >
            <div className="popup-content">
              <div className="popup-name">{hoverInfo.name}</div>
              {hoverInfo.properties &&
                Object.entries(hoverInfo.properties)
                  .filter(
                    ([key]) =>
                      !["name", "title", "id"].includes(key) &&
                      typeof hoverInfo.properties[key] !== "object",
                  )
                  .slice(0, 4)
                  .map(([key, value]) => (
                    <div key={key} className="popup-prop">
                      <span className="popup-prop-key">{key}:</span>{" "}
                      {String(value)}
                    </div>
                  ))}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
