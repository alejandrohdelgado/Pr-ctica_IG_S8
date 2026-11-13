import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

/**
 * IGS8 - MAPA DE TRÁFICO MARÍTIMO EN ESPAÑA Y CANARIAS
 * Visualización 3D interactiva de rutas marítimas y buques reales entre la Península,
 * Estrecho de Gibraltar, Baleares y el Archipiélago Canario con Three.js.
 */

// Variables globales Three.js
let scene, renderer, camera, camcontrols;
let mapa;
let scale = 16;
let mapsx, mapsy;

// Límites geográficos del mapa (Península Ibérica, Estrecho de Gibraltar y Archipiélago Canario)
// Proyección Equirectangular EPSG:4326 exacta
const minlon = -20.0, maxlon = 4.5;
const minlat = 26.0, maxlat = 44.0;

// Texturas geográficas reales (Satélite Híbrido y Mapa Topográfico)
let modoMapaActual = "satelite"; // "satelite" | "topo"
let texSatelite = null;
let texTopo = null;

const URL_ARCGIS_SAT =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=-20.0,26.0,4.5,44.0&bboxSR=4326&imageSR=4326&size=2048,1505&format=jpg&f=image";
const URL_ARCGIS_TOPO =
  "https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/export?bbox=-20.0,26.0,4.5,44.0&bboxSR=4326&imageSR=4326&size=2048,1505&format=jpg&f=image";

// Datos cargados
let PUERTOS = {};
const viajesTotales = [];
let filtroZonaActual = "TODOS";

// Objetos 3D de barcos y rutas en escena
const barcosEnEscena = new Map(); // id_viaje -> { group, curve, fullLine, activeLine, data }
let selectedShipId = null;
let raycaster, mouse;

// Motor de tiempo de la simulación
let tInicioSim = 0;
let tFinSim = 0;
let tActualSim = 0;
let factorVelocidad = 60; // x60 por defecto
let simPausada = false;
let ultimoTiempoFrame = null;

// Elementos del DOM / Interfaz
let hudFecha, hudBarcosActivos;
let btnPlayPause, selVelocidad, sliderTiempo, panelLateral;
let btnCerrarPanel, btnCambiarMapa;

// Inicialización
init();

function init() {
  // 1. Configuración de escena y cámara
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040d1a);

  // Cámara con perspectiva amplia
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, -13.5, 17.5);
  camera.up.set(0, 0, 1);

  // Renderizador WebGL con antialiasing
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Controles de órbita
  camcontrols = new OrbitControls(camera, renderer.domElement);
  camcontrols.enableDamping = true;
  camcontrols.dampingFactor = 0.05;
  camcontrols.maxPolarAngle = Math.PI / 2.05;
  camcontrols.minDistance = 2.5;
  camcontrols.maxDistance = 48;
  camcontrols.target.set(0, 0, 0);

  // Iluminación equilibrada para resaltar la textura geográfica y los modelos 3D
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 0.75);
  sunLight.position.set(10, -15, 22);
  scene.add(sunLight);

  // 2. Cálculo de proporciones del mapa plano manteniendo relación de aspecto geográfica
  const txaspectRatio = (maxlon - minlon) / (maxlat - minlat);
  mapsy = scale;
  mapsx = mapsy * txaspectRatio;

  // 3. Creación del plano con textura geográfica real (Satélite / Topográfico)
  crearPlanoGeografico();

  // 4. Interacción mediante ratón / Raycaster
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  window.addEventListener("click", onDocumentClick, false);
  window.addEventListener("resize", onWindowResize, false);
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") deseleccionarBarco();
  });

  // 5. Vincular elementos UI del DOM
  conectarElementosUI();

  // 6. Carga de datos de puertos y rutas de barcos reales
  cargarDatos();
}

/**
 * Carga una textura geográfica con soporte multi-ruta (local src/, ./ y fallback remoto ArcGIS)
 */
function cargarTexturaGeografica(nombreArchivo, urlRemotaFallback, alCargar) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  function configurarTextura(tex) {
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (renderer && renderer.capabilities) {
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    tex.needsUpdate = true;
    alCargar(tex);
  }

  loader.load(
    "src/" + nombreArchivo,
    configurarTextura,
    undefined,
    function () {
      loader.load(
        "./" + nombreArchivo,
        configurarTextura,
        undefined,
        function () {
          loader.load(urlRemotaFallback, configurarTextura);
        }
      );
    }
  );
}

/**
 * Crea el plano 3D del mapa y aplica las texturas geográficas reales de España, Portugal,
 * Marruecos y Canarias (Satélite Híbrido con etiquetas y Mapa Geográfico Físico/Político).
 * Se usa MeshBasicMaterial para que las luces de los barcos 3D no quemen ni sobreexpongan el mapa.
 */
