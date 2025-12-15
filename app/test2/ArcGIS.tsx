"use client";
import React, { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Import ArcGIS only on client side
let Map: any = null;
let SceneView: any = null;

const initArcGIS = async () => {
  if (!Map) {
    const arcgisMap = await import("@arcgis/core/Map");
    const arcgisSceneView = await import("@arcgis/core/views/SceneView");
    Map = arcgisMap.default;
    SceneView = arcgisSceneView.default;
  }
};

const ArcGISContent = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    raf?: number;
  } | null>(null);

  useEffect(() => {
    const setup = async () => {
      if (!containerRef.current) return;

      await initArcGIS();

      const map = new Map({ basemap: "satellite" });
      const view = new SceneView({
        container: containerRef.current,
        map,
        center: [148.9819, -35.3981],
        zoom: 18,
      });
      viewRef.current = view;

      // Create overlay canvas on top of SceneView
      const overlay = document.createElement("canvas");
      overlay.style.position = "absolute";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.pointerEvents = "none"; // let map interactions pass through
      overlay.width = view.width;
      overlay.height = view.height;
      containerRef.current.appendChild(overlay);
      overlayRef.current = overlay;

      const renderer = new THREE.WebGLRenderer({ canvas: overlay, alpha: true, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(view.width, view.height);
      renderer.autoClear = true;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, view.width / view.height, 0.1, 1e7);

      // Lights
      const dir1 = new THREE.DirectionalLight(0xffffff, 1.0);
      dir1.position.set(0, -70, 100);
      scene.add(dir1);
      const dir2 = new THREE.DirectionalLight(0xffffff, 0.8);
      dir2.position.set(0, 70, 100);
      scene.add(dir2);
      scene.add(new THREE.AmbientLight(0xffffff, 0.4));

      // Load GLTF
      const loader = new GLTFLoader();
      loader.load("/models/OID_1/esriGeometryMultiPatch.glb", (gltf) => {
        scene.add(gltf.scene);
        scene.updateMatrixWorld(true);
      });

      threeRef.current = { renderer, scene, camera };

      // Sync camera and render on each frame
      const renderLoop = () => {
        if (!threeRef.current) return;
        const { renderer: r, scene: s, camera: c } = threeRef.current;
        const cam = (view as any).state.camera;
        // ArcGIS SceneView camera values
        c.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
        c.up.set(cam.up[0], cam.up[1], cam.up[2]);
        c.lookAt(new THREE.Vector3(cam.center[0], cam.center[1], cam.center[2]));
        c.projectionMatrix.fromArray(cam.projectionMatrix);

        r.render(s, c);
        threeRef.current.raf = requestAnimationFrame(renderLoop);
      };
      renderLoop();

      // Resize handling
      const handleResize = () => {
        if (!overlayRef.current || !threeRef.current) return;
        overlayRef.current.width = view.width;
        overlayRef.current.height = view.height;
        const { renderer: r, camera: c } = threeRef.current;
        r.setSize(view.width, view.height);
        c.aspect = view.width / view.height;
        c.updateProjectionMatrix();
      };
      view.on("resize", handleResize);
    };

    setup();

    return () => {
      if (threeRef.current?.raf) cancelAnimationFrame(threeRef.current.raf);
      threeRef.current?.renderer?.dispose();
      if (overlayRef.current) overlayRef.current.remove();
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};

const ArcGIS = dynamic(() => Promise.resolve(ArcGISContent), { ssr: false });

export default ArcGIS;
