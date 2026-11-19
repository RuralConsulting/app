// The map view: every well as a symbol (shape and colour), a switch between latest level, five-year median and trend, filters
// for window, sub-area, depth and date, a legend that counts what is shown, and the selected well beside the map.
// MapLibre (the app's vendored CSP build, copied into this site at build time) is loaded only when the map is first opened.
import { data, href, replaceParams } from "./app.js";
import { CLASSES, LEVELS, classSymbol, cssVar, el, fmt, level, levelOf, levelSymbol, signed, dateText } from "./util.js";
import { wellPanel, zoneBox } from "./views.js";

// LINZ Basemaps: the app's own public browser key (app/js/config.js), used for the same domain; tiles CC BY 4.0 LINZ.
const LINZ_KEY = "d01m5g152dsk2a73kfxb6a9xf1k";
const LINZ = (set) => [`https://basemaps.linz.govt.nz/v1/tiles/${set}/WebMercatorQuad/{z}/{x}/{y}.webp?api=${LINZ_KEY}`];
const LINZ_ATTR = "Background © LINZ CC BY 4.0, Imagery Basemap contributors";
const DEFAULTS = { mode: "latest", win: "20y", sub: "all", depth: "all", since: "2016", bg: "plain" };
const MODES = [["latest", "Latest level"], ["median", "5-year median"], ["trend", "Trend"]];
const SINCE = [["all", "Any time"], ["2016", "Since 2016"], ["2021", "Since 2021"]];

let lib = null;
function loadLib() {
  if (lib) return lib;
  lib = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-ml]')) document.head.append(el("link", { rel: "stylesheet", href: "vendor/maplibre-gl.css", "data-ml": "" }));
    const s = el("script", { src: "vendor/maplibre-gl-csp.js" });
    s.onload = () => {
      try { window.maplibregl.setWorkerUrl("vendor/maplibre-gl-csp-worker.js"); } catch { /* already set */ }
      resolve(window.maplibregl);
    };
    s.onerror = () => reject(new Error("The map library could not load."));
    document.head.append(s);
  });
  return lib;
}

const ALLOWED = { mode: ["latest", "median", "trend"], win: ["10y", "20y"], since: ["all", "2016", "2021"], bg: ["plain", "topo", "aerial"],
  depth: ["all", "shallow", "mid", "deep", "unknown"], sub: ["all", "0", "1", "2"] };

function state(params) {
  // only known values are taken from the address; anything else falls back to the default
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) { const v = params.get(k); if (v && ALLOWED[k].includes(v)) s[k] = v; }
  s.well = params.get("well") || null;
  return s;
}

function trendOf(w, win) { return win === "10y" ? w.t10 : w.t20; }

// which wells are shown, and each one's symbol
export function shown(s) {
  const out = [];
  for (const w of data.wells) {
    if (s.sub !== "all" && String(w.sub) !== s.sub) continue;
    if (s.depth !== "all" && w.dc !== s.depth) continue;
    let icon, v, rank;
    if (s.mode === "latest") {
      if (s.since !== "all" && Number(w.last.slice(0, 4)) < Number(s.since)) continue;
      const k = levelOf(w.lc ? w.latest / 2 : w.latest);
      icon = "lv-" + k; v = w.latest; rank = LEVELS.findIndex((l) => l.key === k);
    } else if (s.mode === "median") {
      if (w.m5 === null) continue;
      const k = levelOf(w.m5);
      icon = "lv-" + k; v = w.m5; rank = LEVELS.findIndex((l) => l.key === k);
    } else {
      const t = trendOf(w, s.win);
      if (!t || t.c === undefined) continue;
      icon = "tr-" + t.c; v = t.s; rank = Math.abs(t.c - 2);
    }
    out.push({ w, icon, v, rank });
  }
  return out;
}