function crearPlanoGeografico() {
  const planeGeo = new THREE.PlaneGeometry(mapsx, mapsy, 64, 64);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0xe8eef5
  });

  mapa = new THREE.Mesh(planeGeo, planeMat);
  mapa.position.set(0, 0, 0);
  scene.add(mapa);

  // Cargar textura principal (Satélite Híbrido con relieve batimétrico y nombres geográficos)
  cargarTexturaGeografica("mapa_satelite.jpg", URL_ARCGIS_SAT, function (tex) {
    texSatelite = tex;
    if (modoMapaActual === "satelite") {
      mapa.material.map = texSatelite;
      mapa.material.color.setHex(0xe8eef5);
      mapa.material.needsUpdate = true;
    }
  });

  // Precargar textura secundaria (Mapa Geográfico Físico-Político National Geographic)
  cargarTexturaGeografica("mapa_topo.jpg?v=2", URL_ARCGIS_TOPO, function (tex) {
    texTopo = tex;
    if (modoMapaActual === "topo") {
      mapa.material.map = texTopo;
      mapa.material.color.setHex(0xd8e2ec);
      mapa.material.needsUpdate = true;
    }
  });
}

/**
 * Alterna entre la textura de Satélite Híbrido y el Mapa Geográfico Topográfico.
 */
function alternarTexturaMapa() {
  if (!mapa) return;
  if (modoMapaActual === "satelite") {
    modoMapaActual = "topo";
    if (texTopo) {
      mapa.material.map = texTopo;
      mapa.material.color.setHex(0xd8e2ec);
      mapa.material.needsUpdate = true;
    }
    if (btnCambiarMapa) {
      btnCambiarMapa.innerHTML = "🛰️ Mapa: Geográfico Topográfico";
    }
  } else {
    modoMapaActual = "satelite";
    if (texSatelite) {
      mapa.material.map = texSatelite;
      mapa.material.color.setHex(0xe8eef5);
      mapa.material.needsUpdate = true;
    }
    if (btnCambiarMapa) {
      btnCambiarMapa.innerHTML = "🗺️ Mapa: Satélite Híbrido";
    }
  }
}

/**
 * Conversión de coordenadas geográficas (Lat/Lon) a coordenadas de la escena 3D.
 */
function Map2Range(val, vmin, vmax, dmin, dmax) {
  const t = 1 - (vmax - val) / (vmax - vmin);
  return dmin + t * (dmax - dmin);
}

function geoToScene(lat, lon, z) {
  const posZ = z !== undefined ? z : 0.025;
  const x = Map2Range(lon, minlon, maxlon, -mapsx / 2, mapsx / 2);
  const y = Map2Range(lat, minlat, maxlat, -mapsy / 2, mapsy / 2);
  return new THREE.Vector3(x, y, posZ);
}

/**
 * Carga el diccionario de puertos y el CSV de viajes marítimos reales.
 */
function cargarDatos() {
  // 1. Puertos
  fetch("src/puertos_maritimos.json")
    .then(function (res) {
      if (!res.ok) return fetch("./puertos_maritimos.json");
      return res;
    })
    .then(function (res) {
      return res.text();
    })
    .then(function (text) {
      if (text.trim().indexOf("<") === 0) {
        return fetch("./puertos_maritimos.json").then(function (r) {
          return r.json();
        });
      }
      return JSON.parse(text);
    })
    .then(function (data) {
      PUERTOS = data;
      dibujarPuertos();

      // 2. CSV oficial de viajes reales de buques
      return fetch("src/barcos_rutas_reales.csv");
    })
    .then(function (res) {
      if (!res.ok) return fetch("./barcos_rutas_reales.csv");
      return res;
    })
    .then(function (res) {
      return res.text();
    })
    .then(function (csvText) {
      if (csvText.trim().indexOf("<") === 0) {
        return fetch("./barcos_rutas_reales.csv").then(function (r) {
          return r.text();
        });
      }
      return csvText;
    })
    .then(function (csvText) {
      procesarCSVViajes(csvText);
      iniciarSimulador();
    })
    .catch(function (err) {
      console.error("Error al cargar datos marítimos oficiales:", err);
    });
}

/**
 * Dibuja los balizamientos de puertos en la escena con anillos luminosos.
 */
function dibujarPuertos() {
  const portGroup = new THREE.Group();
  portGroup.name = "PuertosLayer";

  const ringGeo = new THREE.RingGeometry(0.08, 0.13, 20);
  const centerGeo = new THREE.CircleGeometry(0.065, 20);

  Object.keys(PUERTOS).forEach(function (key) {
    const p = PUERTOS[key];
    const pos = geoToScene(p.lat, p.lon, 0.03);

    const colHex =
      p.zona === "Canarias"
        ? 0x00e5ff
        : p.zona === "Peninsula"
        ? 0xffb703
        : 0x3b82f6;
    const ringMat = new THREE.MeshBasicMaterial({
      color: colHex,
      side: THREE.DoubleSide
    });
    const centerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide
    });

    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);

    const center = new THREE.Mesh(centerGeo, centerMat);
    center.position.set(pos.x, pos.y, pos.z + 0.005);

    portGroup.add(ring);
    portGroup.add(center);
  });

  scene.add(portGroup);
}

/**
 * Formatea un timestamp en milisegundos a DD/MM/YYYY HH:MM
 */
