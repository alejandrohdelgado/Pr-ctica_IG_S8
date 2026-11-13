# IGS8 – Mapa de Tráfico Marítimo en España y Canarias

## Introducción
Este proyecto es una visualización interactiva en 3D del tráfico marítimo oficial entre los puertos de la Península Ibérica, el Estrecho de Gibraltar, las Islas Baleares y el Archipiélago Canario, desarrollada con **Three.js**. A partir de datos reales de escalas de buques obtenidos de la sede de datos abiertos de la **Autoridad Portuaria de Santa Cruz de Tenerife / Puertos del Estado** y las líneas regulares de navegación comercial, se proyectan texturas cartográficas y satelitales reales de alta resolución (`EPSG:4326`) sobre el plano geográfico y, para cada travesía activa, se representa un modelo 3D detallado de barco que navega siguiendo la curvatura del corredor marítimo entre su puerto de origen y su puerto de destino. Además, al hacer clic sobre cualquier barco, se despliega un panel lateral con la telemetría náutica oficial del buque (número IMO/MMSI, naviera, eslora, calado, velocidad en nudos y condiciones meteorológicas marítimas).

---

## Trabajo realizado

### Buques y datos reales
Carga y procesado del fichero `src/barcos_rutas_reales.csv` (**523 travesías reales** consolidadas en una ventana operativa continua de 4 días entre el **12/11/2025 y el 15/11/2025**), obtenido a partir de los registros oficiales de escalas marítimas portuarias y rotaciones de líneas regulares. Incluye buques reales con sus identificadores IMO/MMSI y dimensiones oficiales:
- **Fast Ferries y Catamaranes de Alta Velocidad:** *Benchijigua Express* (IMO 9299056), *Bajamar Express* (IMO 9832119), *Bañaderos Express* (IMO 9832121), *Bencomo Express*, *Betancuria Express*, *Bocayna Express* (**Fred. Olsen Express**), *Volcán de Tagoro*, *Volcán de Taidía*, *Volcán de Tirajana* (**Naviera Armas Trasmediterránea**), *Eleanor Roosevelt* y *Cecilia Payne* (**Baleària**).
- **Ferries Ropax Oceánicos y Mediterráneos:** *Ciudad de Valencia*, *Volcán de Tinamar*, *Volcán de Tamadaba*, *Villa de Tazacorte*, *Marie Curie*, *Buenavista Express*, *Hypatia de Alejandría*, *Abel Matutes*, *Ciudad de Palma* y *Juan J. Sister*.
- **Portacontenedores, Buques Tanque y Cruceros:** *Nieves B*, *Candelaria B*, *Beatriz B*, *Verónica B* (**Boluda Lines**), *RS Lisa*, *Maersk Mc-Kinney Møller* (**Maersk**), *CMA CGM Andalucía*, *WEC Vermeer*, *Hespérides*, *Canal Street*, *AIDAcosma*, *Mein Schiff 3*, *MSC Virtuosa*, *Queen Mary 2* y embarcaciones de **Salvamento Marítimo** (*Guardamar Calíope* y *Guardamar Talía*).

Conversión de fechas y horas a marcas temporales en milisegundos (`ts_salida_ms` y `ts_llegada_ms`) para permitir la simulación continua del tráfico marítimo sin tramos vacíos (manteniendo entre 30 y 47 buques simultáneos en navegación a cualquier hora). Las trayectorias se calculan mediante curvas spline multipunto (`THREE.CatmullRomCurve3`) a través de una secuencia de waypoints marítimos reales (`waypoints_ruta`) que bordean con precisión el Estrecho de Gibraltar, Cabo de Gata, Cabo de la Nao, Cabo de San Vicente y los canales interinsulares de Canarias para que ningún buque ni estela cruce masa terrestre.

### Texturas geográficas reales intercambiables
El plano base 3D (`THREE.PlaneGeometry`) se proyecta en coordenadas geográficas equirectangulares exactas (`lon: [-20.0°, 4.5°]`, `lat: [26.0°, 44.0°]`) mediante la función `Map2Range`, e incorpora dos texturas cartográficas reales de alta definición (`2048×1505 px`) entre las que el usuario puede alternar en tiempo real desde la interfaz:
1. **Mapa Satélite Híbrido (`src/mapa_satelite.jpg`):** Ortofoto satelital real combinada con relieve batimétrico submarino y etiquetas geográficas de ciudades, puertos e islas (*World Imagery + Boundaries & Places*).
2. **Mapa Geográfico Físico-Político (`src/mapa_topo.jpg`):** Cartografía física y política de *National Geographic* con relieve sombreado terrestre, fosas y montes submarinos (*Tagus Basin, Gorringe Ridge, Dacia Seamount*) y fronteras.

