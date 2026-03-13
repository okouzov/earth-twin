import {
  CITY_MARKERS,
  EMPIRE_COLORS,
  EMPIRE_SERIES,
  RULERS,
  SOURCE_LINKS,
  YEAR_MAX,
  YEAR_MIN,
} from "./history-data.js";

const DEFAULT_VIEW = {
  center: [104, 36],
  zoom: 3.35,
  pitch: 10,
  bearing: 0,
};

const BASE_STYLE = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
      maxzoom: 19,
    },
    terrainSource: {
      type: "raster-dem",
      tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 15,
      attribution: "AWS Terrain Tiles",
    },
  },
  layers: [
    {
      id: "basemap-layer",
      type: "raster",
      source: "basemap",
    },
    {
      id: "terrain-hillshade",
      type: "hillshade",
      source: "terrainSource",
      paint: {
        "hillshade-accent-color": "#384f5f",
        "hillshade-shadow-color": "#20303c",
        "hillshade-highlight-color": "#d9e2e8",
        "hillshade-illumination-anchor": "map",
      },
    },
  ],
};

const elements = {
  yearSlider: document.querySelector("#year-slider"),
  selectedYear: document.querySelector("#selected-year"),
  certaintyChip: document.querySelector("#certainty-chip"),
  uncertaintyCopy: document.querySelector("#uncertainty-copy"),
  timelineTicks: document.querySelector("#timeline-ticks"),
  anchorJumps: document.querySelector("#anchor-jumps"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button")),
  modeCaption: document.querySelector("#mode-caption"),
  playToggle: document.querySelector("#play-toggle"),
  sourceToggle: document.querySelector("#source-toggle"),
  sourceList: document.querySelector("#source-list"),
  mapViewLabel: document.querySelector("#map-view-label"),
  phaseLabel: document.querySelector("#phase-label"),
  mapNote: document.querySelector("#map-note"),
  compareCopy: document.querySelector("#compare-copy"),
  comparePhase: document.querySelector("#compare-phase"),
  mongolArea: document.querySelector("#mongol-area"),
  chinaArea: document.querySelector("#china-area"),
  mongolMeter: document.querySelector("#mongol-meter"),
  chinaMeter: document.querySelector("#china-meter"),
  fitVisible: document.querySelector("#fit-visible"),
  resetView: document.querySelector("#reset-view"),
  mongolCard: document.querySelector("#mongol-card"),
  chinaCard: document.querySelector("#china-card"),
  mapNode: document.querySelector("#map"),
};

const state = {
  year: 1200,
  mode: "compare",
  map: null,
  mapReady: false,
  popup: null,
  playing: false,
  playTimer: null,
};

const SOURCE_BY_ID = new Map(SOURCE_LINKS.map((source) => [source.id, source]));
const ANCHOR_YEARS = Array.from(
  new Set([...EMPIRE_SERIES.mongol.map((item) => item.year), ...EMPIRE_SERIES.china.map((item) => item.year)]),
).sort((a, b) => a - b);

function getRecommendedView(mode, year) {
  if (mode === "mongol") {
    if (year < 1206) {
      return { center: [108, 46], zoom: 4, pitch: 8, bearing: 0 };
    }
    if (year < 1241) {
      return { center: [99, 43], zoom: 3.45, pitch: 10, bearing: 0 };
    }
    if (year < 1368) {
      return { center: [83, 41], zoom: 2.85, pitch: 12, bearing: 0 };
    }
    return { center: [106, 45], zoom: 4.05, pitch: 8, bearing: 0 };
  }

  if (mode === "china") {
    if (year < 1127) {
      return { center: [112, 34], zoom: 4.15, pitch: 8, bearing: 0 };
    }
    if (year < 1279) {
      return { center: [114, 30], zoom: 4.2, pitch: 8, bearing: 0 };
    }
    if (year < 1368) {
      return { center: [109, 36], zoom: 3.45, pitch: 10, bearing: 0 };
    }
    return { center: [111, 33], zoom: 4.05, pitch: 8, bearing: 0 };
  }

  if (year < 1206) {
    return { center: [111, 35], zoom: 3.55, pitch: 8, bearing: 0 };
  }
  if (year < 1279) {
    return { center: [105, 35], zoom: 3.45, pitch: 10, bearing: 0 };
  }
  if (year < 1368) {
    return { center: [94, 38], zoom: 3.05, pitch: 12, bearing: 0 };
  }
  return { center: [108, 36], zoom: 3.45, pitch: 8, bearing: 0 };
}
boot();

function boot() {
  renderTimelineTicks();
  renderAnchorButtons();
  renderSourceList();
  bindUi();
  initMap();
  render({ fitMap: false });
}

function bindUi() {
  elements.yearSlider.addEventListener("input", (event) => {
    setYear(Number(event.target.value), { stopPlayback: true, fitMap: false });
  });

  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode, { fitMap: true });
    });
  });

  elements.playToggle.addEventListener("click", () => {
    if (state.playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  elements.anchorJumps.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-year]");
    if (!button) {
      return;
    }
    setYear(Number(button.dataset.year), { stopPlayback: true, fitMap: false });
  });

  document.querySelector(".detail-grid").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-ruler-year]");
    if (!button) {
      return;
    }
    setYear(Number(button.dataset.rulerYear), { stopPlayback: true, fitMap: false });
  });

  elements.sourceToggle.addEventListener("click", () => {
    const isOpen = elements.sourceToggle.getAttribute("aria-expanded") === "true";
    elements.sourceToggle.setAttribute("aria-expanded", String(!isOpen));
    elements.sourceToggle.textContent = isOpen ? "Show" : "Hide";
    elements.sourceList.hidden = isOpen;
  });

  elements.fitVisible.addEventListener("click", () => {
    fitVisibleFeatures();
  });

  elements.resetView.addEventListener("click", () => {
    resetView();
  });
}