function formatearFechaCorta(ms) {
  const d = new Date(ms);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return dia + "/" + mes + "/" + anio + " " + h + ":" + m;
}

/**
 * Parsea el CSV de rutas marítimas reales y ajusta la ventana temporal en Noviembre 2025.
 */
function procesarCSVViajes(csvContent) {
  const filas = csvContent.trim().split("\n");
  const headers = filas[0].split(";").map(function (h) {
    return h.trim();
  });

  // Base temporal de referencia: 12 Noviembre 2025 00:00:00
  const BASE_NOV_2025 = new Date(2025, 10, 12, 0, 0, 0).getTime();
  const VENTANA_96H = 96 * 3600 * 1000;

  let minTs = Infinity;
  let maxTs = -Infinity;

  for (let i = 1; i < filas.length; i++) {
    const col = filas[i].split(";");
    if (col.length < headers.length) continue;

    const v = {};
    headers.forEach(function (h, idx) {
      v[h] = col[idx] ? col[idx].trim() : "";
    });

    v.ts_salida_ms = parseInt(v.ts_salida_ms, 10);
    v.ts_llegada_ms = parseInt(v.ts_llegada_ms, 10);
    v.velocidad_nudos = parseFloat(v.velocidad_nudos);
    v.eslora_m = parseFloat(v.eslora_m);
    v.calado_m = parseFloat(v.calado_m);
    v.duracion_min = parseInt(v.duracion_min, 10);

    // Si algún registro tuviera año >= 2026, normalizarlo a la ventana de Noviembre 2025
    const anioRegistro = new Date(v.ts_salida_ms).getFullYear();
    if (anioRegistro >= 2026) {
      const durMs = Math.min(
        Math.max(v.ts_llegada_ms - v.ts_salida_ms, 7200 * 1000),
        24 * 3600 * 1000
      );
      const offsetMs = ((i * 1550000) % (VENTANA_96H - durMs));
      v.ts_salida_ms = BASE_NOV_2025 + offsetMs;
      v.ts_llegada_ms = v.ts_salida_ms + durMs;
      v.duracion_min = Math.round(durMs / 60000);
      v.hora_salida = formatearFechaCorta(v.ts_salida_ms);
      v.hora_llegada = formatearFechaCorta(v.ts_llegada_ms);
    }

    if (v.ts_salida_ms < minTs) minTs = v.ts_salida_ms;
    if (v.ts_llegada_ms > maxTs) maxTs = v.ts_llegada_ms;

    viajesTotales.push(v);
  }

  // Recortar los extremos de arranque y cola para que en todo momento haya entre 30 y 48 barcos activos
  tInicioSim = minTs + 8 * 3600 * 1000;
  tFinSim = Math.min(maxTs - 6 * 3600 * 1000, tInicioSim + 82 * 3600 * 1000);
  if (tFinSim <= tInicioSim) {
    tInicioSim = minTs;
    tFinSim = maxTs;
  }
  tActualSim = tInicioSim;

  console.log(
    "Cargados " +
      viajesTotales.length +
      " viajes marítimos reales (Noviembre 2025)."
  );
}

/**
 * Genera el modelo 3D detallado de un barco con casco aerodinámico,
 * puente de mando, chimenea según compañía y estela de espuma.
 */
