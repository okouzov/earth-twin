import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const EARTH_RADIUS = 1;
const ORBIT_MIN_DISTANCE = 1.26;
const ORBIT_MAX_DISTANCE = 8.5;
const MAP_PRELOAD_DISTANCE = 2.05;
const MAP_ENTRY_DISTANCE = 1.5;
const MAP_EXIT_ZOOM = 5.8;
const SURFACE_DEFAULT_ZOOM = 12.2;
const SURFACE_DEFAULT_PITCH = 72;
const TEX_BASE =
  "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/";

const TEXTURE_URLS = {
  day: `${TEX_BASE}earth_day_4096.jpg`,
  night: `${TEX_BASE}earth_night_4096.jpg`,
  lights: `${TEX_BASE}earth_lights_2048.png`,
  clouds: `${TEX_BASE}earth_clouds_1024.png`,
  normal: `${TEX_BASE}earth_normal_2048.jpg`,
  specular: `${TEX_BASE}earth_specular_2048.jpg`,
};

const CITY_PRESETS = [
  { id: "new-york", label: "New York", lat: 40.7128, lon: -74.006, orbitDistance: 2.55 },
  { id: "tokyo", label: "Tokyo", lat: 35.6762, lon: 139.6503, orbitDistance: 2.7 },
  { id: "paris", label: "Paris", lat: 48.8566, lon: 2.3522, orbitDistance: 2.45 },
  { id: "dubai", label: "Dubai", lat: 25.2048, lon: 55.2708, orbitDistance: 2.55 },
  { id: "rio", label: "Rio de Janeiro", lat: -22.9068, lon: -43.1729, orbitDistance: 2.5 },
  { id: "cape-town", label: "Cape Town", lat: -33.9249, lon: 18.4241, orbitDistance: 2.55 },
  { id: "sofia", label: "Sofia", lat: 42.6977, lon: 23.3219, orbitDistance: 2.42 },
  { id: "plovdiv", label: "Plovdiv", lat: 42.1354, lon: 24.7453, orbitDistance: 2.38 },
  { id: "varna", label: "Varna", lat: 43.2141, lon: 27.9147, orbitDistance: 2.38 },
];

const elements = {
  globeStage: document.querySelector("#globe-stage"),
  mapStage: document.querySelector("#map-stage"),
  loadingScreen: document.querySelector("#loading-screen"),
  loadingCopy: document.querySelector("#loading-copy"),
  viewLabel: document.querySelector("#view-label"),
  focusLabel: document.querySelector("#focus-label"),
  hintCopy: document.querySelector("#hint-copy"),
  searchForm: document.querySelector("#search-form"),
  citySearch: document.querySelector("#city-search"),
  cloudToggle: document.querySelector("#cloud-toggle"),
  atmosphereToggle: document.querySelector("#atmosphere-toggle"),
  nightToggle: document.querySelector("#night-toggle"),
  audioToggle: document.querySelector("#audio-toggle"),
  cityButtons: Array.from(document.querySelectorAll(".city-chip")),
  returnOrbit: document.querySelector("#return-orbit"),
};

const state = {
  view: "orbital",
  clouds: true,
  atmosphere: true,
  night: false,
  audio: true,
  lastSoundAt: 0,
  map: null,
  mapReady: false,
  mapBootPromise: null,
  transitioning: false,
  focus: { lat: 0, lon: -28, label: "Atlantic Ocean" },
  searchResult: null,
  lastOrbitalDistance: ORBIT_MAX_DISTANCE,
  lastMapZoom: SURFACE_DEFAULT_ZOOM,
  activePresetId: null,
  orbitalTween: null,
  lastHintToken: 0,
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.01,
  200,
);
camera.position.set(0, 0.8, 5.9);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
elements.globeStage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = ORBIT_MIN_DISTANCE;
controls.maxDistance = ORBIT_MAX_DISTANCE;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.75;
controls.target.set(0, 0, 0);