function makeIcon(kind, key, dark) {
  const px = 2, size = 22 * px, c = size / 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  let shape, color, filled = true, r = 6.2 * px;
  if (kind === "lv") { const l = level(key); shape = l.shape; color = cssVar(l.color); r = { under: 5, half: 6.4, over: 6.6 }[key] * px; }
  else { const k = CLASSES[key]; shape = k.shape; color = cssVar(k.color); filled = k.filled; r = (key === 2 ? 4.6 : 7) * px; }
  const path = new Path2D();
  if (shape === "circle") path.arc(c, c, r, 0, Math.PI * 2);
  else if (shape === "square") path.rect(c - r * 0.92, c - r * 0.92, r * 1.84, r * 1.84);
  else if (shape === "diamond") { path.moveTo(c, c - r * 1.2); path.lineTo(c + r * 1.2, c); path.lineTo(c, c + r * 1.2); path.lineTo(c - r * 1.2, c); path.closePath(); }
  else if (shape === "up") { path.moveTo(c, c - r * 1.15); path.lineTo(c + r * 1.1, c + r * 0.85); path.lineTo(c - r * 1.1, c + r * 0.85); path.closePath(); }
  else { path.moveTo(c, c + r * 1.15); path.lineTo(c + r * 1.1, c - r * 0.85); path.lineTo(c - r * 1.1, c - r * 0.85); path.closePath(); }
  g.lineJoin = "round";
  g.lineWidth = 3.2 * px;
  g.strokeStyle = dark ? "rgba(20,20,18,.9)" : "rgba(255,255,255,.95)";
  g.stroke(path);
  if (filled) { g.fillStyle = color; g.fill(path); }
  else { g.fillStyle = dark ? "rgba(28,28,26,.9)" : "rgba(255,255,255,.9)"; g.fill(path); }
  g.lineWidth = (filled ? 1 : 2.2) * px;
  g.strokeStyle = filled ? (dark ? "rgba(0,0,0,.5)" : "rgba(0,0,0,.35)") : color;
  g.stroke(path);
  return { width: size, height: size, data: new Uint8Array(g.getImageData(0, 0, size, size).data.buffer) };
}

const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

let M = null;   // the live view: { map, s, root, ... }

function addImages(map) {
  const dark = isDark();
  const put = (name, img) => { if (map.hasImage(name)) map.updateImage(name, img); else map.addImage(name, img, { pixelRatio: 2 }); };
  for (const l of LEVELS) put("lv-" + l.key, makeIcon("lv", l.key, dark));
  for (const c of CLASSES) put("tr-" + c.i, makeIcon("tr", c.i, dark));
}

function paint(map) {
  const v = (n) => cssVar(n);
  const bg = M.s.bg !== "plain";
  map.setPaintProperty("bg", "background-color", v("--land"));
  map.setPaintProperty("land", "fill-color", v("--land"));
  map.setPaintProperty("land", "fill-opacity", bg ? 0 : 1);
  map.setPaintProperty("land-line", "line-color", v("--rule-2"));
  map.setPaintProperty("area", "fill-color", v("--area"));
  map.setPaintProperty("area", "fill-opacity", bg ? 0.12 : 1);
  map.setPaintProperty("area-line", "line-color", v("--area-line"));
  map.setPaintProperty("rivers", "line-color", v("--water"));
  map.setPaintProperty("sel", "circle-stroke-color", v("--ink"));
  for (const [id, set] of [["linz-topo", "topo"], ["linz-aerial", "aerial"]]) map.setLayoutProperty(id, "visibility", M.s.bg === set ? "visible" : "none");
}

// Positions are published to 3 decimal places (about 100 m), so some wells share a point. Those are drawn on a small ring
// (about 25 m), in well-number order, inside the same 100 m cell, so none hides another.
let spread = null;
function position(w) {
  if (!spread) {
    spread = new Map();
    const at = new Map();
    for (const x of [...data.wells].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const k = x.lon + "," + x.lat;
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(x);
    }
    for (const group of at.values()) group.forEach((x, i) => {
      if (group.length === 1) { spread.set(x.id, [x.lon, x.lat]); return; }
      const a = (2 * Math.PI * i) / group.length;
      spread.set(x.id, [x.lon + 0.0003 * Math.cos(a), x.lat + 0.0002 * Math.sin(a)]);
    });
  }
  return spread.get(w.id);
}