function crearModeloBarco3D(compania, tipo) {
  const ship = new THREE.Group();

  // 1. Colores corporativos según compañía naviera
  let hullColor = 0x1f2937;
  let superstructureColor = 0xffffff;
  let funnelColor = 0xe11d48;

  if (compania.indexOf("Fred Olsen") !== -1) {
    hullColor = 0xf8fafc;
    funnelColor = 0xfacc15; // Amarillo Fred Olsen
  } else if (compania.indexOf("Armas") !== -1) {
    hullColor = 0xb91c1c; // Rojo Armas
    funnelColor = 0x1e3a8a;
  } else if (compania.indexOf("Bale") !== -1) {
    hullColor = 0xffffff;
    funnelColor = 0x06b6d4; // Cian Baleària
  } else if (
    compania.indexOf("Maersk") !== -1 ||
    compania.indexOf("Boluda") !== -1
  ) {
    hullColor = 0x0284c7; // Azul Portacontenedores
    funnelColor = 0x0369a1;
  } else if (tipo.indexOf("Crucero") !== -1) {
    hullColor = 0xffffff;
    funnelColor = 0x2563eb;
  } else if (tipo.indexOf("Salvamento") !== -1) {
    hullColor = 0xea580c; // Naranja Salvamento Marítimo
    funnelColor = 0xf97316;
  }

  // Dimensiones del barco normalizadas para la escala de la escena
  const L = 0.45;
  const W = 0.14;
  const H = 0.08;

  // Casco: Forma puntiaguda hacia la proa (eje +Y es hacia adelante)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-W / 2, -L / 2);
  hullShape.lineTo(W / 2, -L / 2);
  hullShape.lineTo(W / 2, L / 4);
  hullShape.lineTo(0, L / 2);
  hullShape.lineTo(-W / 2, L / 4);
  hullShape.closePath();

  const hullExtrude = new THREE.ExtrudeGeometry(hullShape, {
    depth: H,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.015,
    bevelThickness: 0.02
  });
  hullExtrude.center();

  const hullMat = new THREE.MeshStandardMaterial({
    color: hullColor,
    roughness: 0.35,
    metalness: 0.25
  });
  const hullMesh = new THREE.Mesh(hullExtrude, hullMat);
  hullMesh.position.z = H / 2;
  ship.add(hullMesh);

  // Superestructura / Puente de mando
  const bridgeGeo = new THREE.BoxGeometry(W * 0.72, L * 0.42, H * 1.15);
  const bridgeMat = new THREE.MeshStandardMaterial({
    color: superstructureColor,
    roughness: 0.3
  });
  const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
  bridge.position.set(0, -L * 0.05, H * 1.15);
  ship.add(bridge);

  // Chimenea (Funnel)
  const funnelGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.075, 8);
  const funnelMat = new THREE.MeshStandardMaterial({
    color: funnelColor,
    roughness: 0.2
  });
  const funnel = new THREE.Mesh(funnelGeo, funnelMat);
  funnel.rotation.x = Math.PI / 2;
  funnel.position.set(0, -L * 0.22, H * 1.75);
  ship.add(funnel);

  // Estela de espuma en popa
  const wakeGeo = new THREE.ConeGeometry(0.095, 0.38, 3);
  const wakeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.65
  });
  const wake = new THREE.Mesh(wakeGeo, wakeMat);
  wake.rotation.z = Math.PI;
  wake.position.set(0, -L * 0.65, 0.008);
  ship.add(wake);

  // Hitbox invisible para facilitar la selección con el ratón
  const hitGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.45, 8);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.rotation.x = Math.PI / 2;
  hitMesh.name = "ShipHitbox";
  ship.add(hitMesh);

  return ship;
}

/**
 * Obtiene el color característico de la estela y ruta según la zona.
 */
function obtenerColorZona(zona) {
  switch (zona) {
    case "Peninsula-Canarias":
      return 0xffb703; // Amarillo dorado intenso
    case "Interinsular Canarias":
      return 0x00e5ff; // Cian brillante
    case "Estrecho-Baleares":
      return 0x3b82f6; // Azul eléctrico
    case "Transito Internacional / Carga":
    default:
      return 0xc084fc; // Púrpura brillante
  }
}

/**
 * Waypoints marítimos reales (lat, lon) entre pares de puertos para rodear masas terrestres,
 * cabos, islas y estrechos (Estrecho de Gibraltar, Cabo de Gata, Cabo de la Nao, Cabo de San Vicente y canales interinsulares).
 */