function initMap() {
  state.map = new maplibregl.Map({
    container: elements.mapNode,
    style: BASE_STYLE,
    center: DEFAULT_VIEW.center,
    zoom: DEFAULT_VIEW.zoom,
    pitch: DEFAULT_VIEW.pitch,
    bearing: DEFAULT_VIEW.bearing,
    minZoom: 1.4,
    maxZoom: 7.2,
    attributionControl: true,
    antialias: true,
  });

  initSvgOverlay();

  state.map.addControl(
    new maplibregl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: true,
    }),
    "top-right",
  );

  const maybeBootMap = () => {
    if (state.mapReady) {
      return;
    }

    if (typeof state.map.isStyleLoaded === "function" && !state.map.isStyleLoaded()) {
      return;
    }
    if (typeof state.map.setProjection === "function") {
      state.map.setProjection({ type: "globe" });
    }

    if (typeof state.map.setFog === "function") {
      state.map.setFog({
        color: "rgb(19, 31, 37)",
        "high-color": "rgb(33, 69, 89)",
        "space-color": "rgb(4, 8, 11)",
        "horizon-blend": 0.08,
        range: [0.9, 8],
      });
    }

    if (typeof state.map.setTerrain === "function") {
      try {
        state.map.setTerrain({ source: "terrainSource", exaggeration: 1.05 });
      } catch (error) {
        console.warn("Terrain could not be enabled", error);
      }
    }

    state.map.addSource("empires", {
      type: "geojson",
      data: emptyFeatureCollection(),
    });

    state.map.addLayer({
      id: "empire-fill-interpolated",
      type: "fill",
      source: "empires",
      filter: ["==", ["get", "certainty"], "interpolated"],
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": 0.24,
      },
    });

    state.map.addLayer({
      id: "empire-fill-exact",
      type: "fill",
      source: "empires",
      filter: ["==", ["get", "certainty"], "exact"],
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": 0.36,
      },
    });

    state.map.addLayer({
      id: "empire-outline-glow",
      type: "line",
      source: "empires",
      paint: {
        "line-color": ["get", "fillColor"],
        "line-width": ["case", ["==", ["get", "certainty"], "exact"], 8, 5],
        "line-opacity": ["case", ["==", ["get", "certainty"], "exact"], 0.24, 0.14],
        "line-blur": 3,
      },
    });

    state.map.addLayer({
      id: "empire-outline-interpolated",
      type: "line",
      source: "empires",
      filter: ["==", ["get", "certainty"], "interpolated"],
      paint: {
        "line-color": ["get", "lineColor"],
        "line-width": 2,
        "line-opacity": 0.74,
        "line-dasharray": [2, 2],
      },
    });

    state.map.addLayer({
      id: "empire-outline-exact",
      type: "line",
      source: "empires",
      filter: ["==", ["get", "certainty"], "exact"],
      paint: {
        "line-color": ["get", "lineColor"],
        "line-width": 2.9,
        "line-opacity": 0.95,
      },
    });

    state.map.addSource("cities", {
      type: "geojson",
      data: emptyFeatureCollection(),
    });

    state.map.addLayer({
      id: "city-halo",
      type: "circle",
      source: "cities",
      paint: {
        "circle-radius": 16,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.24,
        "circle-stroke-width": 0,
      },
    });

    state.map.addLayer({
      id: "city-point",
      type: "circle",
      source: "cities",
      paint: {
        "circle-radius": 6.4,
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#fff7e8",
        "circle-stroke-width": 1.35,
      },
    });

    state.map.addLayer({
      id: "city-labels",
      type: "symbol",
      source: "cities",
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Semibold"],
        "text-size": 12,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#fff7e8",
        "text-halo-color": "rgba(5, 10, 12, 0.92)",
        "text-halo-width": 1.1,
      },
    });

    state.map.on("mouseenter", "city-point", () => {
      state.map.getCanvas().style.cursor = "pointer";
    });

    state.map.on("mouseleave", "city-point", () => {
      state.map.getCanvas().style.cursor = "";
    });

    state.map.on("move", renderProjectedOverlay);
    state.map.on("resize", renderProjectedOverlay);

    state.map.on("click", "city-point", (event) => {
      const feature = event.features?.[0];
      if (!feature) {
        return;
      }

      if (state.popup) {
        state.popup.remove();
      }

      state.popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: true,
        offset: 12,
      })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(buildPopupMarkup(feature.properties))
        .addTo(state.map);
    });

    state.mapReady = true;
    elements.mapNote.textContent = `Interactive atlas live. ${buildMapNote(state.year)}`;
    render({ fitMap: true });
  };

  state.map.on("load", maybeBootMap);
  const readyCheck = window.setInterval(() => {
    if (state.mapReady) {
      window.clearInterval(readyCheck);
      return;
    }

    if (typeof state.map.isStyleLoaded === "function" && state.map.isStyleLoaded()) {
      maybeBootMap();
      window.clearInterval(readyCheck);
    }
  }, 400);
}

