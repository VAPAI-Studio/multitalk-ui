import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Label, Field, Section } from "../components/UI";
import { apiClient } from "../lib/apiClient";
import ResizableFeedSidebar from "../components/ResizableFeedSidebar";
import { useSmartResolution } from "../hooks/useSmartResolution";

type Tab = "edit" | "camera-angle";

// Camera Angle Definitions based on the Qwen-Image-Edit-2511-Multiple-Angles-LoRA model
const AZIMUTH_OPTIONS = [
  { value: 0, label: "front view", shortLabel: "Front" },
  { value: 45, label: "front-right quarter view", shortLabel: "Front-Right" },
  { value: 90, label: "right side view", shortLabel: "Right" },
  { value: 135, label: "back-right quarter view", shortLabel: "Back-Right" },
  { value: 180, label: "back view", shortLabel: "Back" },
  { value: 225, label: "back-left quarter view", shortLabel: "Back-Left" },
  { value: 270, label: "left side view", shortLabel: "Left" },
  { value: 315, label: "front-left quarter view", shortLabel: "Front-Left" },
];

const ELEVATION_OPTIONS = [
  { value: -30, label: "low-angle shot", shortLabel: "Low", description: "Camera below, looking up" },
  { value: 0, label: "eye-level shot", shortLabel: "Eye Level", description: "At object level" },
  { value: 30, label: "elevated shot", shortLabel: "Elevated", description: "Slightly above" },
  { value: 60, label: "high-angle shot", shortLabel: "High", description: "High, looking down" },
];

const DISTANCE_OPTIONS = [
  { value: 0.6, label: "close-up", shortLabel: "Close-up", description: "Emphasizes details" },
  { value: 1.0, label: "medium shot", shortLabel: "Medium", description: "Balanced framing" },
  { value: 1.4, label: "wide shot", shortLabel: "Wide", description: "Shows context" },
];

// Declare THREE as a global (loaded via CDN in index.html)
declare const THREE: any;

// 3D Camera Angle Selector Component with Three.js WebGL
interface CameraAngleSelectorProps {
  azimuth: number;
  elevation: number;
  distance: number;
  imageUrl?: string;
  onAzimuthChange: (value: number) => void;
  onElevationChange: (value: number) => void;
  onDistanceChange: (value: number) => void;
}