function features(s) {
  return {
    type: "FeatureCollection",
    features: shown(s).map(({ w, icon, rank }) => ({ type: "Feature", properties: { id: w.id, icon, rank }, geometry: { type: "Point", coordinates: position(w) } })),
  };
}

function selFeature(s) {
  const w = s.well && data.byId.get(s.well);
  return { type: "FeatureCollection", features: w ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: position(w) } }] : [] };
}

// the first view frames the Ashburton zone (its outline with a small margin)
function bounds() {
  const b = zoneBox(0.03);
  return [[b.w, b.s], [b.e, b.n]];
}

function controls(s) {
  const seg = (key, opts, label) => el("div", { class: "field" }, el("span", { text: label }),
    el("div", { class: "seg", role: "group", "aria-label": label }, opts.map(([v, t]) => el("button", {
      type: "button", "aria-pressed": String(s[key] === v), onclick: () => set({ [key]: v }), text: t,
    }))));
  const sel = (key, opts, label) => el("label", { class: "field" }, el("span", { text: label }),
    el("select", { onchange: (e) => set({ [key]: e.target.value }) }, opts.map(([v, t]) => el("option", { value: v, selected: s[key] === v, text: t }))));
  const subs = [["all", "All sub-areas"], ...data.summary.meta.subareas.map((n, i) => [String(i), n])];
  const depths = [["all", "All depths"], ...data.summary.meta.depth_classes.map((d) => [d.key, d.label]), ["unknown", "Depth not recorded"]];
  return el("div", { class: "controls" },
    seg("mode", MODES, "Show"),
    s.mode === "trend" ? seg("win", [["10y", "10 years"], ["20y", "20 years"]], "Window") : null,
    s.mode === "latest" ? sel("since", SINCE, "Last sampled") : null,
    sel("sub", subs, "Sub-area"),
    sel("depth", depths, "Well depth"));
}

function legend(s, list) {
  const counts = new Map();
  for (const x of list) counts.set(x.icon, (counts.get(x.icon) || 0) + 1);
  const box = el("div", { class: "legend", "aria-live": "polite" });
  if (s.mode === "trend") {
    const [y0, y1] = data.summary.meta.windows[s.win];
    box.append(el("h4", { text: `Trend ${y0}–${y1}` }), el("ul", {}, [...CLASSES].reverse().map((c) => el("li", {}, classSymbol(c.i, 14), c.label, el("span", { class: "c", text: counts.get("tr-" + c.i) || 0 })))));
    const notShown = data.wells.filter((w) => (s.sub === "all" || String(w.sub) === s.sub) && (s.depth === "all" || w.dc === s.depth) && trendOf(w, s.win).c === undefined).length;
    box.append(el("div", { class: "small", text: `${notShown} wells without enough data for this window are not shown` }));
  } else {
    box.append(el("h4", { text: s.mode === "median" ? `Median ${data.summary.meta.recent[0]}–${data.summary.meta.recent[1]}, mg/L nitrate-N` : "Latest sample, mg/L nitrate-N" }),
      el("ul", {}, [...LEVELS].reverse().map((l) => el("li", {}, levelSymbol(l.key, 14), l.short, el("span", { class: "c", text: counts.get("lv-" + l.key) || 0 })))));
    box.append(el("div", { class: "small", text: `${list.length} wells shown` }));
  }
  return box;
}

function valueText(s, x) {
  if (s.mode === "trend") return `${signed(x.v, 2)}/yr`;
  if (s.mode === "latest") return (x.w.lc ? "< " : "") + fmt(x.v, 1);
  return fmt(x.v, 1);
}

