// The site's router and data. Every view's state lives in the address (#/view?key=value), so any view, filter or well can be
// shared as a link. No cookies, no storage, no analytics: the page asks only its own folder (and LINZ, if a background is chosen).
import { el, dateText } from "./util.js";
import { renderSummary, renderTrends, renderMethod, renderPrint, renderWellPage } from "./views.js";
import { mapView } from "./map.js";

const D = { summary: null, wells: null, byId: null, series: null, geo: null };
export const data = D;

async function getJSON(path) {
  const r = await fetch(path, { credentials: "omit", cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export async function loadCore() {
  if (D.summary) return D;
  const [s, w, g] = await Promise.all([getJSON("data/summary.json"), getJSON("data/wells.json"), getJSON("data/geo.json")]);
  D.summary = s;
  D.wells = w;
  D.geo = g;
  D.byId = new Map(w.map((x) => [x.id, x]));
  return D;
}

// the per-well series (about 160 KB) is fetched only when a well is first opened
let seriesPromise = null;
export function loadSeries() {
  if (!seriesPromise) seriesPromise = getJSON("data/series.json").then((s) => (D.series = s));
  return seriesPromise;
}

export function parseHash() {
  // a malformed address (a bad percent-escape, say) opens the summary rather than failing
  try {
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, q] = h.split("?");
    const parts = path.split("/").filter(Boolean);
    return { view: parts[0] || "summary", arg: parts.length > 1 ? decodeURIComponent(parts.slice(1).join("/")) : null, params: new URLSearchParams(q || "") };
  } catch {
    return { view: "summary", arg: null, params: new URLSearchParams() };
  }
}

export function href(view, params = {}, arg = null) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "" && v !== "all") q.set(k, v);
  const path = view === "summary" ? "/" : "/" + view + (arg ? "/" + encodeURIComponent(arg) : "");
  const qs = q.toString();
  return "#" + path + (qs ? "?" + qs : "");
}

// a change of filter replaces the address (no new history entry) and lets the view update in place
export function replaceParams(view, params, arg = null) {
  history.replaceState(null, "", href(view, params, arg));
}

const VIEWS = {
  summary: { render: renderSummary },
  map: mapView,
  trends: { render: renderTrends },
  method: { render: renderMethod },
  print: { render: renderPrint },
  well: { render: renderWellPage },
};

let current = null;

async function route() {
  const main = document.getElementById("main");
  const r = parseHash();
  const v = VIEWS[r.view] || VIEWS.summary;
  for (const a of document.querySelectorAll("[data-view]")) {
    const on = a.dataset.view === r.view || (r.view === "well" && a.dataset.view === "map");
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  try {
    await loadCore();
    if (current && current.view === r.view && v.update && current.arg === r.arg) {
      v.update(r);
      return;
    }
    if (current?.v?.leave) current.v.leave();
    main.replaceChildren();
    current = { view: r.view, v, arg: r.arg };
    await v.render(main, r);
    if (!r.params.get("well") && !r.params.get("sec")) window.scrollTo(0, 0);
    const sec = r.params.get("sec");
    if (sec) document.getElementById("sec-" + sec)?.scrollIntoView({ block: "start" });
    const TITLE = "Groundwater nitrate: Rangitata to Rakaia";
    document.title = r.view === "summary" || !VIEWS[r.view] ? TITLE : (main.querySelector("h1")?.textContent || "Groundwater nitrate") + " · " + TITLE;
  } catch (e) {
    console.error(e);
    main.replaceChildren(el("div", { class: "error", role: "alert" }, el("h1", { text: "This page could not load" }), el("p", { text: String(e.message || e) })));
  }
}

function footer() {
  const m = D.summary.meta;
  document.getElementById("foot-date").textContent = `Results to ${dateText(m.as_at)}; analysis built ${dateText(m.built_at.slice(0, 10))}.`;
  document.getElementById("foot-attr").textContent = m.attribution_statement;
}

function theme() {
  const b = document.getElementById("theme");
  b.addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    window.dispatchEvent(new Event("themechange"));
  });
  // the device switching between light and dark redraws what is drawn in code (the map's symbols)
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => window.dispatchEvent(new Event("themechange")));
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", async () => {
  theme();
  await route();
  if (D.summary) footer();
});