function render(options = {}) {
  const mongolPeriod = getPeriod(EMPIRE_SERIES.mongol, state.year);
  const chinaPeriod = getPeriod(EMPIRE_SERIES.china, state.year);
  const mongolRuler = getRuler(RULERS.mongol, state.year);
  const chinaRuler = getRuler(RULERS.china, state.year);

  document.body.dataset.mode = state.mode;
  elements.yearSlider.value = String(state.year);
  elements.selectedYear.textContent = String(state.year);
  elements.certaintyChip.textContent = buildCertaintyLabel(mongolPeriod, chinaPeriod);
  elements.uncertaintyCopy.textContent = buildUncertaintyCopy(mongolPeriod, chinaPeriod);
  elements.modeCaption.textContent = getModeCaption(state.mode);
  elements.mapViewLabel.textContent = getMapViewLabel(state.mode);
  elements.phaseLabel.textContent =
    state.mode === "compare"
      ? `${mongolPeriod.shortLabel} / ${chinaPeriod.shortLabel}`
      : (state.mode === "mongol" ? mongolPeriod.shortLabel : chinaPeriod.shortLabel);
  elements.mapNote.textContent = buildMapNote(state.year);
  elements.comparePhase.textContent = getComparePhase(state.year);
  elements.compareCopy.textContent = buildCompareCopy(state.year, mongolPeriod, chinaPeriod);
  elements.mongolArea.textContent = formatArea(mongolPeriod.area);
  elements.chinaArea.textContent = formatArea(chinaPeriod.area);
  elements.mongolMeter.style.width = `${Math.min((mongolPeriod.area / 24) * 100, 100)}%`;
  elements.chinaMeter.style.width = `${Math.min((chinaPeriod.area / 24) * 100, 100)}%`;

  elements.mongolCard.innerHTML = buildCardMarkup("mongol", mongolPeriod, mongolRuler);
  elements.chinaCard.innerHTML = buildCardMarkup("china", chinaPeriod, chinaRuler);
  elements.mongolCard.classList.toggle("is-dim", state.mode === "china");
  elements.chinaCard.classList.toggle("is-dim", state.mode === "mongol");

  syncActiveButtons();

  if (state.mapReady) {
    updateMapData(mongolPeriod, chinaPeriod, options.fitMap === true);
  }
}