const RUTAS_WAYPOINTS = {
  // Mediterráneo <-> Canarias (bordeando Delta del Ebro, Cabo de la Nao, Cabo de Palos, Cabo de Gata y Estrecho de Gibraltar)
  BCN_LPA: [
    [40.55, 1.35],
    [39.65, 0.7],
    [38.72, 0.52],
    [38.0, 0.1],
    [37.52, -0.35],
    [36.55, -2.05],
    [36.12, -3.7],
    [36.05, -4.95],
    [35.96, -5.6],
    [35.88, -6.35],
    [33.8, -9.6],
    [31.2, -12.0],
    [29.2, -15.1]
  ],
  BCN_TCI: [
    [40.55, 1.35],
    [39.65, 0.7],
    [38.72, 0.52],
    [38.0, 0.1],
    [37.52, -0.35],
    [36.55, -2.05],
    [36.12, -3.7],
    [36.05, -4.95],
    [35.96, -5.6],
    [35.88, -6.35],
    [33.8, -9.6],
    [31.2, -12.2],
    [29.15, -15.85],
    [28.52, -16.05]
  ],
  VLC_LPA: [
    [38.72, 0.52],
    [38.0, 0.1],
    [37.52, -0.35],
    [36.55, -2.05],
    [36.12, -3.7],
    [36.05, -4.95],
    [35.96, -5.6],
    [35.88, -6.35],
    [33.8, -9.6],
    [31.2, -12.0],
    [29.2, -15.1]
  ],
  VLC_TCI: [
    [38.72, 0.52],
    [38.0, 0.1],
    [37.52, -0.35],
    [36.55, -2.05],
    [36.12, -3.7],
    [36.05, -4.95],
    [35.96, -5.6],
    [35.88, -6.35],
    [33.8, -9.6],
    [31.2, -12.2],
    [29.15, -15.85],
    [28.52, -16.05]
  ],
  MAL_LPA: [
    [36.3, -4.6],
    [36.05, -4.95],
    [35.96, -5.6],
    [35.88, -6.35],
    [33.8, -9.6],
    [31.2, -12.0],
    [29.2, -15.1]
  ],
  MAL_TCI: [
    [36.3, -4.6],
    [36.05, -4.95],
    [35.96, -5.6],
    [35.88, -6.35],
    [33.8, -9.6],
    [31.2, -12.2],
    [29.15, -15.85],
    [28.52, -16.05]
  ],

  // Estrecho de Gibraltar <-> Mediterráneo / Baleares / Atlántico
  ALG_BCN: [
    [36.02, -5.15],
    [36.12, -3.7],
    [36.55, -2.05],
    [37.52, -0.35],
    [38.0, 0.1],
    [38.72, 0.52],
    [39.65, 0.7],
    [40.55, 1.35]
  ],
  ALG_VLC: [
    [36.02, -5.15],
    [36.12, -3.7],
    [36.55, -2.05],
    [37.52, -0.35],
    [38.0, 0.1],
    [38.72, 0.52]
  ],
  ALG_LPA: [
    [35.96, -5.6],
    [35.88, -6.35],
    [33.8, -9.6],
    [31.2, -12.0],
    [29.2, -15.1]
  ],
  ALG_TCI: [
    [35.96, -5.6],
    [35.88, -6.35],
    [33.8, -9.6],
    [31.2, -12.2],
    [29.15, -15.85],
    [28.52, -16.05]
  ],
  SIN_ALG: [
    [36.75, -9.35],
    [36.15, -7.2],
    [35.88, -6.35],
    [35.96, -5.6]
  ],
  BCN_PMI: [
    [40.35, 2.1],
    [39.52, 2.22],
    [39.46, 2.52]
  ],
  VLC_PMI: [
    [39.25, 1.35],
    [39.45, 2.3]
  ],
  MAL_MLN: [[36.15, -3.75]],
  MOT_MLN: [[36.05, -3.2]],
  ALG_CEU: [[36.01, -5.36]],

  // Galicia / Portugal / Golfo de Cádiz / Marruecos <-> Canarias
  VGO_LPA: [
    [38.8, -10.1],
    [36.75, -9.55],
    [32.5, -13.0],
    [29.2, -15.1]
  ],
  VGO_TCI: [
    [38.8, -10.1],
    [36.75, -9.55],
    [32.5, -13.4],
    [29.15, -15.85],
    [28.52, -16.05]
  ],
  SIN_LPA: [
    [36.75, -9.45],
    [32.5, -12.8],
    [29.2, -15.1]
  ],
  SIN_TCI: [
    [36.75, -9.45],
    [32.5, -13.2],
    [29.15, -15.85],
    [28.52, -16.05]
  ],
  CAD_LPA: [
    [35.8, -7.4],
    [33.5, -10.3],
    [30.8, -13.1],
    [29.1, -15.1]
  ],
  CAD_TCI: [
    [35.8, -7.4],
    [33.5, -10.5],
    [30.8, -13.6],
    [29.15, -15.85],
    [28.52, -16.05]
  ],
  CAD_ACE: [
    [35.8, -7.4],
    [33.5, -10.0],
    [30.8, -12.4],
    [29.35, -13.25],
    [28.95, -13.4]
  ],
  HUV_LPA: [
    [36.1, -7.6],
    [33.6, -10.5],
    [30.8, -13.2],
    [29.1, -15.1]
  ],
  HUV_TCI: [
    [36.1, -7.6],
    [33.6, -10.7],
    [30.8, -13.7],
    [29.15, -15.85],
    [28.52, -16.05]
  ],
  CAS_LPA: [
    [33.8, -8.5],
    [32.2, -10.8],
    [30.2, -13.2],
    [29.0, -15.1]
  ],
  CAS_TCI: [
    [33.8, -8.5],
    [32.2, -11.0],
    [30.2, -13.6],
    [29.15, -15.85],
    [28.52, -16.05]
  ],

  // Rutas Interinsulares Canarias (rodeando cabos e islas por canales marítimos reales)
  LPA_TCI: [
    [28.26, -15.58],
    [28.36, -15.92]
  ],
  AGA_TCI: [
    [28.22, -15.85],
    [28.35, -16.1]
  ],
  TCI_SPC: [
    [28.52, -16.05],
    [28.66, -16.12],
    [28.7, -16.55],
    [28.69, -17.25]
  ],
  TCI_GMZ: [
    [28.2, -16.35],
    [27.95, -16.68],
    [28.0, -16.92]
  ],
  TCI_VDE: [
    [28.2, -16.35],
    [27.95, -16.68],
    [27.88, -17.35],
    [27.85, -17.8]
  ],
  LCR_GMZ: [
    [28.02, -16.82],
    [28.05, -16.96]
  ],
  LCR_SPC: [
    [28.0, -16.82],
    [28.2, -17.0],
    [28.45, -17.45],
    [28.58, -17.68]
  ],
  LCR_VDE: [
    [27.95, -16.85],
    [27.88, -17.35],
    [27.85, -17.8]
  ],
  GMZ_SPC: [
    [28.25, -17.08],
    [28.48, -17.5]
  ],
  LPA_SPC: [
    [28.3, -15.65],
    [28.66, -16.12],
    [28.72, -16.65],
    [28.7, -17.3]
  ],
  LPA_VDE: [
    [27.72, -15.58],
    [27.75, -16.68],
    [27.85, -17.8]
  ],
  LPA_ACE: [
    [27.94, -14.32],
    [28.12, -13.86],
    [28.45, -13.68],
    [28.8, -13.52]
  ],
  LPA_FUE: [
    [27.94, -14.32],
    [28.12, -13.86],
    [28.35, -13.78]
  ],
  LPA_MRJ: [[28.02, -14.85]],
  ACE_FUE: [
    [28.8, -13.52],
    [28.62, -13.72]
  ],
  PBL_COR: [[28.8, -13.85]],
  SPC_ACE: [
    [28.75, -16.4],
    [28.95, -14.6],
    [29.25, -13.4],
    [28.95, -13.4]
  ]
};

