"use client";
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type PickInfo = {
  uuid: string;
  name: string;
  position: { x: number; y: number; z: number };
  lon?: number;
  lat?: number;
};

const MapBox = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [pickedInfo, setPickedInfo] = useState<PickInfo | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    mapboxgl.accessToken =
      "pk.eyJ1IjoicGFzY2hlazciLCJhIjoiY200NzU2Z2JzMDI1dzJscXhtOWNzeXoxdiJ9.oZjq_yoLC0G50QlQZTUdoQ";

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
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
    const modelOrigin: [number, number] =  [32.55, 15.51666667];
    const modelAltitude = 0;
    const modelRotate = [Math.PI / 2, 0, 0];

    const modelAsMercatorCoordinate = mapboxgl.MercatorCoordinate.fromLngLat(
      modelOrigin,
      modelAltitude
    );

    const modelTransform = {
      translateX: modelAsMercatorCoordinate.x,
      translateY: modelAsMercatorCoordinate.y,
      translateZ: modelAsMercatorCoordinate.z,
      rotateX: modelRotate[0],
      rotateY: modelRotate[1],
      rotateZ: modelRotate[2],
      scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits(),
    };

    const createCustomLayer = (map: mapboxgl.Map) => {
      const camera = new THREE.Camera();
      const scene = new THREE.Scene();
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const invViewProj = new THREE.Matrix4();
      let hovered: THREE.Mesh | null = null;
      let modelGroup: THREE.Group | null = null;

      // Store refs for dev tools
      sceneRef.current = scene;
      cameraRef.current = camera;

      const directionalLight1 = new THREE.DirectionalLight(0xffffff);
      directionalLight1.position.set(0, -70, 100).normalize();
      scene.add(directionalLight1);

      const directionalLight2 = new THREE.DirectionalLight(0xffffff);
      directionalLight2.position.set(0, 70, 100).normalize();
      scene.add(directionalLight2);

      const loader = new GLTFLoader();
      loader.load("/models/OID_1/esriGeometryMultiPatch.glb", (gltf) => {
        modelGroup = new THREE.Group();
        modelGroup.add(gltf.scene);
        scene.add(modelGroup);
        scene.updateMatrixWorld(true);
      });
      loader.load("/models/OID_2/esriGeometryMultiPatch.glb", (gltf) => {
        scene.add(gltf.scene);
        scene.updateMatrixWorld(true);
      });
      const renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: map.painter.context.gl,
        antialias: true,
      });

      renderer.autoClear = false;
      rendererRef.current = renderer;

      return {
        id: "3d-model",
        type: "custom",
        renderingMode: "3d",
        onAdd: () => {
          const unproject = (ndcX: number, ndcY: number, ndcZ: number) => {
            const v = new THREE.Vector4(ndcX, ndcY, ndcZ, 1).applyMatrix4(
              invViewProj
            );
            v.divideScalar(v.w || 1);
            return new THREE.Vector3(v.x, v.y, v.z);
          };

          const handlePointer = (
            e: mapboxgl.MapMouseEvent,
            isClick: boolean
          ) => {
            const canvas = map.getCanvas();
            const rect = canvas.getBoundingClientRect();
            const x = e.point.x;
            const y = e.point.y;
            mouse.x = (x / rect.width) * 2 - 1;
            mouse.y = -(y / rect.height) * 2 + 1;

            // Build ray from near/far unprojected points
            const pNear = unproject(mouse.x, mouse.y, -1); // clip space near
            const pFar = unproject(mouse.x, mouse.y, 1); // clip space far
            const dir = pFar.clone().sub(pNear).normalize();
            raycaster.set(pNear, dir);
            scene.updateMatrixWorld(true);

            const intersects = raycaster.intersectObjects(scene.children, true);

            // Hover highlight
            if (!isClick) {
              if (
                hovered &&
                hovered.material &&
                (hovered.material as THREE.MeshStandardMaterial).emissive
              ) {
                (
                  hovered.material as THREE.MeshStandardMaterial
                ).emissive.setHex(0x000000);
              }
              hovered = null;
              if (intersects.length > 0) {
                const obj = intersects[0].object as THREE.Mesh;
                hovered = obj;
                if (
                  obj.material &&
                  (obj.material as THREE.MeshStandardMaterial).emissive
                ) {
                  (obj.material as THREE.MeshStandardMaterial).emissive.setHex(
                    0x2e89ff
                  );
                }
              }
            }

            // Click handler
            if (isClick && intersects.length > 0) {
              e.preventDefault();
              const obj = intersects[0].object as THREE.Mesh;
              console.log(obj);
              setPickedInfo({
                uuid: obj.uuid,
                name: obj.name || "Unnamed",
                position: {
                  x: obj.position.x,
                  y: obj.position.y,
                  z: obj.position.z,
                },
                lon: modelOrigin[0],
                lat: modelOrigin[1],
              });
            }
          };

          map.on("mousemove", (e: mapboxgl.MapMouseEvent) =>
            handlePointer(e, false)
          );
          map.on("click", (e: mapboxgl.MapMouseEvent) =>
            handlePointer(e, true)
          );
        },
        render: (gl: WebGLRenderingContext, matrix: number[]) => {
          const rotationX = new THREE.Matrix4().makeRotationAxis(
            new THREE.Vector3(1, 0, 0),
            modelTransform.rotateX
          );
          const rotationY = new THREE.Matrix4().makeRotationAxis(
            new THREE.Vector3(0, 1, 0),
            modelTransform.rotateY
          );
          const rotationZ = new THREE.Matrix4().makeRotationAxis(
            new THREE.Vector3(0, 0, 1),
            modelTransform.rotateZ
          );

          const m = new THREE.Matrix4().fromArray(matrix);
          const l = new THREE.Matrix4()
            .makeTranslation(
              modelTransform.translateX,
              modelTransform.translateY,
              modelTransform.translateZ
            )
            .scale(
              new THREE.Vector3(
                modelTransform.scale,
                -modelTransform.scale,
                modelTransform.scale
              )
            )
            .multiply(rotationX)
            .multiply(rotationY)
            .multiply(rotationZ);

          // Combined view-projection (Mapbox supplies view * projection)
          const viewProj = m.multiply(l);
          camera.projectionMatrix = viewProj;
          // Keep inverse for unproject in pointer handlers
          invViewProj.copy(viewProj).invert();
          renderer.resetState();
          renderer.render(scene, camera);
          map.triggerRepaint();
        },
      };
    };

    map.on("style.load", () => {
      const customLayer = createCustomLayer(
        map
      ) as unknown as mapboxgl.CustomLayerInterface;
      map.addLayer(customLayer);
    });

    mapRef.current = map as mapboxgl.Map;

    return () => map.remove();
  }, []);

  // Dev tools actions
  const scaleModel = (direction: number) => {
    if (sceneRef.current) {
      const child = sceneRef.current.children.find(
        (c) => c instanceof THREE.Group && c.children.length > 0
      ) as THREE.Group | undefined;
      if (child) {
        child.scale.multiplyScalar(direction > 0 ? 1.2 : 0.8);
      }
    }
  };

  const resetScale = () => {
    if (sceneRef.current) {
      const child = sceneRef.current.children.find(
        (c) => c instanceof THREE.Group && c.children.length > 0
      ) as THREE.Group | undefined;
      if (child) {
        child.scale.set(1, 1, 1);
      }
    }
  };

  const droneFlyCameraPath = async () => {
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

  const rotateCamera = async () => {
    if (!mapRef.current || isAnimating) return;
    setIsAnimating(true);

    const map = mapRef.current;
    const currentBearing = map.getBearing();

    await new Promise((resolve) => {
      map.easeTo({
        bearing: currentBearing + 360,
        duration: 3000,
      });
      setTimeout(resolve, 3100);
    });

    setIsAnimating(false);
  };

  const resetCamera = () => {
    if (mapRef.current && !isAnimating) {
      mapRef.current.flyTo({
        center: [32.55, 15.51666667],
        zoom: 18,
        pitch: 60,
        bearing: 0,
        duration: 1500,
      });
    }
  };

  const toggleWireframe = () => {
    if (sceneRef.current) {
      sceneRef.current.children.forEach((child) => {
        if (child instanceof THREE.Group) {
          child.children.forEach((mesh) => {
            const m = mesh as THREE.Mesh;
            if (m.material && 'wireframe' in m.material) {
              (m.material as THREE.MeshStandardMaterial).wireframe = !(m.material as THREE.MeshStandardMaterial).wireframe;
            }
          });
        }
      });
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

      {/* DevTools Bar */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          backgroundColor: "rgba(0, 0, 0, 0.9)",
          border: "1px solid #2e89ff",
          borderRadius: "8px",
          padding: "12px",
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          maxWidth: "600px",
          zIndex: 999,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
        }}
      >
        <button
          onClick={() => scaleModel(1)}
          disabled={isAnimating}
          style={{
            padding: "8px 12px",
            backgroundColor: "#2e89ff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isAnimating ? "not-allowed" : "pointer",
            fontSize: "12px",
            fontWeight: "bold",
            opacity: isAnimating ? 0.5 : 1,
          }}
        >
          📏 Agrandir
        </button>
        <button
          onClick={() => scaleModel(-1)}
          disabled={isAnimating}
          style={{
            padding: "8px 12px",
            backgroundColor: "#2e89ff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isAnimating ? "not-allowed" : "pointer",
            fontSize: "12px",
            fontWeight: "bold",
            opacity: isAnimating ? 0.5 : 1,
          }}
        >
          📉 Réduire
        </button>
        <button
          onClick={resetScale}
          disabled={isAnimating}
          style={{
            padding: "8px 12px",
            backgroundColor: "#555",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isAnimating ? "not-allowed" : "pointer",
            fontSize: "12px",
            fontWeight: "bold",
            opacity: isAnimating ? 0.5 : 1,
          }}
        >
          ↺ Reset Scale
        </button>

        <div style={{ width: "100%", height: "1px", backgroundColor: "#2e89ff" }} />

        <button
          onClick={droneFlyCameraPath}
          disabled={isAnimating}
          style={{
            padding: "8px 12px",
            backgroundColor: "#22c55e",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isAnimating ? "not-allowed" : "pointer",
            fontSize: "12px",
            fontWeight: "bold",
            opacity: isAnimating ? 0.5 : 1,
          }}
        >
          🚁 Vol Drone
        </button>
        <button
          onClick={rotateCamera}
          disabled={isAnimating}
          style={{
            padding: "8px 12px",
            backgroundColor: "#f59e0b",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isAnimating ? "not-allowed" : "pointer",
            fontSize: "12px",
            fontWeight: "bold",
            opacity: isAnimating ? 0.5 : 1,
          }}
        >
          🔄 Rotation 360°
        </button>
        <button
          onClick={resetCamera}
          disabled={isAnimating}
          style={{
            padding: "8px 12px",
            backgroundColor: "#555",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isAnimating ? "not-allowed" : "pointer",
            fontSize: "12px",
            fontWeight: "bold",
            opacity: isAnimating ? 0.5 : 1,
          }}
        >
          🏠 Reset Caméra
        </button>
        <button
          onClick={toggleWireframe}
          disabled={isAnimating}
          style={{
            padding: "8px 12px",
            backgroundColor: "#8b5cf6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isAnimating ? "not-allowed" : "pointer",
            fontSize: "12px",
            fontWeight: "bold",
            opacity: isAnimating ? 0.5 : 1,
          }}
        >
          🔲 Wireframe
        </button>

        {isAnimating && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#fbbf24",
              fontSize: "12px",
            }}
          >
            ⏳ Animation en cours...
          </div>
        )}
      </div>
      {pickedInfo && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            backgroundColor: "rgba(0, 0, 0, 0.85)",
            color: "#fff",
            padding: "16px",
            borderRadius: "8px",
            fontFamily: "monospace",
            fontSize: "13px",
            maxWidth: "350px",
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
            border: "1px solid #2e89ff",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
              paddingBottom: "8px",
              borderBottom: "1px solid #2e89ff",
            }}
          >
            <strong>Bâtiment Info</strong>
            <button
              onClick={() => setPickedInfo(null)}
              style={{
                background: "none",
                border: "none",
                color: "#2e89ff",
                cursor: "pointer",
                fontSize: "16px",
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ lineHeight: "1.6" }}>
            <div>
              <span style={{ color: "#60a5fa" }}>UUID:</span>
              <br />
              <span style={{ wordBreak: "break-all" }}>
                {pickedInfo.uuid.slice(0, 20)}…
              </span>
            </div>
            <div style={{ marginTop: "8px" }}>
              <span style={{ color: "#60a5fa" }}>Nom:</span>
              <br />
              <span>{pickedInfo.name}</span>
            </div>
            <div style={{ marginTop: "8px" }}>
              <span style={{ color: "#60a5fa" }}>Coordonnées:</span>
              <br />
              <span>Lon: {pickedInfo.lon?.toFixed(6)}</span>
              <br />
              <span>Lat: {pickedInfo.lat?.toFixed(6)}</span>
            </div>
            <div style={{ marginTop: "8px" }}>
              <span style={{ color: "#60a5fa" }}>Position 3D:</span>
              <br />
              <span>X: {pickedInfo.position.x.toFixed(2)}</span>
              <br />
              <span>Y: {pickedInfo.position.y.toFixed(2)}</span>
              <br />
              <span>Z: {pickedInfo.position.z.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapBox;