function updateMapData(mongolPeriod, chinaPeriod, fitMap) {
  const visibleKeys = getVisibleEmpireKeys(state.mode);
  const visiblePeriods = { mongol: mongolPeriod, china: chinaPeriod };

  const empireFeatures = visibleKeys.map((key) => buildEmpireFeature(key, visiblePeriods[key]));
  const visibleCities = CITY_MARKERS.filter((city) => {
    return visibleKeys.includes(city.empire) && state.year >= city.start && state.year <= city.end;
  });

  state.visiblePeriods = visibleKeys.map((key) => ({ key, period: visiblePeriods[key] }));

  state.map.getSource("empires").setData({
    type: "FeatureCollection",
    features: empireFeatures,
  });

  state.map.getSource("cities").setData(emptyFeatureCollection());
  renderProjectedOverlay();
  renderCityMarkers(visibleCities);

  if (fitMap) {
    fitVisibleFeatures();
  }
}

function setYear(year, options = {}) {
  const nextYear = clamp(year, YEAR_MIN, YEAR_MAX);
  state.year = nextYear;

  if (options.stopPlayback) {
    stopPlayback();
  }

  render({ fitMap: options.fitMap === true });
}

function setMode(mode, options = {}) {
  if (!mode || mode === state.mode) {
    return;
  }

  state.mode = mode;
  render({ fitMap: options.fitMap !== false });
}

function startPlayback() {
  if (state.playing) {
    return;
  }

  state.playing = true;
  elements.playToggle.textContent = "Pause";
  elements.playToggle.setAttribute("aria-pressed", "true");

  state.playTimer = window.setInterval(() => {
    const nextYear = state.year >= YEAR_MAX ? YEAR_MIN : state.year + 1;
    setYear(nextYear, { fitMap: false });
  }, 110);
}

function stopPlayback() {
  if (!state.playing) {
    return;
  }

  state.playing = false;
  elements.playToggle.textContent = "Play";
  elements.playToggle.setAttribute("aria-pressed", "false");

  if (state.playTimer) {
    window.clearInterval(state.playTimer);
    state.playTimer = null;
  }
}

function renderTimelineTicks() {
  elements.timelineTicks.innerHTML = ANCHOR_YEARS.map((year) => {
    return `<span class="tick-pill">${year}</span>`;
  }).join("");
}

function renderAnchorButtons() {
  elements.anchorJumps.innerHTML = ANCHOR_YEARS.map((year) => {
    return `<button class="anchor-button" type="button" data-year="${year}">${year}</button>`;
  }).join("");
}

function renderSourceList() {
  elements.sourceList.innerHTML = SOURCE_LINKS.map((source) => {
    return `<li><a href="${source.href}" target="_blank" rel="noreferrer">${source.label}</a></li>`;
  }).join("");
}