const clock = new THREE.Clock();
const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);

const textures = {};
let earthGroup;
let earthDayMesh;
let earthNightMesh;
let earthLightsMesh;
let cloudMesh;
let atmosphereMesh;
let atmosphereMaterial;
let ambientLight;
let sunLight;
let audioContext;
let sunRotation = 0;

boot();

async function boot() {
  bindUi();
  buildSceneShell();
  await loadTextures();
  buildEarth();
  updateOrbitFocus();
  hideLoading();
  animate();
}

function bindUi() {
  elements.cloudToggle.addEventListener("change", (event) => {
    state.clouds = event.target.checked;
    if (cloudMesh) {
      cloudMesh.visible = state.clouds;
    }
  });

  elements.atmosphereToggle.addEventListener("change", (event) => {
    state.atmosphere = event.target.checked;
    if (atmosphereMesh) {
      atmosphereMesh.visible = state.atmosphere;
    }
  });

  elements.nightToggle.addEventListener("change", (event) => {
    state.night = event.target.checked;
    updateHint(
      state.night
        ? "Night mode enabled. Major city lights are emphasized in orbital view."
        : "Day mode restored. Scroll back in to re-enter the terrain layer.",
    );
  });

  elements.audioToggle.addEventListener("change", (event) => {
    state.audio = event.target.checked;
  });

  elements.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = elements.citySearch.value.trim();

    if (!query) {
      updateHint("Enter a city name and press Go.");
      return;
    }

    await searchAndFlyToCity(query);
  });

  elements.cityButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const preset = CITY_PRESETS.find((city) => city.id === button.dataset.city);
      if (!preset) {
        return;
      }

      state.searchResult = null;
      setActivePreset(preset.id);

      if (state.view === "surface" && state.map) {
        state.focus = { lat: preset.lat, lon: preset.lon, label: preset.label };
        state.map.flyTo({
          center: [preset.lon, preset.lat],
          zoom: Math.max(state.map.getZoom(), 14.4),
          pitch: SURFACE_DEFAULT_PITCH,
          essential: true,
          speed: 0.9,
        });
        updateLabels();
        updateHint(`Navigating to ${preset.label}.`);
        return;
      }

      flyOrbitToLocation(preset.lat, preset.lon, preset.orbitDistance, 1600);
      state.focus = { lat: preset.lat, lon: preset.lon, label: preset.label };
      updateLabels();
      updateHint(`Navigating to ${preset.label}.`);
    });
  });

  elements.returnOrbit.addEventListener("click", () => {
    exitSurfaceMode();
  });

  renderer.domElement.addEventListener(
    "wheel",
    () => {
      ensureAudioContext();
    },
    { passive: true },
  );

  controls.addEventListener("change", () => {
    if (state.view !== "orbital") {
      return;
    }
    updateOrbitFocus();
  });

  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.view === "surface") {
      exitSurfaceMode();
    }
  });
}

async function searchAndFlyToCity(query) {
  const submitButton = elements.searchForm.querySelector(".search-button");
  elements.citySearch.disabled = true;
  submitButton.disabled = true;
  updateHint(`Searching for ${query}...`);

  try {
    const result = await geocodeCity(query);
    if (!result) {
      updateHint(`No city found for ${query}.`);
      return;
    }

    state.searchResult = { lat: result.lat, lon: result.lon, label: result.label };
    state.focus = resolveLocationLabel(result.lat, result.lon);
    updateLabels();

    if (state.view === "surface" && state.map) {
      state.map.flyTo({
        center: [result.lon, result.lat],
        zoom: Math.max(state.map.getZoom(), 14.4),
        pitch: SURFACE_DEFAULT_PITCH,
        essential: true,
        speed: 0.9,
      });
    } else {
      flyOrbitToLocation(result.lat, result.lon, 2.42, 1600);
    }

    elements.citySearch.value = result.label;
    updateHint(`Navigating to ${state.focus.label}.`);
  } catch (error) {
    console.error("City search failed", error);
    updateHint(`Search failed for ${query}.`);
  } finally {
    elements.citySearch.disabled = false;
    submitButton.disabled = false;
  }
}