/**
 * Construye la curva de navegación marítima (CatmullRomCurve3) entre dos puertos
 * utilizando los waypoints marítimos del dataset o de la tabla de corredores náuticos
 * para evitar cruzar cualquier masa terrestre o isla.
 */
function calcularCurvaRuta(pOrigen, pDestino, v) {
  const puntos3D = [];

  // 1. Si el CSV incluye la columna waypoints_ruta (lat,lon|lat,lon|...), usarla directamente
  if (v && v.waypoints_ruta && v.waypoints_ruta.indexOf("|") !== -1) {
    const pares = v.waypoints_ruta.split("|");
    for (let i = 0; i < pares.length; i++) {
      const coords = pares[i].split(",");
      if (coords.length === 2) {
        const lat = parseFloat(coords[0]);
        const lon = parseFloat(coords[1]);
        if (!isNaN(lat) && !isNaN(lon)) {
          const zElev = i === 0 || i === pares.length - 1 ? 0.025 : 0.032;
          puntos3D.push(geoToScene(lat, lon, zElev));
        }
      }
    }
  }

  // 2. Fallback: construir la ruta con la tabla RUTAS_WAYPOINTS si no vino en el CSV
  if (puntos3D.length < 2) {
    puntos3D.length = 0;
    puntos3D.push(geoToScene(pOrigen.lat, pOrigen.lon, 0.025));

    const claveDirecta = pOrigen.id + "_" + pDestino.id;
    const claveInversa = pDestino.id + "_" + pOrigen.id;

    if (RUTAS_WAYPOINTS[claveDirecta]) {
      const wps = RUTAS_WAYPOINTS[claveDirecta];
      for (let j = 0; j < wps.length; j++) {
        puntos3D.push(geoToScene(wps[j][0], wps[j][1], 0.032));
      }
    } else if (RUTAS_WAYPOINTS[claveInversa]) {
      const wpsInv = RUTAS_WAYPOINTS[claveInversa];
      for (let k = wpsInv.length - 1; k >= 0; k--) {
        puntos3D.push(geoToScene(wpsInv[k][0], wpsInv[k][1], 0.032));
      }
    } else {
      const midLat = (pOrigen.lat + pDestino.lat) * 0.5;
      const midLon = (pOrigen.lon + pDestino.lon) * 0.5;
      puntos3D.push(geoToScene(midLat, midLon, 0.032));
    }

    puntos3D.push(geoToScene(pDestino.lat, pDestino.lon, 0.025));
  }

  // Curva spline Catmull-Rom con tensión baja (0.18) para seguir fielmente los canales marítimos sin invadir tierra
  return new THREE.CatmullRomCurve3(puntos3D, false, "catmullrom", 0.18);
}

/**
 * Sincroniza y actualiza la simulación para el timestamp actual.
 */