function syncActiveButtons() {
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
  });

  elements.anchorJumps.querySelectorAll("button[data-year]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.year) === state.year);
  });
}

function getPeriod(series, year) {
  let index = 0;

  for (let i = 0; i < series.length; i += 1) {
    if (series[i].year <= year) {
      index = i;
    } else {
      break;
    }
  }

  const current = series[index];
  const next = series[index + 1] ?? series[index];

  return {
    ...current,
    nextYear: next.year,
    isExact: year === current.year,
    intervalText:
      next.year !== current.year
        ? `${current.year}-${next.year}`
        : `${current.year}`,
  };
}

function getRuler(series, year) {
  const ruler = series.find((entry) => year >= entry.start && year <= entry.end);
  return ruler ?? series[series.length - 1];
}

function buildCardMarkup(empireKey, period, ruler) {
  const periodChip = period.isExact ? "Atlas-backed year" : `Interpolated ${period.intervalText}`;
  const sources = period.sources
    .map((sourceId) => SOURCE_BY_ID.get(sourceId)?.label)
    .filter(Boolean)
    .slice(0, 3);

  return `
    <div class="card-head">
      <div>
        <p class="card-label">${empireKey === "mongol" ? "Mongol layer" : "Chinese layer"}</p>
        <h2>${period.title}</h2>
      </div>
      <span class="period-chip">${periodChip}</span>
    </div>
    <p class="card-copy">${period.note}</p>
    <div class="card-stats">
      <div class="stat-box">
        <p class="micro-label">Dynasty / phase</p>
        <strong>${period.dynasty}</strong>
      </div>
      <div class="stat-box">
        <p class="micro-label">Capital</p>
        <strong>${period.capital}</strong>
      </div>
      <div class="stat-box">
        <p class="micro-label">Approx. footprint</p>
        <strong>${formatArea(period.area)}</strong>
      </div>
    </div>
    <div class="ruler-focus">
      <p class="micro-label">Ruler in focus</p>
      <h3>${ruler.name}</h3>
      <p class="ruler-subtitle">${ruler.title} | ${ruler.start}-${ruler.end}</p>
      <p class="card-copy">${ruler.bio}</p>
    </div>
    <div class="ruler-strip">
      ${renderRulerChips(empireKey, ruler.id)}
    </div>
    <div class="source-tags">
      ${sources.map((label) => `<span class="source-tag">${label}</span>`).join("")}
    </div>
  `;
}

function renderRulerChips(empireKey, activeId) {
  return RULERS[empireKey]
    .map((ruler) => {
      const startYear = clamp(ruler.start, YEAR_MIN, YEAR_MAX);
      const activeClass = ruler.id === activeId ? "is-active" : "";
      return `<button class="ruler-chip ${activeClass}" type="button" data-ruler-year="${startYear}">${ruler.name}</button>`;
    })
    .join("");
}

function buildEmpireFeature(empireKey, period) {
  return {
    type: "Feature",
    properties: {
      empire: empireKey,
      certainty: period.isExact ? "exact" : "interpolated",
      fillColor: EMPIRE_COLORS[empireKey].fill,
      lineColor: EMPIRE_COLORS[empireKey].line,
      title: period.title,
    },
    geometry: {
      type: "Polygon",
      coordinates: [period.ring],
    },
  };
}

function buildCityFeature(city) {
  return {
    type: "Feature",
    properties: {
      id: city.id,
      name: city.name,
      empire: city.empire,
      role: city.role,
      note: city.note,
      color: EMPIRE_COLORS[city.empire].fill,
      years: `${city.start}-${city.end}`,
    },
    geometry: {
      type: "Point",
      coordinates: city.coords,
    },
  };
}

function initSvgOverlay() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("map-svg-overlay");
  elements.mapNode.appendChild(svg);
  state.svgOverlay = svg;
}