function listPanel(s, list) {
  const sorted = [...list].sort((a, b) => (b.v ?? -1e9) - (a.v ?? -1e9));
  const box = el("section", { class: "panel", "aria-labelledby": "list-h" });
  const what = s.mode === "trend" ? "Sen slope, mg/L a year" : s.mode === "median" ? "five-year median, mg/L" : "latest, mg/L";
  box.append(el("h2", { id: "list-h", text: "Wells shown" }), el("p", { class: "meta", text: `${list.length} wells, highest first (${what}). Choose one to see its samples.` }));
  const search = el("input", { type: "search", placeholder: "Find a well number, e.g. L36/0123", "aria-label": "Find a well by number" });
  const ul = el("div", { class: "listbox", role: "list" });
  const fill = () => {
    const q = search.value.trim().toUpperCase();
    ul.replaceChildren(...sorted.filter((x) => !q || x.w.id.toUpperCase().includes(q)).slice(0, 400).map((x) => el("div", { role: "listitem" },
      el("button", { type: "button", onclick: () => set({ well: x.w.id }, true) },
        x.icon.startsWith("lv") ? levelSymbol(x.icon.slice(3), 14) : classSymbol(Number(x.icon.slice(3)), 14),
        el("span", { text: x.w.id }), el("span", { class: "small", text: x.w.loc || "" }), el("span", { class: "v", text: valueText(s, x) })))));
  };
  search.addEventListener("input", fill);
  fill();
  box.append(search, ul);
  return box;
}

async function side(s) {
  const holder = M.root.querySelector(".side");
  if (s.well && data.byId.has(s.well)) {
    const w = data.byId.get(s.well);
    const panel = await wellPanel(w, s.mode === "trend" ? s.win : (s.win || "20y"), {
      compact: true, onWindow: (win) => set({ win }),
      back: el("button", { type: "button", class: "btn", onclick: () => set({ well: null }, true), text: "← All wells shown" }),
    });
    holder.replaceChildren(panel);
  } else {
    holder.replaceChildren(listPanel(s, shown(s)));
  }
}

function set(change, push = false) {
  const s = { ...M.s, ...change };
  const params = {};
  for (const k of Object.keys(DEFAULTS)) if (s[k] !== DEFAULTS[k]) params[k] = s[k];
  if (s.well) params.well = s.well;
  if (push) location.hash = href("map", params).slice(1);
  else { replaceParams("map", params); apply(s); }
}

function apply(s) {
  const prev = M.s;
  M.s = s;
  const ctl = M.root.querySelector(".controls");
  ctl.replaceWith(controls(s));
  const list = shown(s);
  M.root.querySelector(".legend").replaceWith(legend(s, list));
  M.root.querySelector(".basemap").replaceWith(bgSwitch(s));
  if (M.map && M.ready) {
    M.map.getSource("wells").setData(features(s));
    M.map.getSource("sel").setData(selFeature(s));
    paint(M.map);
    const w = s.well && data.byId.get(s.well);
    if (w && s.well !== prev.well) M.map.easeTo({ center: [w.lon, w.lat], zoom: Math.max(M.map.getZoom(), 9.5) });
  }
  if (s.well !== prev.well || s.mode !== prev.mode || s.win !== prev.win || s.sub !== prev.sub || s.depth !== prev.depth || s.since !== prev.since || !M.sideDone) {
    M.sideDone = true;
    side(s);
  }
}

function bgSwitch(s) {
  return el("div", { class: "basemap" }, el("div", { class: "seg", role: "group", "aria-label": "Background" },
    [["plain", "Plain"], ["topo", "Topo"], ["aerial", "Aerial"]].map(([v, t]) => el("button", { type: "button", "aria-pressed": String(s.bg === v), onclick: () => set({ bg: v }), text: t }))));
}

