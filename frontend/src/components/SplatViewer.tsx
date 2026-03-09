import { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SplatMesh } from "@sparkjsdev/spark";

interface SplatViewerProps {
  splatUrl: string;
  onScreenshot: (dataUrl: string) => void;
  height?: number;
}

export default function SplatViewer({
  splatUrl,
  onScreenshot,
  height = 500,
}: SplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const [isLoaded, setIsLoaded] = useState(false);
  const [fov, setFov] = useState(60);
  const [loadError, setLoadError] = useState<string>("");

  // Initialize Three.js scene + Spark SplatMesh
  useEffect(() => {
    if (!containerRef.current || !splatUrl) return;

    const container = containerRef.current;
    setIsLoaded(false);
    setLoadError("");

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / height,
      0.01,
      1000
    );
    camera.position.set(0, 0, 2);
    cameraRef.current = camera;

    // Renderer — preserveDrawingBuffer required for screenshots
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(container.clientWidth, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // OrbitControls for mouse orbit
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controls.minDistance = 0.1;
    controls.maxDistance = 50;
    controls.update();
    controlsRef.current = controls;

    // Load Gaussian Splat
    try {
      const splat = new SplatMesh({ url: splatUrl });
      // OpenCV convention rotation for World Labs splats
      splat.quaternion.set(1, 0, 0, 0);
      splat.position.set(0, 0, 0);
      scene.add(splat);

      // Poll for load completion since SplatMesh doesn't have a standard onLoad callback
      const loadCheckInterval = setInterval(() => {
        // SplatMesh is a THREE.Object3D — check if it has geometry/children loaded
        if (splat.visible && scene.children.length > 0) {
          setIsLoaded(true);
          clearInterval(loadCheckInterval);
        }
      }, 500);

      // Timeout after 60s
      const loadTimeout = setTimeout(() => {
        clearInterval(loadCheckInterval);
        if (!isLoaded) {
          setIsLoaded(true); // Show viewer anyway
        }
      }, 60000);

      // Animation loop
      const clock = clockRef.current;
      clock.start();

      renderer.setAnimationLoop(() => {
        const delta = clock.getDelta();
        const speed = 3.0 * delta;
        const keys = keysRef.current;

        // WASD movement
        if (keys.size > 0) {
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          forward.y = 0;
          forward.normalize();

          const right = new THREE.Vector3();
          right.crossVectors(forward, camera.up).normalize();

          if (keys.has("w")) {
            camera.position.addScaledVector(forward, speed);
            controls.target.addScaledVector(forward, speed);
          }
          if (keys.has("s")) {
            camera.position.addScaledVector(forward, -speed);
            controls.target.addScaledVector(forward, -speed);
          }
          if (keys.has("a")) {
            camera.position.addScaledVector(right, -speed);
            controls.target.addScaledVector(right, -speed);
          }
          if (keys.has("d")) {
            camera.position.addScaledVector(right, speed);
            controls.target.addScaledVector(right, speed);
          }
          // Q/E for vertical
          if (keys.has("q")) {
            camera.position.y -= speed;
            controls.target.y -= speed;
          }
          if (keys.has("e")) {
            camera.position.y += speed;
            controls.target.y += speed;
          }
        }

        controls.update();
        renderer.render(scene, camera);
      });

      // Resize handler
      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth;
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
        renderer.setSize(w, height);
      };
      window.addEventListener("resize", handleResize);

      // Cleanup
      return () => {
        clearInterval(loadCheckInterval);
        clearTimeout(loadTimeout);
        window.removeEventListener("resize", handleResize);
        renderer.setAnimationLoop(null);
        controls.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        sceneRef.current = null;
        cameraRef.current = null;
        rendererRef.current = null;
        controlsRef.current = null;
      };
    } catch (err: any) {
      setLoadError(err.message || "Failed to load 3D scene");
      return () => {
        renderer.dispose();
        renderer.forceContextLoss();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      };
    }
  }, [splatUrl, height]);

  // Keyboard listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d", "q", "e"].includes(key)) {
        e.preventDefault();
        keysRef.current.add(key);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      keysRef.current.clear();
    };
  }, []);

  const takeScreenshot = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
    const dataUrl = rendererRef.current.domElement.toDataURL("image/png");
    onScreenshot(dataUrl);
  }, [onScreenshot]);

  const handleFovChange = useCallback((newFov: number) => {
    setFov(newFov);
    if (cameraRef.current) {
      cameraRef.current.fov = newFov;
      cameraRef.current.updateProjectionMatrix();
    }
  }, []);

  const resetCamera = useCallback(() => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(0, 0, 2);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, []);

  return (
    <div className="space-y-3">
      {/* 3D viewport */}
      <div
        ref={containerRef}
        className="relative rounded-2xl overflow-hidden border-2 border-gray-200 dark:border-gray-700"
        style={{ height }}
        tabIndex={0}
      >
        {!isLoaded && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
            <div className="text-center text-white">
              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium">Loading 3D scene...</p>
              <p className="text-xs text-white/60 mt-1">This may take a moment</p>
            </div>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90 z-10">
            <div className="text-center text-white p-6">
              <p className="text-red-400 font-medium mb-2">Failed to load 3D scene</p>
              <p className="text-xs text-white/60">{loadError}</p>
            </div>
          </div>
        )}
        {/* Controls hint overlay */}
        <div className="absolute bottom-3 left-3 z-10 text-xs text-white/60 pointer-events-none bg-black/30 px-3 py-1.5 rounded-lg backdrop-blur-sm">
          Mouse: orbit | WASD: move | Q/E: up/down
        </div>
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={resetCamera}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 text-xs font-medium backdrop-blur-sm border border-white/20 transition-colors"
          >
            Reset View
          </button>
        </div>
      </div>

      {/* Camera controls bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">
            FOV
          </span>
          <input
            type="range"
            min={30}
            max={120}
            value={fov}
            onChange={(e) => handleFovChange(Number(e.target.value))}
            className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-teal-500"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">
            {fov}°
          </span>
        </div>
        <button
          onClick={takeScreenshot}
          disabled={!isLoaded}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold shadow-md hover:shadow-lg hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
        >
          Capture Screenshot
        </button>
      </div>
    </div>
  );
}