function renderProjectedOverlay() {
  if (!state.mapReady || !state.svgOverlay) {
    return;
  }

  const width = elements.mapNode.clientWidth;
  const height = elements.mapNode.clientHeight;
  state.svgOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const markup = state.visiblePeriods
    .map(({ key, period }) => buildProjectedOverlayMarkup(key, period))
    .join("");

  state.svgOverlay.innerHTML = markup;
}

function buildProjectedOverlayMarkup(empireKey, period) {
  const path = projectRingPath(period.ring);
  const glowStroke = empireKey === "mongol" ? "rgba(239, 140, 68, 0.38)" : "rgba(40, 183, 154, 0.34)";
  const fill = empireKey === "mongol"
    ? (period.isExact ? "rgba(239, 140, 68, 0.46)" : "rgba(239, 140, 68, 0.28)")
    : (period.isExact ? "rgba(40, 183, 154, 0.42)" : "rgba(40, 183, 154, 0.24)");
  const stroke = period.isExact ? EMPIRE_COLORS[empireKey].line : "rgba(255, 245, 224, 0.72)";
  const dash = period.isExact ? "" : 'stroke-dasharray="8 7"';

  return `
    <path d="${path}" fill="none" stroke="${glowStroke}" stroke-width="14" stroke-linejoin="round" opacity="0.95"></path>
    <path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="3.4" stroke-linejoin="round" vector-effect="non-scaling-stroke" ${dash}></path>
  `;
}