async function render(main, r) {
  const s = state(r.params);
  const m = data.summary.meta;
  const root = el("div", {});
  M = { s, root, map: null, ready: false, sideDone: false };
  const tip = el("div", { class: "tip", hidden: true });
  const box = el("div", { class: "mapbox" }, el("div", { class: "ml", role: "region", "aria-label": "Map of the wells. The list beside the map has the same wells and works with a keyboard." }), bgSwitch(s), legend(s, shown(s)), tip);
  root.append(
    el("h1", { class: "visually-hidden", text: "Map of groundwater nitrate in the wells" }),
    controls(s),
    el("div", { class: "mapview" }, el("div", { class: "mapcol" }, box,
      el("p", { class: "attrib", text: `Green: Environment Canterbury's Ashburton water management zone, between the Rangitata and Rakaia rivers. Outlines and wells: Environment Canterbury. Wells are shown to about 100 m. Results to ${dateText(m.as_at)}.` })),
    el("div", { class: "side" })));
  main.append(root);
  apply(s);
  let maplibregl;
  try { maplibregl = await loadLib(); } catch (e) {
    box.querySelector(".ml").append(el("p", { class: "error", text: e.message + " The list beside the map still works." }));
    return;
  }
  if (M.root !== root) return;   // left the view while loading
  const map = new maplibregl.Map({
    container: box.querySelector(".ml"),
    style: {
      version: 8,
      sources: {
        geo: { type: "geojson", data: data.geo },
        wells: { type: "geojson", data: features(s) },
        sel: { type: "geojson", data: selFeature(s) },
        "linz-topo": { type: "raster", tiles: LINZ("topo-raster"), tileSize: 256, maxzoom: 18, attribution: LINZ_ATTR },
        "linz-aerial": { type: "raster", tiles: LINZ("aerial"), tileSize: 256, maxzoom: 20, attribution: LINZ_ATTR },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": cssVar("--land") } },
        { id: "linz-topo", type: "raster", source: "linz-topo", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85 } },
        { id: "linz-aerial", type: "raster", source: "linz-aerial", layout: { visibility: "none" } },
        { id: "land", type: "fill", source: "geo", filter: ["==", ["get", "role"], "land"], paint: { "fill-color": cssVar("--land") } },
        { id: "area", type: "fill", source: "geo", filter: ["==", ["get", "role"], "area"], paint: { "fill-color": cssVar("--area") } },
        { id: "land-line", type: "line", source: "geo", filter: ["==", ["get", "role"], "land"], paint: { "line-color": cssVar("--rule-2"), "line-width": 0.8 } },
        { id: "rivers", type: "line", source: "geo", filter: ["==", ["get", "role"], "river"], paint: {
          "line-color": cssVar("--water"), "line-width": ["match", ["get", "kind"], "bound", 2.2, "divide", 1.6, 1.1], "line-opacity": 0.9 } },
        { id: "area-line", type: "line", source: "geo", filter: ["==", ["get", "role"], "area"], paint: { "line-color": cssVar("--area-line"), "line-width": 2 } },
        { id: "sel", type: "circle", source: "sel", paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": cssVar("--ink") } },
        { id: "wells", type: "symbol", source: "wells", layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "rank"] } },
      ],
    },
    bounds: bounds(), fitBoundsOptions: { padding: 30 }, attributionControl: false, dragRotate: false, pitchWithRotate: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },   // (so the map prints, and a full-page picture keeps it)
  });
  M.map = map;
  box.querySelector(".ml").gwnMap = map;   // (the browser test reads the first view and the layers from here)
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Environment Canterbury, CC BY 4.0" }), "bottom-right");
  addImages(map);
  map.on("load", () => {
    M.ready = true;
    paint(map);
    const w = M.s.well && data.byId.get(M.s.well);
    if (w) map.jumpTo({ center: [w.lon, w.lat], zoom: 10 });
  });
  map.on("mousemove", "wells", (e) => {
    const f = e.features[0];
    const x = shown(M.s).find((q) => q.w.id === f.properties.id);
    map.getCanvas().style.cursor = "pointer";
    tip.hidden = false;
    tip.textContent = x ? `${x.w.id} · ${valueText(M.s, x)}${M.s.mode === "trend" ? "" : " mg/L"}` : f.properties.id;
    tip.style.left = e.point.x + 12 + "px";
    tip.style.top = e.point.y + 12 + "px";
  });
  map.on("mouseleave", "wells", () => { tip.hidden = true; map.getCanvas().style.cursor = ""; });
  map.on("click", "wells", (e) => set({ well: e.features[0].properties.id }, true));
  M.onTheme = () => { if (M.map && M.ready) { addImages(M.map); paint(M.map); } };
  window.addEventListener("themechange", M.onTheme);
}

export const mapView = {
  render,
  update(r) { apply(state(r.params)); },
  leave() {
    if (M?.onTheme) window.removeEventListener("themechange", M.onTheme);
    if (M?.map) M.map.remove();
    M = null;
  },
};