async function geocodeCity(query) {
  const primary = await fetchGeocodeResult(query, true);
  if (primary) {
    return primary;
  }
  return fetchGeocodeResult(query, false);
}

async function fetchGeocodeResult(query, cityOnly) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en");
  url.searchParams.set("q", query);

  if (cityOnly) {
    url.searchParams.set("featuretype", "city");
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("Geocoding request failed: " + response.status);
  }

  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const match = results[0];
  return {
    lat: Number(match.lat),
    lon: Number(match.lon),
    label: formatSearchLabel(match, query),
  };
}

function formatSearchLabel(result, fallbackQuery) {
  const primary =
    result.name ||
    (typeof result.display_name === "string" ? result.display_name.split(",")[0].trim() : fallbackQuery);
  const secondary =
    result.address?.state ||
    result.address?.country ||
    (typeof result.display_name === "string" ? result.display_name.split(",").slice(1, 2)[0]?.trim() : "");

  if (secondary && secondary !== primary) {
    return `${primary}, ${secondary}`;
  }

  return primary;
}

function buildSceneShell() {
  scene.add(new THREE.AmbientLight(0x0f1721, 0.15));

  ambientLight = new THREE.AmbientLight(0x6d92aa, 1.25);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xfff4d6, 2.8);
  sunLight.position.set(5.5, 2.2, 4.8);
  scene.add(sunLight);

  const hemi = new THREE.HemisphereLight(0x7bcff2, 0x09141f, 0.52);
  scene.add(hemi);

  earthGroup = new THREE.Group();
  scene.add(earthGroup);

  const starsGeometry = new THREE.BufferGeometry();
  const starCount = 4500;
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i += 1) {
    const radius = 18 + Math.random() * 70;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starField = new THREE.Points(
    starsGeometry,
    new THREE.PointsMaterial({
      color: 0xfafcff,
      size: 0.09,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    }),
  );
  scene.add(starField);
}

