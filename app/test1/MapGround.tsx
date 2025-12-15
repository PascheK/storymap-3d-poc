import { useEffect, useState } from "react";
import * as THREE from "three";

function lon2tile(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function lat2tile(lat: number, z: number) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      Math.pow(2, z)
  );
}

export function MapGround({
  width,
  depth,
  y,
  center,
  zoom = 16,
  tiles = 3,
}: {
  width: number;
  depth: number;
  y: number;
  center: { lat: number; lon: number };
  zoom?: number;
  tiles?: number;
}) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const tileSize = 256;
      const canvas = document.createElement("canvas");
      canvas.width = tileSize * tiles;
      canvas.height = tileSize * tiles;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const cx = lon2tile(center.lon, zoom);
      const cy = lat2tile(center.lat, zoom);
      const half = Math.floor(tiles / 2);

      let loaded = 0;

      const jobs: Promise<void>[] = [];
      for (let dx = -half; dx <= half; dx++) {
        for (let dy = -half; dy <= half; dy++) {
          const x = cx + dx;
          const y = cy + dy;

          const url = `/api/tiles/${zoom}/${x}/${y}.png`; // ✅ pas de await

          jobs.push(
            new Promise((resolve) => {
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(
                  img,
                  (dx + half) * tileSize,
                  (dy + half) * tileSize,
                  tileSize,
                  tileSize
                );
                loaded++;
                resolve();
              };
              img.onerror = () => resolve();
              img.src = url;
            })
          );
        }
      }

      await Promise.all(jobs);
      if (cancelled) return;

      console.log("Map tiles loaded:", loaded, "/", tiles * tiles);

      // Dispose ancienne texture si besoin
      setTex((prev) => {
        prev?.dispose?.();
        const t = new THREE.CanvasTexture(canvas);
        t.needsUpdate = true;
        t.flipY = false;
        return t;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [center.lat, center.lon, zoom, tiles]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
      <planeGeometry args={[width, depth]} />
      {/* ✅ basic material = aucune dépendance aux lumières */}
      <meshBasicMaterial map={tex ?? undefined} color={tex ? "white" : "#1b2333"} />
    </mesh>
  );
}