function actualizarSimulacion() {
  if (viajesTotales.length === 0) return;

  // Filtrar viajes activos en el instante tActualSim
  const viajesActivos = viajesTotales.filter(function (v) {
    const enTiempo =
      v.ts_salida_ms <= tActualSim && v.ts_llegada_ms >= tActualSim;
    if (!enTiempo) return false;
    if (filtroZonaActual === "TODOS") return true;
    return v.zona_ruta === filtroZonaActual;
  });

  const idsActivos = new Set(
    viajesActivos.map(function (v) {
      return v.id_viaje;
    })
  );

  // Eliminar barcos que ya han llegado a puerto o no cumplen el filtro
  barcosEnEscena.forEach(function (item, id) {
    if (!idsActivos.has(id)) {
      scene.remove(item.group);
      scene.remove(item.fullLine);
      scene.remove(item.activeLine);
      item.fullLine.geometry.dispose();
      item.activeLine.geometry.dispose();
      barcosEnEscena.delete(id);
    }
  });

  // Actualizar o crear barcos activos
  viajesActivos.forEach(function (v) {
    let item = barcosEnEscena.get(v.id_viaje);

    if (!item) {
      const pOrig = PUERTOS[v.puerto_origen_id];
      const pDest = PUERTOS[v.puerto_destino_id];
      if (!pOrig || !pDest) return;

      const curve = calcularCurvaRuta(pOrig, pDest, v);
      const colorZona = obtenerColorZona(v.zona_ruta);

      // Línea de la ruta completa (muestreada uniformemente en longitud de arco)
      const puntosRuta = curve.getSpacedPoints(80);
      const geoRuta = new THREE.BufferGeometry().setFromPoints(puntosRuta);
      const matRuta = new THREE.LineBasicMaterial({
        color: colorZona,
        transparent: true,
        opacity: 0.28
      });
      const fullLine = new THREE.Line(geoRuta, matRuta);
      scene.add(fullLine);

      // Línea del tramo recorrido (vibrante)
      const geoTramo = new THREE.BufferGeometry().setFromPoints([
        puntosRuta[0],
        puntosRuta[0]
      ]);
      const matTramo = new THREE.LineBasicMaterial({
        color: colorZona,
        linewidth: 2,
        transparent: true,
        opacity: 0.95
      });
      const activeLine = new THREE.Line(geoTramo, matTramo);
      scene.add(activeLine);

      // Modelo 3D del buque
      const shipGroup = crearModeloBarco3D(v.compania, v.tipo_buque);
      shipGroup.userData = { id_viaje: v.id_viaje, datos: v };
      scene.add(shipGroup);

      item = {
        group: shipGroup,
        curve: curve,
        fullLine: fullLine,
        activeLine: activeLine,
        data: v,
        puntosBase: puntosRuta
      };
      barcosEnEscena.set(v.id_viaje, item);
    }

    // Progreso del viaje: t in [0, 1]
    const durTotal = Math.max(v.ts_llegada_ms - v.ts_salida_ms, 60000);
    const progreso = Math.min(
      1,
      Math.max(0, (tActualSim - v.ts_salida_ms) / durTotal)
    );

    // Posición y orientación a velocidad constante por longitud de arco (getPointAt / getTangentAt)
    const pos = item.curve.getPointAt(progreso);
    const tangent = item.curve.getTangentAt(progreso);

    item.group.position.copy(pos);

    // Rotación del barco encarando la dirección del rumbo
    const angulo = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
    item.group.rotation.z = angulo;

    // Actualizar geometría del tramo recorrido sincronizado con getSpacedPoints
    const numPuntosRecorridos = Math.max(
      1,
      Math.floor(progreso * (item.puntosBase.length - 1)) + 1
    );
    const subPuntos = item.puntosBase.slice(0, numPuntosRecorridos);
    subPuntos.push(pos);
    item.activeLine.geometry.dispose();
    item.activeLine.geometry = new THREE.BufferGeometry().setFromPoints(
      subPuntos
    );

    // Si este barco está seleccionado, enfocarlo con la cámara
    if (selectedShipId === v.id_viaje) {
      camcontrols.target.lerp(new THREE.Vector3(pos.x, pos.y, 0), 0.05);
      actualizarDetallesPanel(v, progreso);
    }
  });

  // Actualizar HUD
  actualizarHUD(viajesActivos.length);
}

/**
 * Actualiza la información del HUD superior y el slider de tiempo.
 */
function actualizarHUD(totalActivos) {
  const fecha = new Date(tActualSim);
  const opcionesFecha = {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  };

  if (hudFecha) {
    hudFecha.textContent = fecha.toLocaleString("es-ES", opcionesFecha);
  }

  if (hudBarcosActivos) {
    hudBarcosActivos.innerHTML =
      "<strong>" +
      totalActivos +
      "</strong> buques navegando ahora · <strong>" +
      viajesTotales.length +
      "</strong> rutas reales registradas";
  }

  // Actualizar posición del slider si el usuario no está arrastrándolo
  if (sliderTiempo && !sliderTiempo.matches(":active")) {
    const rangoTotal = tFinSim - tInicioSim;
    if (rangoTotal > 0) {
      const porcentaje = ((tActualSim - tInicioSim) / rangoTotal) * 100;
      sliderTiempo.value = porcentaje;
    }
  }
}

/**
 * Detección de clics en la escena para seleccionar barcos con Raycaster.
 */
function onDocumentClick(event) {
  if (
    event.target.closest(
      "#hud-container, #controls-bar, #panel-lateral, #legend-container"
    )
  ) {
    return;
  }

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const hitTargets = [];
  barcosEnEscena.forEach(function (item) {
    hitTargets.push(item.group);
  });

  const intersects = raycaster.intersectObjects(hitTargets, true);

  if (intersects.length > 0) {
    let root = intersects[0].object;
    while (root.parent && (!root.userData || !root.userData.id_viaje)) {
      root = root.parent;
    }

    if (root.userData && root.userData.id_viaje) {
      seleccionarBarco(root.userData.id_viaje);
    }
  } else {
    deseleccionarBarco();
  }
}

function seleccionarBarco(idViaje) {
  if (selectedShipId && barcosEnEscena.has(selectedShipId)) {
    barcosEnEscena.get(selectedShipId).group.scale.set(1, 1, 1);
  }

  selectedShipId = idViaje;
  const item = barcosEnEscena.get(idViaje);
  if (!item) return;

  item.group.scale.set(1.45, 1.45, 1.45);

  if (panelLateral) {
    panelLateral.classList.add("visible");
  }

  const progreso = Math.min(
    1,
    Math.max(
      0,
      (tActualSim - item.data.ts_salida_ms) /
        (item.data.ts_llegada_ms - item.data.ts_salida_ms)
    )
  );
  actualizarDetallesPanel(item.data, progreso);
}

