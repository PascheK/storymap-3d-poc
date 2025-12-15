"use client";

import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import {
  Bounds,
  ContactShadows,
  Environment,
  Html,
  OrbitControls,
  useBounds,
  useGLTF,
} from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { MapGround } from "@/app/test1/MapGround";

function Loader() {
  return (
    <Html center style={{ color: "white", fontFamily: "system-ui" }}>
      Chargement 3D…
    </Html>
  );
}

/**
 * Extrait un OBJECTID depuis le nom d'un mesh
 * Patterns supportés : "OID_12", "OBJECTID_12", "12", etc.
 */
function extractObjectId(name?: string) {
  if (!name) return null;
  const m =
    name.match(/OID[_\-\s]?(\d+)/i) ||
    name.match(/OBJECTID[_\-\s]?(\d+)/i) ||
    name.match(/\b(\d+)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Contrôles stricts avec contraintes de caméra
 * - Empêche la caméra de passer sous le sol
 * - Limite le pan dans une zone définie
 * - Clamp des distances min/max
 */
function StrictControls({
  groundY,
  bounds,
}: {
  groundY: number;
  bounds: { width: number; depth: number } | null;
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const limitX = bounds ? (bounds.width * 1.5) / 2 : 50;
  const limitZ = bounds ? (bounds.depth * 1.5) / 2 : 50;
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const c = controlsRef.current;
    if (!c) return;
    const cam = c.object as THREE.PerspectiveCamera;

    // Hauteur min au-dessus du sol + distances
    const minY = groundY + 0.1;
    const minDist = 0.8;
    const maxDist = 50000;

    // Clamp du target (point visé) dans les limites x/z
    c.target.x = THREE.MathUtils.clamp(c.target.x, -limitX, limitX);
    c.target.z = THREE.MathUtils.clamp(c.target.z, -limitZ, limitZ);
    c.target.y = Math.max(c.target.y, minY);

    // Empêche la caméra de passer sous le sol
    if (cam.position.y < minY) cam.position.y = minY;

    // Si la caméra est sous le target, on la retourne au-dessus
    tmp.subVectors(cam.position, c.target);
    if (tmp.y < 0) {
      const corrected = tmp.clone();
      corrected.y = Math.abs(corrected.y);
      cam.position.copy(c.target).add(corrected);
      if (cam.position.y < minY) cam.position.y = minY;
    }

    // Clamp de la distance caméra-target
    const dist = cam.position.distanceTo(c.target);
    if (dist < minDist || dist > maxDist) {
      tmp.subVectors(cam.position, c.target).normalize();
      const clamped = THREE.MathUtils.clamp(dist, minDist, maxDist);
      cam.position.copy(c.target).add(tmp.multiplyScalar(clamped));
    }

    c.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      enableRotate
      enableZoom
      enablePan
      maxPolarAngle={Math.PI / 2 - 0.02}
      minPolarAngle={0.05}
      minDistance={0.8}
      maxDistance={100}
      zoomSpeed={1.0}
      rotateSpeed={1.0}
      panSpeed={0.8}
      screenSpacePanning
    />
  );
}

type PickInfo = {
  uuid: string;
  name: string;
  type: string;
  objectId: number | null;
    attrs?: Record<string, unknown> | null;
};

/**
 * Composant Model : charge le GLB, gère highlight & focus smooth
 */
function Model({
  onPick,
  onBounds,
  attrsByObjectId,
  onModelLoaded,
}: {
  onPick: (info: PickInfo) => void;
  onBounds: (b: { width: number; depth: number; minY: number }) => void;
  attrsByObjectId: Map<number, Record<string, unknown>> | null;
  onModelLoaded?: () => void;
}) {
  const gltf = useGLTF("/models/OID_1/esriGeometryMultiPatch.glb");
  
  // Ref pour cloner qu'une seule fois - JAMAIS dans les dépendances
  const sceneRef = useRef<THREE.Group | null>(null);
  
  // Initialiser la scène une seule fois
  useEffect(() => {
    if (sceneRef.current === null) {
      sceneRef.current = gltf.scene.clone(true);
      console.log("[Model] Scène clonée UNE SEULE FOIS avec", gltf.scene.children.length, "enfants");
    }
  }, [gltf.scene]); // Dépendance acceptée mais ne change qu'au premier load du GLB
  
  const scene = sceneRef.current; // Peut être null avant que useEffect n'exécute

  const boundsApi = useBounds();
  const { camera, controls } = useThree();

  // Stock des matériaux d'origine pour restore après highlight
  const originalMaterialsRef = useRef(new Map<string, THREE.Material | THREE.Material[]>());
  const highlightedUuidRef = useRef<string | null>(null);
  const modelLoadedRef = useRef(false);

  // Animation du focus smooth
  const focusAnimRef = useRef<{
    active: boolean;
    startPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endPos: THREE.Vector3;
    endTarget: THREE.Vector3;
    progress: number;
    duration: number;
  } | null>(null);

  // Material de highlight (couleur + émission)
  const highlightMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color("#3b82f6"),
      emissive: new THREE.Color("#60a5fa"),
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.1,
    });
  }, []);

  useLayoutEffect(() => {
    // Vérifier que la scène est initialisée
    if (!scene) {
      console.log("[Model] useLayoutEffect : scène pas prête");
      return;
    }

    // Centrage et scaling du modèle
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    console.log("[Model] Bbox initiale:", { 
      center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }, 
      size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
      children: scene.children.length
    });

    scene.position.sub(center);

    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    const target = 50;
    const s = target / maxAxis;
    
    console.log("[Model] Calcul scale:", { maxAxis: maxAxis.toFixed(2), target, scale: s.toFixed(6) });
    
    scene.scale.setScalar(s);

    // Recalcul de la bbox après transformations
    const box2 = new THREE.Box3().setFromObject(scene);
    const size2 = new THREE.Vector3();
    box2.getSize(size2);

    console.log("[Model] Après scaling:", { scale: s.toFixed(4), newSize: { x: size2.x.toFixed(2), y: size2.y.toFixed(2), z: size2.z.toFixed(2) }, minY: box2.min.y.toFixed(2) });

    // Snapshot des matériaux originaux (une seule fois)
    if (originalMaterialsRef.current.size === 0) {
        scene.traverse((o) => {
            if ("isMesh" in o && o.isMesh && "material" in o) {
              const mesh = o as THREE.Mesh;
              originalMaterialsRef.current.set(mesh.uuid, mesh.material);
          // Active les ombres sur chaque mesh
              mesh.castShadow = true;
              mesh.receiveShadow = true;
        }
      });
      console.log("[Model] Meshes trouvés et configurés:", originalMaterialsRef.current.size);
    }

    // Appeler les callbacks
    onBounds({ width: size2.x, depth: size2.z, minY: box2.min.y });

    // Notifie que le modèle est chargé (une seule fois)
    if (!modelLoadedRef.current) {
      modelLoadedRef.current = true;
      onModelLoaded?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // Restaure le material d'origine de l'objet précédemment highlighté
  const clearHighlight = () => {
    const prev = highlightedUuidRef.current;
    if (!prev || !scene) return;

      scene.traverse((o) => {
        if ("isMesh" in o && o.isMesh && o.uuid === prev) {
          const mesh = o as THREE.Mesh;
          const orig = originalMaterialsRef.current.get(mesh.uuid);
          if (orig) mesh.material = orig;
      }
    });

    highlightedUuidRef.current = null;
  };

  // Applique le highlight sur l'objet cliqué
  const applyHighlight = (uuid: string) => {
    if (!scene) return;
    
    clearHighlight();

      scene.traverse((o) => {
        if ("isMesh" in o && o.isMesh && o.uuid === uuid) {
          const mesh = o as THREE.Mesh;
          mesh.material = highlightMaterial;
        highlightedUuidRef.current = uuid;
      }
    });
  };

  // Focus smooth : anime caméra + target vers la bbox de l'objet
  const smoothFocusOnObject = (obj: THREE.Object3D) => {
    const orbitControls = controls as OrbitControlsImpl | undefined;
    if (!orbitControls) {
      // Fallback sans smooth
      boundsApi.refresh(obj).fit();
      return;
    }

    // Calcul bbox de l'objet
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Position caméra optimale : recul en fonction de la taille
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const dist = Math.abs(maxDim / Math.sin(fov / 2)) * 1.5;

    // Direction : depuis position actuelle vers le centre, normalisée
    const dir = new THREE.Vector3().subVectors(camera.position, center).normalize();

    const newPos = new THREE.Vector3().copy(center).add(dir.multiplyScalar(dist));

    // Init animation
    focusAnimRef.current = {
      active: true,
      startPos: camera.position.clone(),
      startTarget: orbitControls.target.clone(),
      endPos: newPos,
      endTarget: center.clone(),
      progress: 0,
      duration: 0.6, // 600ms
    };
  };

  // useFrame : gère l'animation smooth du focus
  useFrame((_, delta) => {
    const anim = focusAnimRef.current;
    if (!anim || !anim.active) return;

    const orbitControls = controls as OrbitControlsImpl | undefined;
    if (!orbitControls) {
      focusAnimRef.current = null;
      return;
    }

    anim.progress += delta / anim.duration;

    if (anim.progress >= 1) {
      // Fin de l'animation
      camera.position.copy(anim.endPos);
      orbitControls.target.copy(anim.endTarget);
      orbitControls.update();
      focusAnimRef.current = null;
    } else {
      // Easing : easeInOutCubic
      const t = anim.progress < 0.5 ? 4 * anim.progress ** 3 : 1 - Math.pow(-2 * anim.progress + 2, 3) / 2;

      camera.position.lerpVectors(anim.startPos, anim.endPos, t);
      orbitControls.target.lerpVectors(anim.startTarget, anim.endTarget, t);
      orbitControls.update();
    }
  });

  // Ne render le primitive que si la scène est prête
  if (!sceneRef.current) {
    console.log("[Model] Pas encore prêt pour render");
    return null;
  }

  return (
    <primitive
      object={sceneRef.current}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();

        // Trouve le mesh cliqué
          let obj: THREE.Object3D | null = e.object;
            while (obj && !("isMesh" in obj && (obj as THREE.Mesh).isMesh) && obj.parent) {
            obj = obj.parent;
          }
        if (!obj) return;

        // 1) Highlight visuel
        applyHighlight(obj.uuid);

        // 2) Focus smooth sur l'objet
        smoothFocusOnObject(obj);

        // 3) Récupération des données + mapping attributs ArcGIS
        const objectId = extractObjectId(obj.name);
        const attrs = objectId && attrsByObjectId ? attrsByObjectId.get(objectId) : null;

        onPick({
          uuid: obj.uuid,
          name: obj.name || "(no name)",
          type: obj.type || "Object3D",
          objectId,
          attrs,
        });
      }}
    />
  );
}