function CameraAngleSelector({
  azimuth,
  elevation,
  distance,
  imageUrl,
  onAzimuthChange,
  onElevationChange,
  onDistanceChange,
}: CameraAngleSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const animationFrameRef = useRef<number>(0);
  const orbitControlsRef = useRef<any>(null);

  // 3D objects refs
  const cameraModelRef = useRef<any>(null);
  const azimuthHandleRef = useRef<any>(null);
  const elevationHandleRef = useRef<any>(null);
  const distanceHandleRef = useRef<any>(null);
  const distanceLineRef = useRef<any>(null);
  const imagePlaneRef = useRef<any>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState<'azimuth' | 'elevation' | 'distance' | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const raycasterRef = useRef<any>(null);
  const mouseRef = useRef<any>(null);

  // Reset view function
  const resetView = useCallback(() => {
    if (cameraRef.current && orbitControlsRef.current) {
      cameraRef.current.position.set(0, 6, 8);
      cameraRef.current.lookAt(0, 0, 0);
      orbitControlsRef.current.target.set(0, 0, 0);
      orbitControlsRef.current.update();
    }
  }, []);

  // Snap values
  const AZIMUTH_VALUES = [0, 45, 90, 135, 180, 225, 270, 315];
  const ELEVATION_VALUES = [-30, 0, 30, 60];
  const DISTANCE_VALUES = [0.6, 1.0, 1.4]; // Must match DISTANCE_OPTIONS values

  // Get current labels
  const currentAzimuth = AZIMUTH_OPTIONS.find(a => a.value === azimuth);
  const currentElevation = ELEVATION_OPTIONS.find(e => e.value === elevation);
  const currentDistance = DISTANCE_OPTIONS.find(d => d.value === distance);

  // Helper: convert azimuth degrees to radians (adjust for Three.js coordinate system)
  const azimuthToRadians = useCallback((deg: number) => {
    return (deg * Math.PI) / 180;
  }, []);

  // Helper: convert elevation degrees to radians
  const elevationToRadians = useCallback((deg: number) => {
    return (deg * Math.PI) / 180;
  }, []);

  // Snap to nearest azimuth value
  const snapToAzimuth = useCallback((angle: number) => {
    const normalized = ((angle % 360) + 360) % 360;
    return AZIMUTH_VALUES.reduce((prev, curr) =>
      Math.abs(curr - normalized) < Math.abs(prev - normalized) ? curr : prev
    );
  }, []);

  // Snap to nearest elevation value
  const snapToElevation = useCallback((value: number) => {
    return ELEVATION_VALUES.reduce((prev, curr) =>
      Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
  }, []);

  // Snap to nearest distance value
  const snapToDistance = useCallback((value: number) => {
    return DISTANCE_VALUES.reduce((prev, curr) =>
      Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
  }, []);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current || typeof THREE === 'undefined') return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = 450;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Camera (viewing from above-front angle)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 6, 8);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit Controls - allows rotating the view by dragging
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 3;
    controls.maxDistance = 20;
    controls.maxPolarAngle = Math.PI * 0.9; // Prevent going below ground
    controls.target.set(0, 0, 0);
    orbitControlsRef.current = controls;

    // Raycaster and mouse
    raycasterRef.current = new THREE.Raycaster();
    mouseRef.current = new THREE.Vector2();

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // Grid floor
    const gridHelper = new THREE.GridHelper(8, 16, 0x444466, 0x333355);
    scene.add(gridHelper);

    // Target plane (image display or placeholder) - standing upright
    const planeGeometry = new THREE.PlaneGeometry(2, 2);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x4444ff,
      side: THREE.DoubleSide,
    });
    const imagePlane = new THREE.Mesh(planeGeometry, planeMaterial);
    // No rotation - plane stands upright facing the camera (default orientation)
    imagePlane.position.y = 0; // Centered on Y axis
    scene.add(imagePlane);
    imagePlaneRef.current = imagePlane;

    // Create placeholder smiley face texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffeb3b';
      ctx.beginPath();
      ctx.arc(128, 128, 100, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(90, 100, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(166, 100, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(128, 130, 50, 0.1 * Math.PI, 0.9 * Math.PI, false);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 8;
      ctx.stroke();
    }
    const placeholderTexture = new THREE.CanvasTexture(canvas);
    planeMaterial.map = placeholderTexture;
    planeMaterial.color = new THREE.Color(0xffffff);
    planeMaterial.needsUpdate = true;

    // Azimuth ring (green torus)
    const azimuthRingGeometry = new THREE.TorusGeometry(2.4, 0.03, 16, 100);
    const azimuthRingMaterial = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.6 });
    const azimuthRing = new THREE.Mesh(azimuthRingGeometry, azimuthRingMaterial);
    azimuthRing.rotation.x = Math.PI / 2;
    azimuthRing.position.y = 0.05;
    scene.add(azimuthRing);

    // Elevation arc (pink tube on the left, from -30° to 60°)
    const arcRadius = 2.4;
    const arcPoints = [];
    for (let i = 0; i <= 32; i++) {
      const angle = (-30 + (90 * i) / 32) * (Math.PI / 180);
      const y = arcRadius * Math.sin(angle);
      const z = arcRadius * Math.cos(angle);
      arcPoints.push(new THREE.Vector3(-2.6, y, z));
    }
    const elevationCurve = new THREE.CatmullRomCurve3(arcPoints);
    const elevationTubeGeometry = new THREE.TubeGeometry(elevationCurve, 32, 0.03, 8, false);
    const elevationTubeMaterial = new THREE.MeshBasicMaterial({ color: 0xec4899, transparent: true, opacity: 0.6 });
    const elevationTube = new THREE.Mesh(elevationTubeGeometry, elevationTubeMaterial);
    scene.add(elevationTube);

    // Camera model (blue box + cylinder lens)
    const cameraGroup = new THREE.Group();

    const cameraBodyGeometry = new THREE.BoxGeometry(0.3, 0.2, 0.15);
    const cameraBodyMaterial = new THREE.MeshPhongMaterial({ color: 0x3b82f6 });
    const cameraBody = new THREE.Mesh(cameraBodyGeometry, cameraBodyMaterial);
    cameraGroup.add(cameraBody);

    const cameraLensGeometry = new THREE.CylinderGeometry(0.06, 0.08, 0.1, 16);
    const cameraLensMaterial = new THREE.MeshPhongMaterial({ color: 0x1e40af });
    const cameraLens = new THREE.Mesh(cameraLensGeometry, cameraLensMaterial);
    cameraLens.rotation.x = Math.PI / 2;
    cameraLens.position.z = 0.12;
    cameraGroup.add(cameraLens);

    scene.add(cameraGroup);
    cameraModelRef.current = cameraGroup;

    // Distance line (orange)
    const distanceLineGeometry = new THREE.BufferGeometry();
    const distanceLineMaterial = new THREE.LineBasicMaterial({ color: 0xf97316 });
    const distanceLine = new THREE.Line(distanceLineGeometry, distanceLineMaterial);
    scene.add(distanceLine);
    distanceLineRef.current = distanceLine;

    // Azimuth handle (green sphere)
    const azimuthHandleGeometry = new THREE.SphereGeometry(0.15, 32, 32);
    const azimuthHandleMaterial = new THREE.MeshPhongMaterial({
      color: 0x22c55e,
      emissive: 0x115522,
    });
    const azimuthHandle = new THREE.Mesh(azimuthHandleGeometry, azimuthHandleMaterial);
    azimuthHandle.userData = { type: 'azimuth' };
    scene.add(azimuthHandle);
    azimuthHandleRef.current = azimuthHandle;

    // Elevation handle (pink sphere)
    const elevationHandleGeometry = new THREE.SphereGeometry(0.12, 32, 32);
    const elevationHandleMaterial = new THREE.MeshPhongMaterial({
      color: 0xec4899,
      emissive: 0x661144,
    });
    const elevationHandle = new THREE.Mesh(elevationHandleGeometry, elevationHandleMaterial);
    elevationHandle.userData = { type: 'elevation' };
    scene.add(elevationHandle);
    elevationHandleRef.current = elevationHandle;

    // Distance handle (orange sphere)
    const distanceHandleGeometry = new THREE.SphereGeometry(0.1, 32, 32);
    const distanceHandleMaterial = new THREE.MeshPhongMaterial({
      color: 0xf97316,
      emissive: 0x663311,
    });
    const distanceHandle = new THREE.Mesh(distanceHandleGeometry, distanceHandleMaterial);
    distanceHandle.userData = { type: 'distance' };
    scene.add(distanceHandle);
    distanceHandleRef.current = distanceHandle;

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      controls.update(); // Update orbit controls for damping
      renderer.render(scene, camera);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      camera.aspect = newWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, height);
    };
    window.addEventListener('resize', handleResize);

    // Track currently hovered handle for visual feedback
    let hoveredHandle: any = null;

    // Native pointer down handler (capturing phase - runs BEFORE OrbitControls)
    // This disables OrbitControls when clicking on handles, before OrbitControls processes the event
    const handleNativePointerDown = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // Only check azimuth and elevation handles (distance is controlled via overlay slider)
      const handles = [azimuthHandle, elevationHandle];
      const intersects = raycaster.intersectObjects(handles);

      if (intersects.length > 0) {
        // We hit a handle! Disable OrbitControls before it can start dragging
        controls.enabled = false;
      } else {
        // Not on a handle - make sure OrbitControls is enabled for orbiting
        controls.enabled = true;
      }
    };

    // Hover detection for visual feedback
    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // Only check azimuth and elevation handles
      const handles = [azimuthHandle, elevationHandle];
      const intersects = raycaster.intersectObjects(handles);

      // Reset previous hovered handle
      if (hoveredHandle && (!intersects.length || intersects[0].object !== hoveredHandle)) {
        hoveredHandle.scale.set(1, 1, 1);
        hoveredHandle.material.emissive.setHex(
          hoveredHandle === azimuthHandle ? 0x115522 : 0x661144
        );
        hoveredHandle = null;
        renderer.domElement.style.cursor = 'grab';
      }

      // Set new hovered handle
      if (intersects.length > 0) {
        const handle = intersects[0].object;
        if (handle !== hoveredHandle) {
          hoveredHandle = handle;
          handle.scale.set(1.3, 1.3, 1.3);
          handle.material.emissive.setHex(
            handle === azimuthHandle ? 0x33ff66 : 0xff66aa
          );
          renderer.domElement.style.cursor = 'pointer';
        }
      }
    };

    // Add listener in capturing phase (runs before OrbitControls' bubbling listener)
    renderer.domElement.addEventListener('pointerdown', handleNativePointerDown, { capture: true });
    renderer.domElement.addEventListener('mousemove', handleMouseMove);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handleNativePointerDown, { capture: true });
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameRef.current);
      if (orbitControlsRef.current) {
        orbitControlsRef.current.dispose();
      }
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Update camera model and handles positions when values change
  useEffect(() => {
    if (!cameraModelRef.current || !azimuthHandleRef.current || !elevationHandleRef.current) return;

    const azimuthRad = azimuthToRadians(azimuth);
    const elevationRad = elevationToRadians(elevation);
    const distanceVal = distance * 2; // Scale for visibility - camera MOVES with distance

    // Position camera model based on azimuth, elevation, AND distance
    const camX = distanceVal * Math.cos(elevationRad) * Math.sin(azimuthRad);
    const camY = distanceVal * Math.sin(elevationRad);
    const camZ = distanceVal * Math.cos(elevationRad) * Math.cos(azimuthRad);

    cameraModelRef.current.position.set(camX, camY, camZ);
    cameraModelRef.current.lookAt(0, 0, 0);

    // Position azimuth handle on the torus ring
    const azimuthHandleX = 2.4 * Math.sin(azimuthRad);
    const azimuthHandleZ = 2.4 * Math.cos(azimuthRad);
    azimuthHandleRef.current.position.set(azimuthHandleX, 0.05, azimuthHandleZ);

    // Position elevation handle on the arc
    const elevationHandleY = 2.4 * Math.sin(elevationRad);
    const elevationHandleZ = 2.4 * Math.cos(elevationRad);
    elevationHandleRef.current.position.set(-2.6, elevationHandleY, elevationHandleZ);

    // Hide the distance handle and line (distance is now controlled via overlay slider)
    if (distanceHandleRef.current) {
      distanceHandleRef.current.visible = false;
    }
    if (distanceLineRef.current) {
      distanceLineRef.current.visible = false;
    }
  }, [azimuth, elevation, distance, azimuthToRadians, elevationToRadians]);

  // Update image texture when imageUrl changes
  useEffect(() => {
    if (!imagePlaneRef.current || !imageUrl) return;

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(imageUrl, (texture: any) => {
      imagePlaneRef.current.material.map = texture;
      imagePlaneRef.current.material.needsUpdate = true;

      // Adjust plane aspect ratio
      const aspect = texture.image.width / texture.image.height;
      if (aspect > 1) {
        imagePlaneRef.current.scale.set(2, 2 / aspect, 1);
      } else {
        imagePlaneRef.current.scale.set(2 * aspect, 2, 1);
      }
    });
  }, [imageUrl]);

  // Mouse/touch event handlers
  const getIntersects = useCallback((event: MouseEvent | TouchEvent) => {
    if (!containerRef.current || !raycasterRef.current || !cameraRef.current) return [];

    const rect = containerRef.current.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in event) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    mouseRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    const handles = [azimuthHandleRef.current, elevationHandleRef.current, distanceHandleRef.current].filter(Boolean);
    return raycasterRef.current.intersectObjects(handles);
  }, []);

  const handlePointerDown = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    const nativeEvent = event.nativeEvent as MouseEvent | TouchEvent;
    const intersects = getIntersects(nativeEvent);

    if (intersects.length > 0) {
      const handle = intersects[0].object;
      const handleType = handle.userData.type;

      setIsDragging(handleType);

      // Disable orbit controls while dragging handles
      if (orbitControlsRef.current) {
        orbitControlsRef.current.enabled = false;
      }

      // Scale up handle
      handle.scale.set(1.3, 1.3, 1.3);
      handle.material.emissiveIntensity = 2;

      let clientX, clientY;
      if ('touches' in nativeEvent) {
        clientX = nativeEvent.touches[0].clientX;
        clientY = nativeEvent.touches[0].clientY;
      } else {
        clientX = nativeEvent.clientX;
        clientY = nativeEvent.clientY;
      }
      dragStartRef.current = { x: clientX, y: clientY };
    }
  }, [getIntersects]);

  const handlePointerMove = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || !containerRef.current || !raycasterRef.current || !cameraRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    let clientX, clientY;

    const nativeEvent = event.nativeEvent as MouseEvent | TouchEvent;
    if ('touches' in nativeEvent) {
      clientX = nativeEvent.touches[0].clientX;
      clientY = nativeEvent.touches[0].clientY;
    } else {
      clientX = nativeEvent.clientX;
      clientY = nativeEvent.clientY;
    }

    // Update mouse coordinates for raycasting
    mouseRef.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    if (isDragging === 'azimuth') {
      // Raycast against horizontal plane at y=0.05 (where azimuth ring is)
      const horizontalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
      const intersectPoint = new THREE.Vector3();
      raycasterRef.current.ray.intersectPlane(horizontalPlane, intersectPoint);

      if (intersectPoint) {
        // Calculate angle from intersect point
        let angle = Math.atan2(intersectPoint.x, intersectPoint.z) * (180 / Math.PI);
        angle = ((angle % 360) + 360) % 360;
        onAzimuthChange(Math.round(angle / 45) * 45);
      }
    } else if (isDragging === 'elevation') {
      // Raycast against vertical plane at x=-2.6 (where elevation arc is)
      const verticalPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 2.6);
      const intersectPoint = new THREE.Vector3();
      raycasterRef.current.ray.intersectPlane(verticalPlane, intersectPoint);

      if (intersectPoint) {
        // Calculate elevation from y and z coordinates
        const angle = Math.atan2(intersectPoint.y, intersectPoint.z) * (180 / Math.PI);
        const clamped = Math.max(-30, Math.min(60, angle));
        onElevationChange(snapToElevation(clamped));
      }
    } else if (isDragging === 'distance' && cameraModelRef.current) {
      // Get camera model position (the direction from center)
      const cameraPos = cameraModelRef.current.position.clone();
      const cameraDir = cameraPos.clone().normalize();
      const cameraLength = cameraPos.length(); // This is 2.8 (fixed max distance)

      // Create a plane that contains the distance line and faces the view camera
      // The plane normal is perpendicular to both the camera direction and the view direction
      const viewDir = new THREE.Vector3();
      cameraRef.current.getWorldDirection(viewDir);

      // Cross product gives us a vector perpendicular to both
      const planeNormal = new THREE.Vector3().crossVectors(cameraDir, viewDir).normalize();

      // If the cross product is too small (camera looking along the line), use a fallback
      if (planeNormal.length() < 0.1) {
        planeNormal.set(0, 1, 0).cross(cameraDir).normalize();
      }

      // Create plane through origin with this normal
      const dragPlane = new THREE.Plane(planeNormal, 0);
      const intersectPoint = new THREE.Vector3();
      raycasterRef.current.ray.intersectPlane(dragPlane, intersectPoint);

      if (intersectPoint) {
        // Project the intersection point onto the camera direction line
        // dot product gives us how far along the line the point is
        const projectedDistance = intersectPoint.dot(cameraDir);

        // Convert to percentage along the line (0 to 1)
        const percentAlongLine = projectedDistance / cameraLength;

        // Snap to one of 3 positions:
        // < 0.44 = close-up (0.6)
        // 0.44 - 0.66 = medium (1.0)
        // > 0.66 = wide (1.4)
        let newDistance: number;
        if (percentAlongLine < 0.44) {
          newDistance = 0.6;
        } else if (percentAlongLine < 0.66) {
          newDistance = 1.0;
        } else {
          newDistance = 1.4;
        }
        onDistanceChange(newDistance);
      }
    }
  }, [isDragging, onAzimuthChange, onElevationChange, onDistanceChange, snapToElevation, snapToDistance]);

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      // Reset handle scale
      const handleRef = isDragging === 'azimuth' ? azimuthHandleRef :
                        isDragging === 'elevation' ? elevationHandleRef :
                        distanceHandleRef;

      if (handleRef.current) {
        handleRef.current.scale.set(1, 1, 1);
        handleRef.current.material.emissiveIntensity = 1;
      }

      // Snap to nearest value
      if (isDragging === 'azimuth') {
        onAzimuthChange(snapToAzimuth(azimuth));
      } else if (isDragging === 'elevation') {
        onElevationChange(snapToElevation(elevation));
      } else if (isDragging === 'distance') {
        onDistanceChange(snapToDistance(distance));
      }
    }

    // Re-enable orbit controls
    if (orbitControlsRef.current) {
      orbitControlsRef.current.enabled = true;
    }

    setIsDragging(null);
    dragStartRef.current = null;
  }, [isDragging, azimuth, elevation, distance, onAzimuthChange, onElevationChange, onDistanceChange, snapToAzimuth, snapToElevation, snapToDistance]);

  // Add window event listeners for drag
  useEffect(() => {
    if (isDragging) {
      const handleWindowPointerMove = (e: MouseEvent | TouchEvent) => {
        handlePointerMove({ nativeEvent: e } as any);
      };
      const handleWindowPointerUp = () => {
        handlePointerUp();
      };

      window.addEventListener('mousemove', handleWindowPointerMove);
      window.addEventListener('mouseup', handleWindowPointerUp);
      window.addEventListener('touchmove', handleWindowPointerMove);
      window.addEventListener('touchend', handleWindowPointerUp);

      return () => {
        window.removeEventListener('mousemove', handleWindowPointerMove);
        window.removeEventListener('mouseup', handleWindowPointerUp);
        window.removeEventListener('touchmove', handleWindowPointerMove);
        window.removeEventListener('touchend', handleWindowPointerUp);
      };
    }
  }, [isDragging, handlePointerMove, handlePointerUp]);

  return (
    <div className="space-y-6">
      {/* Three.js 3D Visualization */}
      <div
        ref={containerRef}
        className="relative rounded-3xl overflow-hidden select-none cursor-grab active:cursor-grabbing"
        style={{ height: '450px' }}
        onMouseDown={handlePointerDown}
        onTouchStart={handlePointerDown}
      >
        {/* Overlay instructions and reset button */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-between pointer-events-none">
          <div className="text-xs text-white/70 flex-1">
            Drag handles: <span className="text-green-400 font-semibold">green</span> = rotation •{' '}
            <span className="text-pink-400 font-semibold">pink</span> = elevation
            <br />
            <span className="text-white/50">Drag empty space to orbit the view</span>
          </div>
          <button
            onClick={resetView}
            className="pointer-events-auto px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium transition-all duration-200 backdrop-blur-sm border border-white/20"
          >
            Reset View
          </button>
        </div>

        {/* Shot Type Slider Overlay */}
        <div className="absolute bottom-16 left-4 right-4 z-10 pointer-events-auto">
          <div className="bg-black/40 backdrop-blur-md rounded-2xl px-4 py-3 border border-white/10">
            <div className="flex items-center gap-4">
              <span className="text-orange-400 text-xs font-semibold whitespace-nowrap">Shot Type</span>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-white/60 text-[10px]">Close</span>
                <input
                  type="range"
                  min="0.6"
                  max="1.4"
                  step="0.4"
                  value={distance}
                  onChange={(e) => onDistanceChange(parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <span className="text-white/60 text-[10px]">Wide</span>
              </div>
              <span className="text-orange-300 text-xs bg-orange-500/30 px-2 py-0.5 rounded-full border border-orange-500/50 min-w-[70px] text-center">
                {currentDistance?.shortLabel || "Medium"}
              </span>
            </div>
          </div>
        </div>

        {/* Current values display */}
        <div className="absolute bottom-4 left-4 right-4 z-10 flex justify-center gap-3 text-xs pointer-events-none">
          <span className="bg-green-500/30 text-green-300 px-3 py-1 rounded-full border border-green-500/50 backdrop-blur-sm">
            {currentAzimuth?.shortLabel || "Front"}
          </span>
          <span className="bg-pink-500/30 text-pink-300 px-3 py-1 rounded-full border border-pink-500/50 backdrop-blur-sm">
            {currentElevation?.shortLabel || "Eye Level"}
          </span>
          <span className="bg-orange-500/30 text-orange-300 px-3 py-1 rounded-full border border-orange-500/50 backdrop-blur-sm">
            {currentDistance?.shortLabel || "Medium"}
          </span>
        </div>
      </div>

      {/* Shot Type Buttons */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-gradient-to-r from-orange-400 to-amber-500"></span>
            Shot Type
          </Label>
          <span className="text-sm font-medium text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
            {currentDistance?.label || "medium shot"}
          </span>
        </div>
        <div className="flex gap-2">
          {DISTANCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => onDistanceChange(option.value)}
              className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                distance === option.value
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md scale-105"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <div className="font-semibold">{option.shortLabel}</div>
              <div className="text-xs opacity-75">{option.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Props {
  comfyUrl?: string;
}

export default function ImageEdit({ comfyUrl = "" }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("edit");

  // Original Image Edit State
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [editedImageUrl, setEditedImageUrl] = useState<string>("");
  const [originalImageUrl, setOriginalImageUrl] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isConfigured, setIsConfigured] = useState<boolean>(false);

  // Camera Angle State
  const [cameraImage, setCameraImage] = useState<File | null>(null);
  const [cameraImagePreview, setCameraImagePreview] = useState<string>("");
  const [isCameraGenerating, setIsCameraGenerating] = useState<boolean>(false);
  const [cameraStatus, setCameraStatus] = useState<string>("");
  const [cameraResultUrl, setCameraResultUrl] = useState<string>("");
  const [cameraJobId, setCameraJobId] = useState<string>("");

  // Camera Angle Selector State (new 3D UI)
  const [azimuth, setAzimuth] = useState<number>(0); // 0 = front view
  const [elevation, setElevation] = useState<number>(0); // 0 = eye level
  const [distance, setDistance] = useState<number>(1.0); // 1.0 = medium shot

  // Build the camera angle prompt from selector values
  const buildCameraPrompt = useMemo(() => {
    const azimuthOption = AZIMUTH_OPTIONS.find(a => a.value === azimuth);
    const elevationOption = ELEVATION_OPTIONS.find(e => e.value === elevation);
    const distanceOption = DISTANCE_OPTIONS.find(d => d.value === distance);

    const azimuthLabel = azimuthOption?.label || "front view";
    const elevationLabel = elevationOption?.label || "eye-level shot";
    const distanceLabel = distanceOption?.label || "medium shot";

    return `<sks> ${azimuthLabel} ${elevationLabel} ${distanceLabel}`;
  }, [azimuth, elevation, distance]);

  const {
    width,
    height,
    widthInput,
    heightInput,
    handleWidthChange,
    handleHeightChange,
    setWidth,
    setHeight
  } = useSmartResolution(1280, 720);

  // Aspect ratio lock state
  const [aspectRatioLocked, setAspectRatioLocked] = useState<boolean>(true);
  const [aspectRatio, setAspectRatio] = useState<number>(1280 / 720);

  // Check OpenRouter configuration on component mount
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const response = await apiClient.checkOpenRouterConfig() as any;
        setIsConfigured(response.configured);
      } catch (error) {
        console.error('Failed to check OpenRouter config:', error);
        setIsConfigured(false);
      }
    };
    checkConfig();
  }, []);

  // Original Image Edit Handlers
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError("Please select a valid image file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setOriginalImageUrl(result);
      setError("");
    };
    reader.readAsDataURL(file);
  };

  const editImage = async () => {
    if (!userPrompt.trim()) {
      setError("Please enter edit instructions");
      return;
    }

    if (!originalImageUrl) {
      setError("Please upload an image to edit");
      return;
    }

    if (!isConfigured) {
      setError("OpenRouter API key is not configured on the backend");
      return;
    }

    setIsGenerating(true);
    setError("");
    setEditedImageUrl("");

    try {
      const response = await apiClient.editImage(originalImageUrl, userPrompt) as any;

      if (response.success && response.image_url) {
        setEditedImageUrl(response.image_url);
      } else {
        throw new Error(response.error || "No edited image received");
      }

    } catch (err: any) {
      setError(err.message || "Failed to edit image");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      editImage();
    }
  };

  // Camera Angle Handlers
  const handleWidthChangeWithAspectRatio = (value: string) => {
    handleWidthChange(value);

    if (aspectRatioLocked && aspectRatio > 0) {
      const numericWidth = parseInt(value) || 32;
      const calculatedHeight = Math.round(numericWidth / aspectRatio);
      const roundedHeight = Math.round(calculatedHeight / 32) * 32;
      setHeight(roundedHeight);
    }
  };

  const handleHeightChangeWithAspectRatio = (value: string) => {
    handleHeightChange(value);

    if (aspectRatioLocked && aspectRatio > 0) {
      const numericHeight = parseInt(value) || 32;
      const calculatedWidth = Math.round(numericHeight * aspectRatio);
      const roundedWidth = Math.round(calculatedWidth / 32) * 32;
      setWidth(roundedWidth);
    }
  };

  const toggleAspectRatioLock = () => {
    const newLockState = !aspectRatioLocked;
    setAspectRatioLocked(newLockState);

    // When locking, update aspect ratio to current dimensions
    if (newLockState && width > 0 && height > 0) {
      setAspectRatio(width / height);
    }
  };

  const handleCameraImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setCameraStatus("❌ Please select a valid image file");
      return;
    }

    setCameraImage(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setCameraImagePreview(result);
      setCameraStatus("");

      // Automatically set width and height based on image dimensions
      const img = new Image();
      img.onload = () => {
        // Round to nearest multiple of 32 for compatibility
        const roundedWidth = Math.round(img.width / 32) * 32;
        const roundedHeight = Math.round(img.height / 32) * 32;
        setWidth(roundedWidth);
        setHeight(roundedHeight);
        // Update aspect ratio for locked mode
        setAspectRatio(roundedWidth / roundedHeight);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  const generateCameraAngle = async () => {
    if (!cameraImage) {
      setCameraStatus("Please upload an image");
      return;
    }

    if (!comfyUrl) {
      setCameraStatus("ComfyUI URL is not configured");
      return;
    }

    // Generate a random seed
    const seed = Math.floor(Math.random() * 9999999999999);

    setIsCameraGenerating(true);
    setCameraStatus("Uploading image...");
    setCameraResultUrl("");
    setCameraJobId("");

    let databaseJobId: string | null = null;

    try {
      // Upload image to ComfyUI
      const uploadFormData = new FormData();
      uploadFormData.append('image', cameraImage);
      const uploadResponse = await fetch(`${comfyUrl}/upload/image`, {
        method: 'POST',
        body: uploadFormData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload image to ComfyUI: ${uploadResponse.status}`);
      }

      const uploadData = await uploadResponse.json();
      const uploadedFilename = uploadData.name || cameraImage.name;

      setCameraStatus("Building workflow...");

      // Build workflow using the new QwenMultipleAngles2511 template
      const clientId = `camera-angle-${Math.random().toString(36).slice(2)}`;
      const workflowResponse = await apiClient.submitWorkflow(
        'QwenMultipleAngles2511',
        {
          IMAGE_FILENAME: uploadedFilename,
          PROMPT: buildCameraPrompt,
          SEED: seed
        },
        comfyUrl,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string };

      if (!workflowResponse.success || !workflowResponse.prompt_id) {
        throw new Error(workflowResponse.error || 'Failed to submit workflow to ComfyUI');
      }

      const promptId = workflowResponse.prompt_id;
      setCameraJobId(promptId);

      setCameraStatus("Creating job record...");

      // Create image job in database
      const jobCreationResponse = await apiClient.createImageJob({
        comfy_job_id: promptId,
        workflow_name: 'multi-camera-angle',
        comfy_url: comfyUrl,
        input_image_urls: [uploadedFilename],
        width,
        height,
        parameters: {
          prompt: buildCameraPrompt,
          azimuth,
          elevation,
          distance,
          seed
        }
      }) as any;

      if (!jobCreationResponse.success || !jobCreationResponse.image_job?.id) {
        throw new Error('Failed to create job record in database');
      }

      databaseJobId = jobCreationResponse.image_job.id;

      setCameraStatus("⏳ Processing in ComfyUI...");

      // 5. Poll for completion
      const startTime = Date.now();
      const maxWaitTime = 300000; // 5 minutes

      const pollForResult = async (): Promise<void> => {
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          throw new Error('Processing timeout after 5 minutes');
        }

        try {
          const historyResponse = await apiClient.getComfyUIHistory(comfyUrl, promptId) as {
            success: boolean;
            history?: any;
            error?: string;
          };

          if (!historyResponse.success) {
            throw new Error(historyResponse.error || 'Failed to get ComfyUI history');
          }

          const history = historyResponse.history;
          const historyEntry = history?.[promptId];

          // Check for errors
          if (historyEntry?.status?.status_str === "error" || historyEntry?.status?.error) {
            const errorMsg = historyEntry.status?.error?.message ||
                            historyEntry.status?.error ||
                            "Unknown error in ComfyUI";
            throw new Error(`ComfyUI error: ${errorMsg}`);
          }

          // Check if completed
          if (historyEntry?.status?.status_str === "success" || historyEntry?.outputs) {
            const outputs = historyEntry.outputs;
            let imageInfo = null;

            // Find the generated image
            for (const nodeId in outputs) {
              const nodeOutputs = outputs[nodeId];
              if (nodeOutputs.images && nodeOutputs.images.length > 0) {
                imageInfo = nodeOutputs.images[0];
                break;
              }
            }

            if (imageInfo) {
              // Construct the ComfyUI view URL
              const comfyImageUrl = imageInfo.subfolder
                ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=output`
                : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&type=output`;

              setCameraStatus("💾 Saving image to storage...");

              // Complete job - backend will download from ComfyUI and upload to Supabase
              if (!databaseJobId) {
                throw new Error('Database job ID is missing');
              }

              const completionResult = await apiClient.completeImageJob(databaseJobId, {
                job_id: databaseJobId,
                status: 'completed',
                output_image_urls: [comfyImageUrl] // Pass ComfyUI URL, backend handles storage upload
              }) as any;

              if (!completionResult.success || !completionResult.image_job?.output_image_urls?.[0]) {
                throw new Error('Failed to save image to storage');
              }

              const storedImageUrl = completionResult.image_job.output_image_urls[0];

              setCameraResultUrl(storedImageUrl);
              setCameraStatus("✅ Camera angle generated successfully!");
              setIsCameraGenerating(false);
              return; // STOP POLLING - job is complete!
            }
          }

          // Still processing, poll again
          await new Promise(resolve => setTimeout(resolve, 2000));
          return pollForResult();

        } catch (pollError: any) {
          // If it's a timeout or completion error, rethrow (don't retry)
          if (pollError.message.includes('timeout') || pollError.message.includes('save image')) {
            throw pollError;
          }
          // Only retry on transient ComfyUI history fetch errors
          await new Promise(resolve => setTimeout(resolve, 2000));
          return pollForResult();
        }
      };

      await pollForResult();

    } catch (err: any) {
      setCameraStatus(`❌ Error: ${err.message || "Unknown error"}`);
      if (databaseJobId) {
        await apiClient.completeImageJob(databaseJobId, {
          job_id: databaseJobId,
          status: 'error',
          error_message: err.message || 'Unknown error'
        }).catch(() => {});
      }
    } finally {
      setIsCameraGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent">
              Image Edit
            </h1>
            <div className="text-lg md:text-xl font-medium text-gray-700">
              <span className="bg-gradient-to-r from-purple-100 to-pink-100 px-4 py-2 rounded-full border border-purple-200/50">
                AI Image Generation
              </span>
            </div>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
              Upload an image and edit it using AI-powered image editing technology.
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 p-2 bg-white/80 rounded-2xl border border-gray-200 shadow-sm">
            <button
              onClick={() => setActiveTab("edit")}
              className={`flex-1 px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                activeTab === "edit"
                  ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <span>✨</span>
                <span>AI Edit</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab("camera-angle")}
              className={`flex-1 px-6 py-3 rounded-xl font-semibold transition-all duration-200 ${
                activeTab === "camera-angle"
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <span>📷</span>
                <span>Change Camera Angle</span>
              </span>
            </button>
          </div>

          {/* AI Edit Tab Content */}
          {activeTab === "edit" && (
            <>
              <Section title="Edit Image">
                <div className="space-y-6">
                  <Field>
                    <Label>Upload Image to Edit</Label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="w-full rounded-2xl border-2 border-gray-200 dark:border-dark-border-primary px-4 py-3 text-gray-800 dark:text-dark-text-primary focus:border-purple-500 focus:ring-2 focus:ring-purple-100 dark:focus:ring-purple-900/30 transition-all duration-200 bg-white/80 dark:bg-dark-surface-secondary file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-purple-50 dark:file:bg-purple-900/30 file:text-purple-700 dark:file:text-purple-300 hover:file:bg-purple-100 dark:hover:file:bg-purple-900/50"
                    />
                    {originalImageUrl && (
                      <div className="mt-4">
                        <img
                          src={originalImageUrl}
                          alt="Original image"
                          className="w-full max-w-md mx-auto rounded-xl shadow-lg border border-purple-200"
                        />
                        <p className="text-sm text-purple-600 text-center mt-2">Original image loaded</p>
                      </div>
                    )}
                  </Field>

                  <Field>
                    <Label>Edit Instructions</Label>
                    <textarea
                      rows={4}
                      className="w-full rounded-2xl border-2 border-gray-200 dark:border-dark-border-primary px-4 py-3 text-gray-800 dark:text-dark-text-primary focus:border-purple-500 focus:ring-4 focus:ring-purple-100 dark:focus:ring-purple-900/30 transition-all duration-200 bg-white/80 dark:bg-dark-surface-secondary resize-vertical"
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      onKeyDown={handleKeyPress}
                      placeholder="Describe how to edit the image... (e.g., 'Remove the background and add a sunset sky')"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Press Enter to edit, or Shift+Enter for new line
                    </p>
                  </Field>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={editImage}
                      disabled={isGenerating || !userPrompt.trim() || !originalImageUrl || !isConfigured}
                      className="px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg shadow-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                    >
                      {isGenerating ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Editing Image...
                        </>
                      ) : (
                        <>
                          <span>✨</span>
                          Edit Image
                        </>
                      )}
                    </button>
                  </div>

                  {error && (
                    <div className="p-4 rounded-2xl bg-red-50 border border-red-200">
                      <div className="flex items-center gap-2 text-red-800">
                        <span>❌</span>
                        <span className="font-medium">Error</span>
                      </div>
                      <p className="text-red-600 mt-1">{error}</p>
                    </div>
                  )}

                  {editedImageUrl && (
                    <div className="space-y-4">
                      <div className="p-6 rounded-2xl bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border border-purple-200 dark:border-purple-800">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2 text-purple-800">
                            <span>✨</span>
                            <span className="font-medium">Edited Image</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const link = document.createElement('a');
                                link.href = editedImageUrl;
                                link.download = `edited-image-${Date.now()}.png`;
                                link.click();
                              }}
                              className="px-4 py-2 rounded-xl bg-white text-purple-700 hover:bg-purple-50 font-medium text-sm transition-all duration-200 border border-purple-200"
                            >
                              Download
                            </button>
                          </div>
                        </div>
                        <img
                          src={editedImageUrl}
                          alt="Edited image"
                          className="w-full rounded-xl shadow-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </Section>

              {!isConfigured && (
                <Section title="API Configuration">
                  <div className="p-4 rounded-2xl bg-yellow-50 border border-yellow-200">
                    <div className="flex items-center gap-2 text-yellow-800 mb-2">
                      <span>⚠️</span>
                      <span className="font-medium">OpenRouter API Key Required</span>
                    </div>
                    <p className="text-yellow-700 text-sm">
                      To use image editing, you need to configure your OpenRouter API key on the backend.
                      Get one at <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="underline">openrouter.ai</a>
                      <br /><br />
                      Set <code className="bg-yellow-200 px-1 rounded">OPENROUTER_API_KEY</code> environment variable in your backend .env file
                    </p>
                  </div>
                </Section>
              )}
            </>
          )}

          {/* Camera Angle Tab Content */}
          {activeTab === "camera-angle" && (
            <>
              <Section title="Input">
                <Field>
                  <Label>Upload Image</Label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleCameraImageUpload}
                    className="w-full rounded-2xl border-2 border-dashed border-gray-300 dark:border-dark-border-primary px-4 py-6 text-gray-600 dark:text-dark-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50 dark:bg-dark-surface-secondary"
                  />
                  {cameraImagePreview && (
                    <div className="mt-4">
                      <img
                        src={cameraImagePreview}
                        alt="Camera input"
                        className="w-full max-w-md mx-auto rounded-xl shadow-lg border border-blue-200"
                      />
                      <p className="text-sm text-blue-600 text-center mt-2">✓ Image loaded</p>
                    </div>
                  )}
                </Field>
              </Section>

              <Section title="Camera Angle">
                <CameraAngleSelector
                  azimuth={azimuth}
                  elevation={elevation}
                  distance={distance}
                  imageUrl={cameraImagePreview}
                  onAzimuthChange={setAzimuth}
                  onElevationChange={setElevation}
                  onDistanceChange={setDistance}
                />

                {/* Generated Prompt Preview */}
                <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl border border-blue-200/50">
                  <Label className="text-sm font-semibold text-gray-700 mb-2">Generated Prompt</Label>
                  <code className="block text-sm font-mono text-purple-700 bg-white/80 px-4 py-2 rounded-xl">
                    {buildCameraPrompt}
                  </code>
                </div>
              </Section>

              <Section title="Resolution">
                {/* Aspect Ratio Lock Toggle */}
                <div className="mb-4 flex items-center gap-3">
                  <button
                    onClick={toggleAspectRatioLock}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-200 ${
                      aspectRatioLocked
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="text-lg">{aspectRatioLocked ? '🔒' : '🔓'}</span>
                    <span>Maintain Aspect Ratio</span>
                  </button>
                  {aspectRatioLocked && aspectRatio > 0 && (
                    <span className="text-xs text-gray-500">
                      ({aspectRatio.toFixed(2)}:1)
                    </span>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <Field>
                    <Label>Width (px)</Label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border-2 border-gray-200 dark:border-dark-border-primary px-4 py-3 text-gray-800 dark:text-dark-text-primary focus:border-purple-500 focus:ring-4 focus:ring-purple-100 dark:focus:ring-purple-900/30 transition-all duration-200 bg-white/80 dark:bg-dark-surface-secondary"
                      value={widthInput}
                      onChange={(e) => handleWidthChangeWithAspectRatio(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <Label>Height (px)</Label>
                    <input
                      type="number"
                      className="w-full rounded-2xl border-2 border-gray-200 dark:border-dark-border-primary px-4 py-3 text-gray-800 dark:text-dark-text-primary focus:border-purple-500 focus:ring-4 focus:ring-purple-100 dark:focus:ring-purple-900/30 transition-all duration-200 bg-white/80 dark:bg-dark-surface-secondary"
                      value={heightInput}
                      onChange={(e) => handleHeightChangeWithAspectRatio(e.target.value)}
                    />
                  </Field>
                </div>
                <p className="text-xs text-gray-500 mt-3">Auto-corrected to multiples of 32</p>
              </Section>

              <Section title="Generate">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                    onClick={generateCameraAngle}
                    disabled={isCameraGenerating || !cameraImage}
                  >
                    {isCameraGenerating ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Processing…
                      </>
                    ) : (
                      <>
                        <span>📷</span>
                        Generate
                      </>
                    )}
                  </button>
                  {cameraJobId && <span className="text-xs text-gray-500">Job ID: {cameraJobId}</span>}
                  {cameraStatus && <span className="text-sm">{cameraStatus}</span>}
                </div>

                {cameraResultUrl && (
                  <div className="mt-6 space-y-3">
                    <img src={cameraResultUrl} alt="Result" className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                    <div>
                      <button
                        className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = cameraResultUrl;
                          a.download = `camera-angle-${Date.now()}.png`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        }}
                      >
                        <span>⬇️</span>
                        Download
                      </button>
                    </div>
                  </div>
                )}
              </Section>
            </>
          )}
        </div>

        {/* Right Sidebar - Resizable Feed */}
        <ResizableFeedSidebar
          storageKey="image-edit"
          config={{
            mediaType: 'all',
            pageContext: ['image-edit', 'multi-camera-angle'],
            showCompletedOnly: false,
            maxItems: 10,
            showFixButton: true,
            showProgress: true,
            comfyUrl: comfyUrl
          }}
        />
      </div>
    </div>
  );
}