async function loadTextures() {
  loadingManager.onProgress = (_url, loaded, total) => {
    elements.loadingCopy.textContent = `Preparing orbital assets... ${loaded}/${total}`;
  };

  const loaders = Object.entries(TEXTURE_URLS).map(async ([key, url]) => {
    const texture = await textureLoader.loadAsync(url);
    if (["day", "night", "lights"].includes(key)) {
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    texture.anisotropy = 8;
    textures[key] = texture;
  });

  await Promise.all(loaders);
}

function buildEarth() {
  const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 96, 96);

  earthDayMesh = new THREE.Mesh(
    earthGeometry,
    new THREE.MeshPhongMaterial({
      map: textures.day,
      normalMap: textures.normal,
      specularMap: textures.specular,
      specular: new THREE.Color(0x4f6d7a),
      shininess: 18,
      normalScale: new THREE.Vector2(1.1, 1.1),
    }),
  );

  earthNightMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS + 0.001, 96, 96),
    new THREE.MeshBasicMaterial({
      map: textures.night,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );

  earthLightsMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS + 0.0024, 96, 96),
    new THREE.MeshBasicMaterial({
      map: textures.lights,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS + 0.012, 96, 96),
    new THREE.MeshPhongMaterial({
      map: textures.clouds,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );

  atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x6cd6ff) },
      viewVector: { value: new THREE.Vector3() },
      intensityScale: { value: 1 },
    },
    vertexShader: `
      uniform vec3 viewVector;
      uniform float intensityScale;
      varying float intensity;

      void main() {
        vec3 worldNormal = normalize(normalMatrix * normal);
        vec3 viewDirection = normalize(normalMatrix * viewVector);
        intensity = pow(max(0.0, 0.78 - dot(worldNormal, viewDirection)), 3.2) * intensityScale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      varying float intensity;

      void main() {
        gl_FragColor = vec4(glowColor * intensity, intensity * 0.78);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });

  atmosphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS + 0.05, 96, 96),
    atmosphereMaterial,
  );

  earthGroup.add(earthDayMesh, earthNightMesh, earthLightsMesh, cloudMesh, atmosphereMesh);
}

async function ensureMap() {
  if (state.mapBootPromise) {
    return state.mapBootPromise;
  }

  updateHint("Preparing surface terrain...");

  state.mapBootPromise = buildSurfaceStyle()
    .then(
      (style) =>
        new Promise((resolve) => {
          const focus = state.focus;
          const map = new maplibregl.Map({
            container: elements.mapStage,
            style,
            center: [focus.lon, focus.lat],
            zoom: SURFACE_DEFAULT_ZOOM,
            pitch: SURFACE_DEFAULT_PITCH,
            maxPitch: 85,
            attributionControl: true,
            antialias: true,
          });

          map.addControl(
            new maplibregl.NavigationControl({
              visualizePitch: true,
              showCompass: true,
              showZoom: true,
            }),
            "top-right",
          );

          map.on("load", () => {
            add3DBuildings(map);
            if (typeof map.setFog === "function") {
              map.setFog({
                color: "rgb(15, 28, 41)",
                "high-color": "rgb(34, 92, 146)",
                "horizon-blend": 0.06,
                "space-color": "rgb(2, 8, 14)",
                "star-intensity": 0.15,
              });
            }
            state.mapReady = true;
            state.lastMapZoom = map.getZoom();
            resolve(map);
          });

          map.on("move", () => {
            if (state.view !== "surface") {
              return;
            }
            const center = map.getCenter();
            updateFocusFromCoordinates(center.lat, center.lng);
          });

          map.on("zoom", () => {
            if (state.view !== "surface") {
              return;
            }
            playZoomSoundFromMap(map.getZoom());
          });

          map.on("zoomend", () => {
            if (state.view === "surface" && map.getZoom() <= MAP_EXIT_ZOOM) {
              exitSurfaceMode();
            }
          });

          state.map = map;
        }),
    )
    .catch((error) => {
      console.error("Failed to initialize surface mode", error);
      state.mapBootPromise = null;
      updateHint("Surface tiles failed to initialize.");
      throw error;
    });

  return state.mapBootPromise;
}

async function buildSurfaceStyle() {
  const response = await fetch("https://tiles.openfreemap.org/styles/bright");
  if (!response.ok) {
    throw new Error("Failed to load surface style: " + response.status);
  }
  const style = await response.json();

  style.projection = { type: "globe" };
  style.sources = {
    ...style.sources,
    satelliteSource: {
      type: "raster",
      tiles: [
        "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
      ],
      tileSize: 256,
      attribution: "Sentinel-2 cloudless, EOX IT Services GmbH",
    },
    terrainSource: {
      type: "raster-dem",
      tiles: [
        "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 15,
      attribution: "Elevation tiles courtesy of AWS Terrain Tiles",
    },
  };

  style.terrain = {
    source: "terrainSource",
    exaggeration: 1.18,
  };

  const firstNonFillLayer = style.layers.find(
    (layer) => layer.type !== "fill" && layer.type !== "background",
  );
  const firstNonFillIndex = Math.max(style.layers.indexOf(firstNonFillLayer), 0);

  style.layers.splice(firstNonFillIndex, 0, {
    id: "satellite-base",
    type: "raster",
    source: "satelliteSource",
    paint: {
      "raster-opacity": 0.92,
      "raster-saturation": 0.08,
      "raster-contrast": 0.12,
    },
  });

  style.layers.splice(firstNonFillIndex + 1, 0, {
    id: "terrain-hillshade",
    type: "hillshade",
    source: "terrainSource",
    paint: {
      "hillshade-shadow-color": "#25384a",
      "hillshade-highlight-color": "#d9e7f2",
      "hillshade-accent-color": "#516980",
    },
  });

  return style;
}

function add3DBuildings(map) {
  const style = map.getStyle();
  const vectorSourceEntry = Object.entries(style.sources).find(([, source]) => source.type === "vector");
  const symbolLayer = style.layers.find((layer) => layer.type === "symbol");

  if (!vectorSourceEntry || !symbolLayer || map.getLayer("city-buildings")) {
    return;
  }

  const [sourceId] = vectorSourceEntry;

  map.addLayer(
    {
      id: "city-buildings",
      type: "fill-extrusion",
      source: sourceId,
      "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], ["get", "height"], 0],
          0,
          "#d6e7ee",
          60,
          "#bed3df",
          180,
          "#f5ede2",
        ],
        "fill-extrusion-base": [
          "coalesce",
          ["get", "render_min_height"],
          ["get", "min_height"],
          0,
        ],
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          0,
          15,
          ["coalesce", ["get", "render_height"], ["get", "height"], 10],
        ],
        "fill-extrusion-opacity": 0.92,
      },
    },
    symbolLayer.id,
  );
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  updateOrbitalTween();
  controls.update();

  const targetSunRotation = state.night ? Math.PI : 0;
  sunRotation = THREE.MathUtils.damp(sunRotation, targetSunRotation, 3.2, delta);

  const sunRadius = 7.6;
  sunLight.position.set(
    Math.cos(sunRotation) * sunRadius,
    2.4 + Math.sin(sunRotation * 0.5) * 0.65,
    Math.sin(sunRotation) * sunRadius,
  );

  if (cloudMesh && state.clouds) {
    cloudMesh.rotation.y += 0.032 * delta;
  }

  atmosphereMaterial.uniforms.viewVector.value.copy(camera.position);
  atmosphereMaterial.uniforms.intensityScale.value = state.night ? 0.72 : 1;

  ambientLight.intensity = THREE.MathUtils.damp(
    ambientLight.intensity,
    state.night ? 0.28 : 1.22,
    3.1,
    delta,
  );
  sunLight.intensity = THREE.MathUtils.damp(
    sunLight.intensity,
    state.night ? 0.55 : 2.85,
    3.1,
    delta,
  );
  renderer.toneMappingExposure = THREE.MathUtils.damp(
    renderer.toneMappingExposure,
    state.night ? 0.7 : 1.08,
    3.1,
    delta,
  );

  earthNightMesh.material.opacity = THREE.MathUtils.damp(
    earthNightMesh.material.opacity,
    state.night ? 0.94 : 0,
    3.4,
    delta,
  );
  earthLightsMesh.material.opacity = THREE.MathUtils.damp(
    earthLightsMesh.material.opacity,
    state.night ? 0.92 : 0.05,
    3.4,
    delta,
  );
  cloudMesh.material.opacity = THREE.MathUtils.damp(
    cloudMesh.material.opacity,
    state.clouds ? (state.night ? 0.62 : 0.72) : 0,
    4.8,
    delta,
  );
  atmosphereMesh.visible = state.atmosphere;

  if (state.view === "orbital") {
    maybePreloadMap();
    maybeEnterSurfaceMode();
    playZoomSoundFromOrbit(camera.position.length());
  }

  renderer.render(scene, camera);
}

function maybePreloadMap() {
  if (state.mapBootPromise || camera.position.length() > MAP_PRELOAD_DISTANCE) {
    return;
  }
  ensureMap().catch(() => {});
}

async function maybeEnterSurfaceMode() {
  if (state.view !== "orbital" || state.transitioning || camera.position.length() > MAP_ENTRY_DISTANCE) {
    return;
  }

  state.transitioning = true;
  updateOrbitFocus();

  try {
    const map = await ensureMap();
    const entryZoom = THREE.MathUtils.clamp(
      THREE.MathUtils.mapLinear(camera.position.length(), MAP_ENTRY_DISTANCE, ORBIT_MIN_DISTANCE, 8.8, 13.6),
      8.6,
      13.8,
    );

    map.jumpTo({
      center: [state.focus.lon, state.focus.lat],
      zoom: entryZoom,
      pitch: SURFACE_DEFAULT_PITCH,
      bearing: 0,
    });

    map.resize();
    state.view = "surface";
    state.lastMapZoom = map.getZoom();
    document.body.dataset.view = "surface";
    elements.returnOrbit.hidden = false;
    controls.enabled = false;
    updateLabels();
    updateHint("Surface mode active. Scroll further for block-level detail, or scroll back out to return to orbit.");
  } catch (error) {
    console.error(error);
  } finally {
    state.transitioning = false;
  }
}

function exitSurfaceMode() {
  if (state.view !== "surface" || state.transitioning) {
    return;
  }

  state.transitioning = true;

  const center = state.map ? state.map.getCenter() : { lat: state.focus.lat, lng: state.focus.lon };
  const zoom = state.map ? state.map.getZoom() : MAP_EXIT_ZOOM;
  const distance = THREE.MathUtils.clamp(
    THREE.MathUtils.mapLinear(zoom, MAP_EXIT_ZOOM, 15, 2.15, 1.36),
    1.5,
    2.45,
  );

  state.focus = resolveLocationLabel(center.lat, center.lng);
  document.body.dataset.view = "orbital";
  state.view = "orbital";
  elements.returnOrbit.hidden = true;

  flyOrbitToLocation(center.lat, center.lng, distance, 1300, () => {
    controls.enabled = true;
    state.transitioning = false;
    updateLabels();
    updateHint("Orbital view restored. Keep the target region centered, then zoom back down any time.");
  });
}

function flyOrbitToLocation(lat, lon, distance = 2.6, duration = 1400, onComplete) {
  const targetDirection = latLonToVector3(lat, lon, 1)
    .applyQuaternion(earthGroup.quaternion)
    .normalize();
  const endPosition = targetDirection.multiplyScalar(distance);

  state.orbitalTween = {
    startPosition: camera.position.clone(),
    endPosition,
    startTime: performance.now(),
    duration,
    onComplete,
  };
}

function updateOrbitalTween() {
  if (!state.orbitalTween) {
    return;
  }

  const { startPosition, endPosition, startTime, duration, onComplete } = state.orbitalTween;
  const elapsed = performance.now() - startTime;
  const progress = THREE.MathUtils.clamp(elapsed / duration, 0, 1);
  const eased = easeInOutCubic(progress);

  camera.position.copy(startPosition).lerp(endPosition, eased);
  camera.lookAt(0, 0, 0);

  if (progress >= 1) {
    state.orbitalTween = null;
    if (typeof onComplete === "function") {
      onComplete();
    }
  }
}

function updateOrbitFocus() {
  const direction = camera.position
    .clone()
    .normalize()
    .applyQuaternion(earthGroup.quaternion.clone().invert());
  const focus = vector3ToLatLon(direction);
  updateFocusFromCoordinates(focus.lat, focus.lon);
}

function updateFocusFromCoordinates(lat, lon) {
  state.focus = resolveLocationLabel(lat, lon);
  updateLabels();
}

function updateLabels() {
  elements.viewLabel.textContent = state.view === "orbital" ? "Orbital view" : "Surface mode";
  elements.focusLabel.textContent = formatCoordinateLabel(state.focus.lat, state.focus.lon);

  if (state.view === "surface") {
    elements.hintCopy.textContent =
      "Surface terrain is live. Scroll to individual streets and buildings, or zoom out below the threshold to hand back to orbit.";
  } else {
    elements.hintCopy.textContent =
      "Drag to orbit. Scroll inward until the terrain layer takes over. Scroll back out or use Return to Orbit to climb back into space.";
  }
}

function resolveLocationLabel(lat, lon) {
  const closest = CITY_PRESETS.reduce(
    (best, city) => {
      const distance = haversine(lat, lon, city.lat, city.lon);
      if (distance < best.distance) {
        return { city, distance };
      }
      return best;
    },
    { city: null, distance: Infinity },
  );

  if (closest.city && closest.distance < 250) {
    setActivePreset(closest.city.id);
    return { lat, lon, label: closest.city.label };
  }

  if (state.searchResult) {
    const searchDistance = haversine(lat, lon, state.searchResult.lat, state.searchResult.lon);
    if (searchDistance < 120) {
      setActivePreset(null);
      return { lat, lon, label: state.searchResult.label };
    }
  }

  setActivePreset(null);
  return {
    lat,
    lon,
    label: formatCoordinateLabel(lat, lon),
  };
}

function setActivePreset(presetId) {
  state.activePresetId = presetId;
  elements.cityButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.city === presetId);
  });
}

function playZoomSoundFromOrbit(distance) {
  if (state.view !== "orbital") {
    state.lastOrbitalDistance = distance;
    return;
  }

  const delta = state.lastOrbitalDistance - distance;
  state.lastOrbitalDistance = distance;

  if (Math.abs(delta) < 0.018 || state.orbitalTween) {
    return;
  }

  playZoomSound(delta > 0 ? 1 : -1, THREE.MathUtils.clamp(Math.abs(delta) * 6.5, 0.3, 1));
}

function playZoomSoundFromMap(zoom) {
  const delta = zoom - state.lastMapZoom;
  state.lastMapZoom = zoom;

  if (Math.abs(delta) < 0.03) {
    return;
  }

  playZoomSound(delta > 0 ? 1 : -1, THREE.MathUtils.clamp(Math.abs(delta) * 1.6, 0.3, 1));
}

function playZoomSound(direction, intensity = 0.5) {
  if (!state.audio) {
    return;
  }

  const now = performance.now();
  if (now - state.lastSoundAt < 120) {
    return;
  }

  ensureAudioContext();
  if (!audioContext || audioContext.state === "suspended") {
    return;
  }

  state.lastSoundAt = now;

  const startTime = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();

  oscillator.type = direction > 0 ? "sawtooth" : "triangle";
  oscillator.frequency.setValueAtTime(direction > 0 ? 190 : 430, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(direction > 0 ? 720 : 130, startTime + 0.22);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(direction > 0 ? 1400 : 900, startTime);

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.03 * intensity, startTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.24);

  oscillator.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + 0.25);
}

function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
}

function updateHint(text) {
  const token = Date.now();
  state.lastHintToken = token;
  elements.hintCopy.textContent = text;

  window.setTimeout(() => {
    if (state.lastHintToken === token) {
      updateLabels();
    }
  }, 4200);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (state.map) {
    state.map.resize();
  }
}

function hideLoading() {
  elements.loadingScreen.classList.add("is-hidden");
}

function latLonToVector3(lat, lon, radius = EARTH_RADIUS) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);

  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function vector3ToLatLon(vector) {
  const normalized = vector.clone().normalize();
  const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(normalized.y));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(normalized.z, -normalized.x)) - 180;
  return { lat, lon: wrapLongitude(lon) };
}

function wrapLongitude(lon) {
  let value = lon;
  while (value <= -180) value += 360;
  while (value > 180) value -= 360;
  return value;
}

function formatLatitude(value) {
  return `${Math.abs(value).toFixed(2)}deg${value >= 0 ? "N" : "S"}`;
}

function formatLongitude(value) {
  return `${Math.abs(value).toFixed(2)}deg${value >= 0 ? "E" : "W"}`;
}

function formatCoordinateLabel(lat, lon) {
  return `${formatLatitude(lat)} ${formatLongitude(lon)}`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