### Simulación temporal
Simulación interactiva del paso del tiempo con reloj sincronizado en el HUD superior. Permite modificar la velocidad de avance mediante un selector desplegable con 8 niveles de aceleración (**x1, x5, x15, x30, x60, x120, x300 y x600**). Incorpora una **barra deslizante interactiva (timeline scrubber)** que permite desplazarse libremente por cualquier instante entre el 12 y el 15 de noviembre de 2025, actualizando en tiempo real las posiciones y estelas de todos los buques activos. Cuenta además con un botón **Pausar / Reanudar**.

### Modelos 3D y rutas marítimas
Para cada buque activo se genera un modelo 3D compuesto por casco aerodinámico con proa afilada (`THREE.ExtrudeGeometry`), puente de mando escalonado, chimenea con la librea corporativa de la naviera correspondiente (Fred. Olsen, Naviera Armas, Baleària, Maersk/Boluda, Cruceros, Salvamento Marítimo) y una estela de espuma en la popa. El modelo se orienta de forma dinámica en cada fotograma siguiendo el ángulo de rumbo a lo largo de la tangente de la curva:

$$\theta = \text{atan2}(v_y, v_x) - \frac{\pi}{2}$$

Para cada barco se trazan dos líneas:
1. **Línea de ruta completa:** Muestra en tono atenuado y semitransparente el corredor planificado de puerto a puerto.
2. **Línea de tramo recorrido:** Un trazo brillante continuo que avanza en tiempo real desde el puerto de origen hasta la posición actual del buque.

### Interacción y panel de buque
- **HUD superior flotante:**
  - Título y estado de la simulación.
  - Reloj con fecha y hora simulada en tiempo real (noviembre de 2025).
  - Contador dinámico de buques navegando respecto al total de 523 rutas reales registradas.
  - Botones de filtrado rápido por zona (*Todos los buques, Península ↔ Canarias, Interinsular Canarias, Estrecho y Baleares, Tránsito y Carga*).
  - Botón selector de textura cartográfica (*🗺️ Mapa: Satélite Híbrido / 🛰️ Mapa: Geográfico Topográfico*).
- **Panel lateral “Barco seleccionado”:** Se despliega al hacer clic sobre cualquier barco (mediante `THREE.Raycaster`) y muestra:
  - Nombre oficial del buque, número IMO / MMSI e ID de escala.
  - Compañía naviera y tipología del buque.
  - Zona de operación codificada por color.
  - Puerto de origen y puerto de destino con fechas y horas programadas.
  - Barra de progreso del viaje en porcentaje y duración total en minutos.
  - Métricas náuticas reales: velocidad en nudos (`kts`), eslora y calado en metros.
  - Parte meteorológico de la ruta: viento Alisio/Levante, estado de la mar (altura de olas) y visibilidad.
- **Modo seguimiento y liberación:** Al seleccionar un buque, la cámara orbital enfoca suavemente su posición y lo sigue en su travesía. Pulsando la tecla **Escape (Esc)**, haciendo clic en el mar o pulsando el botón `×`, se deselecciona y se recupera el control libre de la cámara.

### Color de la estela y rutas por zonas
Según el corredor marítimo, el color de la estela, ruta y balizamiento portuario cambia de forma distintiva:
- **Península ↔ Canarias:** Rutas en color **amarillo dorado** (`#f5c542`).
- **Interinsular Canarias:** Rutas en color **cian brillante** (`#00e5ff`).
- **Estrecho y Baleares:** Rutas en color **azul eléctrico** (`#3b82f6`).
- **Tránsito Internacional y Carga:** Rutas en color **púrpura / magenta** (`#c084fc`).

---

## Estructura del Proyecto

```text
├── package.json                      # Configuración de dependencias (three 0.152.1, parcel-bundler)
├── README.md                         # Documentación completa del proyecto
├── scripts/
│   └── procesar_datos_reales.py      # Script Python de extracción y consolidación del dataset real
└── src/
    ├── index.html                    # Interfaz de usuario (HUD, filtros, leyenda, panel lateral y controles)
    ├── script_barcos.js              # Lógica 3D en Three.js, carga de datos, Raycaster y motor temporal
    ├── barcos_rutas_reales.csv       # Dataset limpio con 523 travesías marítimas reales (Nov 2025)
    ├── puertos_maritimos.json        # Coordenadas geográficas de los 25 puertos marítimos
    ├── mapa_satelite.jpg             # Textura geográfica Satélite Híbrido con batimetría y etiquetas
    └── mapa_topo.jpg                 # Textura geográfica Físico-Política (National Geographic)
```

---

## Datos y preprocesado del CSV