function projectRingPath(ring) {
  return ring
    .map(([lng, lat], index) => {
      const point = state.map.project([lng, lat]);
      const command = index === 0 ? "M" : "L";
      return `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(" ") + " Z";
}

function renderCityMarkers(cities) {
  state.cityMarkers.forEach((marker) => marker.remove());
  state.cityMarkers = [];

  cities.forEach((city) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `map-city-marker map-city-marker-${city.empire}`;
    element.setAttribute("aria-label", `${city.name}: ${city.role}`);
    element.innerHTML = '<span class="map-city-marker-core"></span>';
    element.addEventListener("click", () => {
      showCityPopup(city);
    });

    const marker = new maplibregl.Marker({ element, anchor: "center" })
      .setLngLat(city.coords)
      .addTo(state.map);

    state.cityMarkers.push(marker);
  });
}

function showCityPopup(city) {
  if (state.popup) {
    state.popup.remove();
  }

  state.popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: true,
    offset: 14,
  })
    .setLngLat(city.coords)
    .setHTML(buildPopupMarkup({
      name: city.name,
      empire: city.empire,
      role: city.role,
      note: city.note,
      years: `${city.start}-${city.end}`,
    }))
    .addTo(state.map);
}

function buildPopupMarkup(properties) {
  const label = properties.empire === "mongol" ? "Mongol world" : "Chinese imperial core";
  return `
    <p class="popup-label">${label}</p>
    <h3 class="popup-title">${properties.name}</h3>
    <p class="popup-role">${properties.role} | ${properties.years}</p>
    <p class="popup-copy">${properties.note}</p>
  `;
}

function buildCertaintyLabel(mongolPeriod, chinaPeriod) {
  const visiblePeriods = getVisibleEmpireKeys(state.mode).map((key) => {
    return key === "mongol" ? mongolPeriod : chinaPeriod;
  });
  const exactCount = visiblePeriods.filter((period) => period.isExact).length;

  if (exactCount === visiblePeriods.length) {
    return "Source-backed snapshot";
  }

  if (exactCount === 0) {
    return "Interpolated interval";
  }

  return "Mixed certainty";
}

function buildUncertaintyCopy(mongolPeriod, chinaPeriod) {
  const mongolLine = mongolPeriod.isExact
    ? `Mongol layer is anchored at ${mongolPeriod.year}.`
    : `Mongol layer is softened between ${mongolPeriod.year} and ${mongolPeriod.nextYear}.`;
  const chinaLine = chinaPeriod.isExact
    ? `Chinese layer is anchored at ${chinaPeriod.year}.`
    : `Chinese layer is softened between ${chinaPeriod.year} and ${chinaPeriod.nextYear}.`;

  if (state.mode === "mongol") {
    return mongolLine;
  }

  if (state.mode === "china") {
    return chinaLine;
  }

  return `${mongolLine} ${chinaLine}`;
}

function buildCompareCopy(year, mongolPeriod, chinaPeriod) {
  const ratio = mongolPeriod.area / chinaPeriod.area;
  const ratioCopy = ratio >= 1.05
    ? `The Mongol sphere is about ${ratio.toFixed(1)}x the size of the Chinese imperial core shown here.`
    : ratio <= 0.95
      ? `The Chinese imperial core is about ${(1 / ratio).toFixed(1)}x the size of the Mongol layer shown here.`
      : `The two visible footprints are unusually close in scale here.`;

  if (year < 1206) {
    return `The Song court is the established imperial system, while Mongol power is still a steppe coalition rather than a formal empire. ${ratioCopy}`;
  }

  if (year < 1279) {
    return `This is the conquest century: Mongol armies expand around a shrinking and southernized Song core. ${ratioCopy}`;
  }

  if (year < 1368) {
    return `From 1279 to 1368 the comparison intentionally overlaps, because Yuan China is simultaneously a Chinese empire and the eastern center of Mongol dynastic power. ${ratioCopy}`;
  }

  return `After 1368 the stories diverge again: Ming China recenters south of the steppe while Mongol political authority retreats north. ${ratioCopy}`;
}

function buildMapNote(year) {
  if (year < 1206) {
    return "Early years keep the Mongol layer deliberately faint because the imperial title and institutions are not yet in place.";
  }

  if (year < 1279) {
    return "Watch the north China frontier and the cities of Kaifeng, Lin'an, and Zhongdu's region as the two systems compress into one another.";
  }

  if (year < 1368) {
    return "The overlap is the point here: Dadu can belong to both the Mongol and Chinese stories at the same time during the Yuan period.";
  }

  return "The late board shows a clean divergence between Ming restoration in China and a steppe-based Northern Yuan remnant.";
}

function getComparePhase(year) {
  if (year < 1206) {
    return "Before imperial unification";
  }
  if (year < 1279) {
    return "Conquest century";
  }
  if (year < 1368) {
    return "Yuan overlap";
  }
  return "Ming restoration";
}

function getModeCaption(mode) {
  switch (mode) {
    case "mongol":
      return "Follow expansion from the steppe homeland to the khanate sphere";
    case "china":
      return "Track the Chinese imperial core from Song to Yuan to Ming";
    default:
      return "Compare both imperial stories";
  }
}

function getMapViewLabel(mode) {
  switch (mode) {
    case "mongol":
      return "Mongol footprint";
    case "china":
      return "Chinese imperial core";
    default:
      return "Mongol + Chinese";
  }
}

function getVisibleEmpireKeys(mode) {
  return mode === "compare" ? ["mongol", "china"] : [mode];
}

function fitVisibleFeatures() {
  if (!state.mapReady) {
    return;
  }

  const view = getRecommendedView(state.mode, state.year);
  state.map.easeTo({
    center: view.center,
    zoom: view.zoom,
    pitch: view.pitch,
    bearing: view.bearing,
    duration: 900,
  });
}

function resetView() {
  if (!state.mapReady) {
    return;
  }

  const view = getRecommendedView("compare", 1279);
  state.map.easeTo({
    center: view.center,
    zoom: view.zoom,
    pitch: view.pitch,
    bearing: view.bearing,
    duration: 900,
  });
}

function extendBounds(bounds, coordinates) {
  if (!Array.isArray(coordinates)) {
    return;
  }

  if (typeof coordinates[0] === "number") {
    bounds.extend(coordinates);
    return;
  }

  coordinates.forEach((nested) => extendBounds(bounds, nested));
}

function formatArea(value) {
  return `~${value.toFixed(1)}M km2`;
}

function emptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}