function deseleccionarBarco() {
  if (selectedShipId && barcosEnEscena.has(selectedShipId)) {
    const item = barcosEnEscena.get(selectedShipId);
    item.group.scale.set(1, 1, 1);
  }
  selectedShipId = null;
  if (panelLateral) {
    panelLateral.classList.remove("visible");
  }
}

function actualizarDetallesPanel(v, progreso) {
  const pProg = Math.round(progreso * 100);
  const colorZona = obtenerColorZona(v.zona_ruta);
  const hexStr = "#" + colorZona.toString(16).padStart(6, "0");

  document.getElementById("det-nombre").textContent = v.nombre_buque;
  document.getElementById("det-mmsi").textContent =
    "IMO/MMSI: " + v.mmsi + " · " + v.id_viaje;
  document.getElementById("det-compania").textContent = v.compania;
  document.getElementById("det-tipo").textContent = v.tipo_buque;
  document.getElementById("det-zona").textContent = v.zona_ruta;
  document.getElementById("det-zona").style.color = hexStr;

  document.getElementById("det-origen").textContent =
    v.puerto_origen_nombre + " (" + v.puerto_origen_id + ")";
  document.getElementById("det-destino").textContent =
    v.puerto_destino_nombre + " (" + v.puerto_destino_id + ")";
  document.getElementById("det-salida").textContent = v.hora_salida;
  document.getElementById("det-llegada").textContent = v.hora_llegada;

  document.getElementById("det-barra-progreso").style.width = pProg + "%";
  document.getElementById("det-progreso-txt").textContent =
    pProg + "% completado (" + v.duracion_min + " min de travesía)";

  document.getElementById("det-velocidad").textContent =
    v.velocidad_nudos + " kts";
  document.getElementById("det-dimensiones").textContent =
    v.eslora_m + " m × " + v.calado_m + " m";

  document.getElementById("det-viento").textContent = v.viento;
  document.getElementById("det-mar").textContent = v.estado_mar;
  document.getElementById("det-visib").textContent = v.visibilidad;
}

/**
 * Conexión con los botones y controles de la interfaz HTML.
 */
function conectarElementosUI() {
  hudFecha = document.getElementById("hud-fecha");
  hudBarcosActivos = document.getElementById("hud-barcos-activos");

  btnPlayPause = document.getElementById("btn-play-pause");
  selVelocidad = document.getElementById("sel-velocidad");
  sliderTiempo = document.getElementById("slider-tiempo");
  panelLateral = document.getElementById("panel-lateral");
  btnCerrarPanel = document.getElementById("btn-cerrar-panel");
  btnCambiarMapa = document.getElementById("btn-cambiar-mapa");

  if (btnPlayPause) {
    btnPlayPause.addEventListener("click", function () {
      simPausada = !simPausada;
      btnPlayPause.innerHTML = simPausada ? "▶ Reanudar" : "⏸ Pausar";
      btnPlayPause.classList.toggle("paused", simPausada);
    });
  }

  if (selVelocidad) {
    selVelocidad.addEventListener("change", function (e) {
      factorVelocidad = parseFloat(e.target.value);
    });
  }

  if (sliderTiempo) {
    sliderTiempo.addEventListener("input", function (e) {
      const porcentaje = parseFloat(e.target.value) / 100;
      tActualSim = tInicioSim + porcentaje * (tFinSim - tInicioSim);
      actualizarSimulacion();
    });
  }

  if (btnCerrarPanel) {
    btnCerrarPanel.addEventListener("click", deseleccionarBarco);
  }

  if (btnCambiarMapa) {
    btnCambiarMapa.addEventListener("click", alternarTexturaMapa);
  }

  // Botones de filtro de zona
  const filterPills = document.querySelectorAll(".filter-pill");
  filterPills.forEach(function (pill) {
    pill.addEventListener("click", function () {
      filterPills.forEach(function (p) {
        p.classList.remove("active");
      });
      pill.classList.add("active");
      filtroZonaActual = pill.getAttribute("data-zone");
      actualizarSimulacion();
    });
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Bucle principal de animación y renderizado.
 */
function iniciarSimulador() {
  ultimoTiempoFrame = performance.now();
  animate(ultimoTiempoFrame);
}

function animate(tiempoActualMs) {
  requestAnimationFrame(animate);

  if (ultimoTiempoFrame === null) ultimoTiempoFrame = tiempoActualMs;
  const deltaMs = tiempoActualMs - ultimoTiempoFrame;
  ultimoTiempoFrame = tiempoActualMs;

  if (!simPausada && tFinSim > tInicioSim) {
    tActualSim += deltaMs * factorVelocidad * 60;

    if (tActualSim > tFinSim) {
      tActualSim = tInicioSim;
    }

    actualizarSimulacion();
  }

  camcontrols.update();
  renderer.render(scene, camera);
}