El conjunto de datos proviene de la sede de Datos Abiertos de la **Autoridad Portuaria de Santa Cruz de Tenerife** (Puertos del Estado) complementado con las programaciones horarias de las navieras que operan en Canarias, Península, Estrecho y Baleares:
- **Portal oficial:** [Datos Abiertos de Puertos de Tenerife (RISP)](https://risp.puertosdetenerife.org/)
- **Recurso oficial descargado:** Catálogo CKAN de *Consulta de Escalas Previstas y Finalizadas* (`ESCALAS_PREVISTAS.xlsx` en `storage.googleapis.com/apsct_ckan_pro/`).

El preprocesado se realiza mediante el script [`scripts/procesar_datos_reales.py`](scripts/procesar_datos_reales.py), que:
1. Extrae los identificadores IMO/MMSI, nombres de buques, navieras, tipos, esloras y calados de las hojas de cálculo oficiales.
2. Normaliza los nombres de los puertos de origen y destino vinculándolos con el diccionario georreferenciado de 25 puertos (`src/puertos_maritimos.json`).
3. Consolida las travesías en la ventana temporal del **12/11/2025 al 15/11/2025**, calculando las duraciones en función de la distancia náutica ortodrómica y la velocidad real en nudos de cada tipo de embarcación.
4. Genera el archivo [`src/barcos_rutas_reales.csv`](src/barcos_rutas_reales.csv) con 523 rutas listas para su consumo en Three.js.

---

## Controles

### Interacción con la escena mediante el ratón:
- **Clic izquierdo y arrastrar:** Rota la cámara en órbita 3D alrededor del mapa (`OrbitControls`).
- **Rueda del ratón:** Zoom para acercarse a los puertos insulares o alejarse a la vista general atlántica.
- **Clic derecho y arrastrar:** Desplazamiento lateral (paneo) sobre el plano del mapa.

### Interacciones con la simulación:
- **Botón “Pausar / Reanudar”:** Detiene o reanuda el reloj de la simulación.
- **Selector de velocidad:** Cambia el factor de aceleración del tiempo (**x1, x5, x15, x30, x60, x120, x300, x600**).
- **Slider de línea temporal:** Permite desplazarse libremente a cualquier hora entre el 12 y el 15 de noviembre de 2025.
- **Botones de filtro de zona:** Permiten mostrar todos los barcos o aislar únicamente una región marítima.
- **Botón “Mapa: Satélite Híbrido / Geográfico Topográfico”:** Alterna en vivo entre las dos texturas geográficas del terreno y océano.
- **Clic izquierdo sobre un barco:** Activa el seguimiento de cámara sobre ese buque y abre el panel lateral con toda su ficha técnica y ruta.
- **Tecla Escape (Esc) o clic en el mar:** Sale del modo seguimiento y devuelve el control libre a la cámara.

---

## Uso de IA

En esta práctica se ha utilizado una IA como apoyo técnico en tareas concretas:
1. **Preprocesado y limpieza de datos abiertos (`scripts/procesar_datos_reales.py`):** Apoyo para parsear los ficheros XML/XLSX de la Autoridad Portuaria, calcular distancias en millas náuticas entre coordenadas de puertos y estructurar el CSV de 523 rutas en la ventana de noviembre de 2025.
2. **Georreferenciación portuaria (`src/puertos_maritimos.json`) y ajuste de texturas `EPSG:4326`:** Asistencia para alinear los límites de longitud (`[-20.0°, 4.5°]`) y latitud (`[26.0°, 44.0°]`) de las texturas cartográficas con la función de proyección `Map2Range` de Three.js.
3. **Diseño de la interfaz HUD y compatibilidad con el bundler de CodeSandbox:** Maquetación CSS de los paneles flotantes tipo *glassmorphism* y ajuste del código a sintaxis ES6 estándar para garantizar su transpilación directa en Parcel y CodeSandbox.

---

## Video
Vídeo de demostración (captura de 45 segundos mostrando la simulación 3D, el cambio de textura geográfica, los filtros por zona, el control de velocidad y la selección de buques con el panel de detalles):
- https://youtu.be/Jvnz-VOLlS4

---

## Recursos gráficos utilizados
- **Texturas geográficas (`src/mapa_satelite.jpg` y `src/mapa_topo.jpg`):** Cartografía satelital, batimétrica y físico-política en proyección equirectangular `WGS84 (EPSG:4326)` exportada mediante servicios abiertos de *Esri World Imagery / National Geographic MapServer*.
- **Modelos 3D procedimentales:** Cascos navales generados mediante `THREE.ExtrudeGeometry`, superestructuras y chimeneas con `THREE.MeshStandardMaterial` y libreas corporativas de *Fred. Olsen Express, Naviera Armas, Baleària, Maersk/Boluda y Salvamento Marítimo*.

---

## Enlace a CodeSandbox / Repositorio
- Enlace al proyecto ejecutable en [CodeSandbox](https://2pcdvf.csb.app/)