/**
 * Panneau UI : affiche les données de l'objet sélectionné
 */
function InfoPanel({ picked }: { picked: PickInfo | null }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        padding: "12px 16px",
        borderRadius: 12,
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(8px)",
        color: "white",
        fontFamily: "system-ui, -apple-system, sans-serif",
        zIndex: 10,
        maxWidth: 420,
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>📍 Storymap 3D</div>

      {!picked ? (
        <div style={{ opacity: 0.75, fontSize: 13 }}>Cliquez sur un bâtiment pour voir ses détails…</div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ opacity: 0.6 }}>Objet :</span> <strong>{picked.name}</strong>
            <span style={{ opacity: 0.5, marginLeft: 6 }}>({picked.type})</span>
          </div>
          <div style={{ opacity: 0.7, fontSize: 11, marginBottom: 4 }}>UUID : {picked.uuid}</div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ opacity: 0.6 }}>OBJECTID :</span> <strong>{picked.objectId ?? "non trouvé"}</strong>
          </div>

          {picked.attrs ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, opacity: 0.8 }}>Attributs ArcGIS :</div>
              <pre
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.4)",
                  maxHeight: 200,
                  overflow: "auto",
                  fontSize: 11,
                  margin: 0,
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {JSON.stringify(picked.attrs, null, 2)}
              </pre>
            </div>
          ) : (
            <div style={{ opacity: 0.6, fontSize: 12, fontStyle: "italic", marginTop: 4 }}>
              Aucun attribut trouvé. Vérifiez que le mesh contient un OBJECTID dans son nom.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Scene() {
  const [picked, setPicked] = useState<PickInfo | null>(null);
  const [bounds, setBounds] = useState<{ width: number; depth: number; minY: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Coordonnées du centre de la carte (OSM tiles)
  const mapCenter = { lat: 46.62, lon: 6.95 }; // Ajustez selon votre zone
  const mapZoom = 16;

  // Chargement des attributs ArcGIS depuis le JSON
  const [attrsByObjectId, setAttrsByObjectId] = useState<Map<number, Record<string, unknown>> | null>(null);

  // Mémoriser les callbacks pour éviter les boucles infinies
  const handleBounds = useCallback((b: { width: number; depth: number; minY: number }) => {
    console.log("[Scene] Bounds reçus");
    setBounds(b);
  }, []);

  const handlePick = useCallback((info: PickInfo) => {
    console.log("[Scene] Objet cliqué:", info.name);
    setPicked(info);
  }, []);

  const handleModelLoaded = useCallback(() => {
    console.log("[Scene] Model chargé");
    setLoadingProgress(100);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingProgress(30);
        const res = await fetch("/models/OID_1/esriGeometryMultiPatch_ESRI3DO.json");
        if (!res.ok) {
          console.log("[Scene] JSON non trouvé (optionnel)");
          setLoadingProgress(90);
          return;
        }
        const json = await res.json();
        console.log("[Scene] JSON chargé, parsing...");

        setLoadingProgress(60);
        // Parsing : supporte plusieurs formats (array, features, data)
        const map = new Map<number, Record<string, unknown>>();
        const rows = Array.isArray(json) ? json : json?.features || json?.data || [];
        for (const r of rows) {
          const row = r?.attributes ?? r;
          const id = row?.OBJECTID ?? row?.objectid ?? row?.Oid ?? row?.oid;
          if (typeof id === "number") map.set(id, row);
        }
        console.log("[Scene] Attributs chargés:", map.size);

        if (!cancelled) {
          setAttrsByObjectId(map.size ? map : null);
          setLoadingProgress(90);
        }
      } catch (err) {
        console.log("[Scene] Erreur chargement JSON:", err);
        setLoadingProgress(90);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groundY = bounds ? bounds.minY - 0.01 : -1;

  // Détecte quand tout est chargé
  useEffect(() => {
    if (bounds && loadingProgress >= 90) {
      console.log("[Scene] ✅ Tous les éléments chargés!");
      // Petit délai pour s'assurer que le rendu est prêt
      const timer = setTimeout(() => {
        console.log("[Scene] 🎉 Affichage de la scène");
        setIsLoading(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [bounds, loadingProgress]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {/* Écran de chargement */}
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            color: "white",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 24 }}>📍 Storymap 3D</div>
          <div
            style={{
              width: 200,
              height: 4,
              background: "rgba(255,255,255,0.2)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${loadingProgress}%`,
                height: "100%",
                background: "white",
                borderRadius: 2,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ marginTop: 16, fontSize: 14, opacity: 0.9 }}>Chargement en cours...</div>
        </div>
      )}

      {/* Panneau d'informations */}
      <InfoPanel picked={picked} />

      <Canvas
        shadows
        camera={{ position: [20, 15, 25], fov: 50, near: 0.01, far: 100000 }}
          onCreated={({ gl }) => {
            gl.shadowMap.enabled = true;
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
          }}
      >
        {/* Arrière-plan : ciel naturel */}
        <color attach="background" args={["#87ceeb"]} />
        <fog attach="fog" args={["#87ceeb", 50, 200]} />

        {/* Lighting naturel : soleil + ambient doux */}
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[50, 80, 40]}
          intensity={1.5}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={200}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
          shadow-bias={-0.0001}
        />
        {/* Lumière de remplissage pour éviter les ombres trop dures */}
        <directionalLight position={[-30, 40, -30]} intensity={0.3} />

        <Suspense fallback={<Loader />}>
          <Bounds fit clip observe margin={1.2}>
            <Model
              onPick={handlePick}
              onBounds={handleBounds}
              attrsByObjectId={attrsByObjectId}
              onModelLoaded={handleModelLoaded}
            />

            {bounds && (
              <MapGround
                width={bounds.width * 1.2}
                depth={bounds.depth * 1.2}
                y={groundY}
                center={mapCenter}
                zoom={mapZoom}
                tiles={3}
              />
            )}

            {/* Ombres de contact légères pour ancrer les objets au sol */}
            {bounds && (
              <ContactShadows
                position={[0, groundY + 0.01, 0]}
                opacity={0.25}
                scale={bounds.width * 1.5}
                blur={2}
                far={10}
              />
            )}
          </Bounds>

          {/* Environnement HDRI : preset "park" pour un rendu jour naturel */}
          <Environment preset="city" />
        </Suspense>

        <StrictControls groundY={groundY} bounds={bounds ? { width: bounds.width, depth: bounds.depth } : null} />
      </Canvas>
    </div>
  );
}

useGLTF.preload("/models/OID_1/esriGeometryMultiPatch.glb");
