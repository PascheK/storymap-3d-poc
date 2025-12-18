"use client";

import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const TILESET_URL = "mapbox://paschek7.khartoum_buildings_v1";
const SOURCE_ID = "khartoum";
const SOURCE_LAYER = "buildings";
const LAYER_ID = "khartoum-3d";

// Tu peux ajuster (tes heights semblent petites dans l'échantillon)
const HEIGHT_SCALE = 1;

const CATEGORIES = [
  "building",
  "education",
  "health",
  "power",
  "waste",
  "water",
];

const STATUSES = ["damaged", "undamaged", "unknown"];

export default function KhartoumBuildingsMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Pour hover highlight
  const hoveredIdRef = useRef<number | null>(null);
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [selectedCategories, setSelectedCategories] = React.useState<
    Set<string>
  >(new Set(CATEGORIES));
  const [selectedStatuses, setSelectedStatuses] = React.useState<Set<string>>(
    new Set(STATUSES)
  );
  const [showFilterPanel, setShowFilterPanel] = React.useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return; // évite double init en dev

    if (!mapboxgl.accessToken) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_TOKEN");
      return;
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/standard-satellite",
      config: {
        basemap: {
          showPedestrianRoads: false,
          show3dObjects: true,
          showPlaceLabels: false,
          showPointOfInterestLabels: false,
          showRoadLabels: false,
          showTransitLabels: false,
          showAdminBoundaries: false,
          showLandmarkIconLabels: false,
        },
      },
      zoom: 18,
      center: [32.55, 15.51666667],
      pitch: 60,
      antialias: true,
    });

    mapRef.current = map;

    const setCursorPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const resetCursor = () => {
      map.getCanvas().style.cursor = "";
    };

    const clearHoverState = () => {
      const prev = hoveredIdRef.current;
      if (prev !== null) {
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: prev },
          { hover: false }
        );
        hoveredIdRef.current = null;
      }
    };

    map.on("load", () => {
      // Source: tileset Mapbox
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "vector",
          url: TILESET_URL,
        });
      }

      // Layer 3D
      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
          id: LAYER_ID,
          type: "fill-extrusion",
          source: SOURCE_ID,
          "source-layer": SOURCE_LAYER,
          minzoom: 13,
          paint: {
            // Couleur: hover -> blanc, sinon selon status
            "fill-extrusion-color": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              "#95a5a6",
              [
                "match",
                ["get", "tor_category"],

                // Building
                "building",
                [
                  "match",
                  ["get", "status"],
                  "damaged",
                  "#ff2f00", // red
                  "undamaged",
                  "#ffffff", // white
                  "unknown",
                  "#ededed", // light gray
                  "#ededed",
                ],

                // Education
                "education",
                [
                  "match",
                  ["get", "status"],
                  "damaged",
                  "#00a83c", // green damaged
                  "undamaged",
                  "#00d24d", // light green undamaged
                  "#00d24d",
                ],

                // Health
                "health",
                [
                  "match",
                  ["get", "status"],
                  "damaged",
                  "#ff7f00", // orange damaged
                  "undamaged",
                  "#ffd200", // yellow undamaged
                  "#ffd200",
                ],

                // Power
                "power",
                [
                  "match",
                  ["get", "status"],
                  "damaged",
                  "#ff9900", // orange damaged
                  "undamaged",
                  "#ffd640", // yellow undamaged
                  "#ffd640",
                ],

                // Waste
                "waste",
                "#b0724f", // brown undamaged (only state shown)

                // Water
                "water",
                [
                  "match",
                  ["get", "status"],
                  "damaged",
                  "#00b7ff", // cyan damaged
                  "undamaged",
                  "#0099ff", // cyan undamaged
                  "#0099ff",
                ],

                /* default */ "#95a5a6",
              ],
            ],

            // Hauteur 3D
            "fill-extrusion-height": [
              "*",
              ["to-number", ["coalesce", ["get", "height"], 0]],
              HEIGHT_SCALE,
            ],

            // Base (si tu as un champ baseHeight un jour, tu peux le mettre ici)
            "fill-extrusion-base": 0,

            "fill-extrusion-opacity": 1,
          },
        });
      }

      // Interactions
      map.on("mouseenter", LAYER_ID, setCursorPointer);
      map.on("mouseleave", LAYER_ID, () => {
        resetCursor();
        clearHoverState();
      });

      map.on("mousemove", LAYER_ID, (e) => {
        const f = e.features?.[0];
        if (!f) return;

        // NOTE: l'id vient de la recipe (features.id = OBJECTID)
        const id = Number(f.id);
        if (!Number.isFinite(id)) return;

        const prev = hoveredIdRef.current;
        if (prev !== null && prev !== id) {
          map.setFeatureState(
            { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: prev },
            { hover: false }
          );
        }

        hoveredIdRef.current = id;
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id },
          { hover: true }
        );
      });

      map.on("click", LAYER_ID, (e) => {
        const f = e.features?.[0];
        console.log(f);
        if (!f) return;

        const p = (f.properties || {}) as Record<string, unknown>;
        const objectId = p.OBJECTID ?? f.id ?? "—";
        const status = p.status ?? "—";
        const category = p.tor_category ?? "—";
        const height = p.height ?? "—";

        new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
          .setLngLat(e.lngLat)
          .setHTML(
            `
            <div class="building-popup">
              <div class="building-popup-title">Building</div>
              <div class="building-popup-row"><span class="building-popup-label">OBJECTID:</span> ${objectId}</div>
              <div class="building-popup-row"><span class="building-popup-label">Status:</span> ${status}</div>     
              <div class="building-popup-row"><span class="building-popup-label">Height:</span> ${height}</div>
              <div class="building-popup-row"><span class="building-popup-label">Category:</span> ${category}</div>
            </div>
          `
          )
          .addTo(map);
      });
    });

    // Controls (optionnel)
    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      "top-right"
    );

    return () => {
      try {
        // Nettoyage handlers
        map.off("mouseenter", LAYER_ID, setCursorPointer);
        map.off("mouseleave", LAYER_ID, resetCursor);
      } catch {
        // ignore
      }

      // Clear hover state
      try {
        const prev = hoveredIdRef.current;
        if (prev !== null) {
          map.setFeatureState(
            { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: prev },
            { hover: false }
          );
        }
      } catch {
        // ignore
      }

      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Appliquer les filtres quand la sélection change
  React.useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (!map.getLayer(LAYER_ID)) return;

    // Construire le filtre
    const categoryFilters = Array.from(selectedCategories);
    const statusFilters = Array.from(selectedStatuses);

    let filter: any = ["all"];

    if (categoryFilters.length > 0) {
      const categoryMatch: any = ["match", ["get", "tor_category"]];
      categoryFilters.forEach((cat) => {
        categoryMatch.push(cat);
        categoryMatch.push(true);
      });
      categoryMatch.push(false); // default
      filter.push(categoryMatch);
    }

    if (statusFilters.length > 0) {
      const statusMatch: any = ["match", ["get", "status"]];
      statusFilters.forEach((status) => {
        statusMatch.push(status);
        statusMatch.push(true);
      });
      statusMatch.push(false); // default
      filter.push(statusMatch);
    }

    map.setFilter(LAYER_ID, filter.length > 1 ? filter : null);
  }, [selectedCategories, selectedStatuses]);

  const handleCameraReset = () => {
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [32.55, 15.51666667],
        zoom: 18,
        pitch: 60,
        bearing: 0,
        duration: 1000,
      });
    }
  };

  const handleCameraRotate = async () => {
    if (!mapRef.current || isAnimating) return;
    setIsAnimating(true);
    const map = mapRef.current;

    const startBearing = map.getBearing();
    const steps = 36;
    const degreesPerStep = 10;
    const durationPerStep = 3000 / steps;

    for (let i = 0; i < steps; i++) {
      await new Promise<void>((resolve) => {
        map.setBearing(startBearing + degreesPerStep * (i + 1));
        setTimeout(() => resolve(), durationPerStep);
      });
    }
    setIsAnimating(false);
  };

  const handleDroneFlightPath = async () => {
    if (!mapRef.current || isAnimating) return;
    setIsAnimating(true);
    const map = mapRef.current;

    const waypoints = [
      { center: [32.55, 15.51666667], zoom: 18, pitch: 60, bearing: 0 },
      { center: [32.56, 15.52666667], zoom: 20, pitch: 75, bearing: 45 },
      { center: [32.54, 15.51666667], zoom: 18, pitch: 60, bearing: 90 },
      { center: [32.55, 15.50666667], zoom: 20, pitch: 75, bearing: 180 },
      { center: [32.55, 15.51666667], zoom: 18, pitch: 60, bearing: 0 },
    ];

    for (const wp of waypoints) {
      await new Promise((resolve) => {
        map.flyTo({
          center: wp.center as [number, number],
          zoom: wp.zoom,
          pitch: wp.pitch,
          bearing: wp.bearing,
          duration: 2000,
          easing: (t) => t,
        });
        setTimeout(resolve, 2100);
      });
    }
    setIsAnimating(false);
  };

  const handleZoomIn = () => {
    if (mapRef.current) {
      mapRef.current.zoomTo(mapRef.current.getZoom() + 1, { duration: 300 });
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      mapRef.current.zoomTo(mapRef.current.getZoom() - 1, { duration: 300 });
    }
  };

  const handleIncreasePitch = () => {
    if (mapRef.current) {
      const currentPitch = mapRef.current.getPitch();
      mapRef.current.setPitch(Math.min(currentPitch + 10, 85));
    }
  };

  const handleDecreasePitch = () => {
    if (mapRef.current) {
      const currentPitch = mapRef.current.getPitch();
      mapRef.current.setPitch(Math.max(currentPitch - 10, 0));
    }
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Action Bar */}
      <div className="action-bar">
        <button
          className="action-button"
          onClick={handleZoomIn}
          disabled={isAnimating}
        >
          🔍+ Zoom In
        </button>
        <button
          className="action-button"
          onClick={handleZoomOut}
          disabled={isAnimating}
        >
          🔍- Zoom Out
        </button>

        <div
          style={{ width: "100%", height: "1px", backgroundColor: "#2e89ff" }}
        />

        <button
          className="action-button"
          onClick={handleIncreasePitch}
          disabled={isAnimating}
        >
          ⬆️ Pitch Up
        </button>
        <button
          className="action-button"
          onClick={handleDecreasePitch}
          disabled={isAnimating}
        >
          ⬇️ Pitch Down
        </button>

        <div
          style={{ width: "100%", height: "1px", backgroundColor: "#2e89ff" }}
        />

        <button
          className="action-button"
          onClick={handleCameraRotate}
          disabled={isAnimating}
        >
          🔄 Rotate 360°
        </button>
        <button
          className="action-button"
          onClick={handleDroneFlightPath}
          disabled={isAnimating}
        >
          🚁 Drone Flight
        </button>
        <button
          className="action-button secondary"
          onClick={handleCameraReset}
          disabled={isAnimating}
        >
          🏠 Reset View
        </button>

        {isAnimating && (
          <div
            style={{
              width: "100%",
              color: "#fbbf24",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            ⏳ Animation en cours...
          </div>
        )}
      </div>

      {/* Filter Panel */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          background: "rgba(0, 0, 0, 0.85)",
          border: "1px solid #2e89ff",
          borderRadius: "8px",
          padding: "12px",
          maxWidth: "300px",
          zIndex: 998,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <h3
            style={{
              color: "#2e89ff",
              fontSize: "14px",
              fontWeight: "bold",
              margin: 0,
            }}
          >
            🔍 Filtres
          </h3>
          <button
            onClick={() => setShowFilterPanel(!showFilterPanel)}
            style={{
              background: "none",
              border: "none",
              color: "#2e89ff",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            {showFilterPanel ? "✕" : "▼"}
          </button>
        </div>

        {showFilterPanel && (
          <>
            {/* Filtre Catégories */}
            <div style={{ marginBottom: "12px" }}>
              <div
                style={{
                  color: "#60a5fa",
                  fontSize: "12px",
                  fontWeight: "bold",
                  marginBottom: "6px",
                }}
              >
                Catégories
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {CATEGORIES.map((cat) => (
                  <label
                    key={cat}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      color: "#fff",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCategories.has(cat)}
                      onChange={(e) => {
                        const newCats = new Set(selectedCategories);
                        if (e.target.checked) {
                          newCats.add(cat);
                        } else {
                          newCats.delete(cat);
                        }
                        setSelectedCategories(newCats);
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    {cat}
                  </label>
                ))}
              </div>
            </div>

            <div
              style={{
                height: "1px",
                backgroundColor: "#2e89ff",
                marginBottom: "12px",
              }}
            />

            {/* Filtre Statuts */}
            <div style={{ marginBottom: "12px" }}>
              <div
                style={{
                  color: "#60a5fa",
                  fontSize: "12px",
                  fontWeight: "bold",
                  marginBottom: "6px",
                }}
              >
                Statuts
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {STATUSES.map((status) => (
                  <label
                    key={status}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      color: "#fff",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedStatuses.has(status)}
                      onChange={(e) => {
                        const newStatuses = new Set(selectedStatuses);
                        if (e.target.checked) {
                          newStatuses.add(status);
                        } else {
                          newStatuses.delete(status);
                        }
                        setSelectedStatuses(newStatuses);
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    {status}
                  </label>
                ))}
              </div>
            </div>

            {/* Boutons de reset */}
            <div
              style={{
                display: "flex",
                gap: "8px",
                marginTop: "12px",
              }}
            >
              <button
                onClick={() => setSelectedCategories(new Set(CATEGORIES))}
                style={{
                  flex: 1,
                  padding: "6px",
                  background: "#2e89ff",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Reset Tous
              </button>
              <button
                onClick={() => {
                  setSelectedCategories(new Set(CATEGORIES));
                  setSelectedStatuses(new Set(STATUSES));
                }}
                style={{
                  flex: 1,
                  padding: "6px",
                  background: "#666",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Rafraîchir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
