// The views other than the map: summary, a well's page and panel, area trends, method and limits, and the print summary.
import { data, href, loadSeries, replaceParams } from "./app.js";
import { bandChart, classBars, classLegend, dataTable, forest, linesChart, wellChart } from "./charts.js";
import { CLASSES, HALF, LEVELS, MAV, classSymbol, dateText, downloadCSV, el, fmt, intDateToYear, levelOf, levelSymbol, pct, signed, sv } from "./util.js";

const WIN_LABEL = (k) => { const [a, b] = data.summary.meta.windows[k]; return `${a}–${b}`; };
const subName = (i) => data.summary.meta.subareas[i];
const depthName = (k) => (data.summary.meta.depth_classes.find((d) => d.key === k)?.label) || "depth not recorded";
const width = (node, fallback = 700) => Math.floor(node.getBoundingClientRect().width || fallback);
const H = (n) => el("h2", { text: n });

// ---- the area map (SVG; no tiles) -------------------------------------------------------------------------------------------
const BOX = { w: 170.95, e: 172.8, s: -44.22, n: -43.3 };
export function areaMap({ w = 640, colourBy = "median", caption = true } = {}) {
  const k = Math.cos(((BOX.s + BOX.n) / 2) * Math.PI / 180);
  const h = Math.round((w * (BOX.n - BOX.s)) / ((BOX.e - BOX.w) * k));
  const X = (lon) => ((lon - BOX.w) / (BOX.e - BOX.w)) * w, Y = (lat) => ((BOX.n - lat) / (BOX.n - BOX.s)) * h;
  const ring = (r) => "M" + r.map(([a, b]) => `${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join("L") + "Z";
  const line = (r) => "M" + r.map(([a, b]) => `${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join("L");
  const svg = sv("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-labelledby": "areamap-t" });
  svg.append(sv("title", { id: "areamap-t", text: "Map of the area covered: the Ashburton water management zone between the Rangitata and Rakaia rivers, with the wells; the land from the Rakaia to the Waimakariri is shown as not covered." }));
  const pat = sv("pattern", { id: "hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
    sv("rect", { width: 6, height: 6, style: { fill: "var(--notcovered)" } }), sv("line", { x1: 0, y1: 0, x2: 0, y2: 6, "stroke-width": 1.4, style: { stroke: "var(--rule-2)" } }));
  svg.append(sv("defs", {}, pat), sv("rect", { width: w, height: h, style: { fill: "var(--water-2)", opacity: 0.18 } }));
  const polys = (role) => data.geo.features.filter((f) => f.properties.role === role);
  const draw = (f, style) => {
    const g = f.geometry, rings = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    svg.append(sv("path", { d: rings.map((p) => p.map(ring).join("")).join(""), "fill-rule": "evenodd", ...style }));
  };
  for (const f of polys("land")) draw(f, { style: { fill: "var(--land)", stroke: "var(--rule-2)" }, "stroke-width": 0.6 });
  for (const f of polys("notcovered")) draw(f, { fill: "url(#hatch)", style: { stroke: "var(--rule-2)" }, "stroke-width": 0.6 });
  for (const f of polys("area")) draw(f, { style: { fill: "var(--area)", stroke: "var(--area-line)" }, "stroke-width": 1.6 });
  for (const f of polys("river")) {
    const g = f.geometry, parts = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    const wdt = f.properties.kind === "bound" ? 2 : f.properties.kind === "divide" ? 1.4 : 1;
    svg.append(sv("path", { d: parts.map(line).join(""), fill: "none", "stroke-width": wdt, "stroke-linejoin": "round", style: { stroke: "var(--water)" } }));
  }
  const dots = sv("g");
  for (const x of data.wells) {
    const v = colourBy === "median" ? x.m5 : null;
    const k2 = v === null ? null : levelOf(v);
    dots.append(sv("circle", { cx: X(x.lon).toFixed(1), cy: Y(x.lat).toFixed(1), r: k2 ? 2.4 : 1.3,
      style: { fill: k2 ? `var(--lv-${k2})` : "var(--ink-3)", opacity: k2 ? 1 : 0.45 } }));
  }
  svg.append(dots);
  // river names, placed on the river itself: the point 70% of the way towards the coast, turned to the river's direction
  for (const [name, short] of [["Rangitata", "Rangitata"], ["Hinds / Hekeao", "Hinds"], ["Ashburton / Hakatere", "Ashburton"], ["Rakaia", "Rakaia"], ["Selwyn / Waikirikiri", "Selwyn"], ["Waimakariri", "Waimakariri"]]) {
    const pts = [];
    for (const f of polys("river")) {
      if (f.properties.name !== name || f.properties.kind === "other" && !["Selwyn / Waikirikiri", "Waimakariri"].includes(name)) continue;
      const g = f.geometry, parts = g.type === "LineString" ? [g.coordinates] : g.coordinates;
      for (const part of parts) for (const [lon, lat] of part) if (lon > BOX.w && lon < BOX.e && lat > BOX.s && lat < BOX.n) pts.push([X(lon), Y(lat)]);
    }
    if (pts.length < 3) continue;
    pts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    const at = (q) => pts[Math.min(pts.length - 1, Math.floor(q * (pts.length - 1)))];
    const [px, py] = at(0.7), [ax, ay] = at(0.62), [bx, by] = at(0.78);
    let ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    svg.append(sv("text", { x: px, y: py - 5, transform: `rotate(${ang.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})`, "text-anchor": "middle",
      style: { fill: "var(--water)", "font-size": `${Math.max(10, w / 55)}px`, "font-style": "italic", "paint-order": "stroke", stroke: "var(--surface)", "stroke-width": "3px" }, text: short }));
  }
  const big = (t, lon, lat, sub) => {
    svg.append(sv("text", { x: X(lon), y: Y(lat), "text-anchor": "middle", style: { fill: "var(--ink)", "font-weight": "700", "font-size": `${Math.max(11, w / 42)}px`, "paint-order": "stroke", stroke: "var(--surface)", "stroke-width": "4px" }, text: t }));
    if (sub) svg.append(sv("text", { x: X(lon), y: Y(lat) + Math.max(13, w / 36), "text-anchor": "middle", style: { fill: "var(--ink-2)", "font-size": `${Math.max(10, w / 54)}px`, "paint-order": "stroke", stroke: "var(--surface)", "stroke-width": "3px" }, text: sub }));
  };
  big("Covered", 171.32, -43.66, "Rangitata to Rakaia");
  big("Not covered", 172.22, -43.52, "Rakaia to Waimakariri");
  const fig = el("figure", { class: "areamap" }, svg);
  if (caption) {
    fig.append(el("div", { class: "legend-row" },
      el("span", {}, el("span", { class: "sw area" }), "Area analysed (ECan's Ashburton zone)"),
      el("span", {}, el("span", { class: "sw notcovered" }), "Not covered"),
      el("span", {}, el("span", { class: "sw river" }), "Rivers"),
      ...LEVELS.map((l) => el("span", {}, levelSymbol(l.key, 12), ` ${l.short}`)),
      el("span", { class: "muted", text: "Dots: 5-year median, mg/L (grey: not sampled since 2021)" })));
  }
  return fig;
}

// ---- summary -----------------------------------------------------------------------------------------------------------------
function bigNumber(h) {
  const n = h.numbers;
  switch (h.id) {
    case "levels": return [`${pct(n.over_mav, n.wells)}%`, `of wells sampled 2021–25 had a five-year median above the limit (${n.single_sample} of the ${n.wells} have a single sample in those years)`];
    case "trend10y": case "trend20y": {
      const lo = Math.min(n.increasing, n.increasing_if_ties_go_later), hi = Math.max(n.increasing, n.increasing_if_ties_go_later);
      const vl = n["very likely increasing"];
      return [`${n.increasing} of ${n.assessed}`, `wells with enough data: likely or very likely rising${lo !== hi ? ` (${lo} to ${hi} depending on a tie)` : ""}; ${vl} of ${n.assessed} (${pct(vl, n.assessed)}%) very likely`];
    }
    case "rate": return [`${signed(n.median, 2)}`, "mg/L a year, typical well (median Sen slope)"];
    case "panel": return [`${fmt(n.first, 1)} → ${fmt(n.last, 1)}`, `mg/L, the median of the same ${n.wells} wells, ${WIN_LABEL("20y")}`];
    case "depth": return [`${n.deep.over_mav} of ${n.deep.wells}`, "Depth: fewer deep wells over the limit, but not lower overall"];
    default: return ["", ""];
  }
}

export function findings(compact = false) {
  return el("ul", { class: "findings" }, data.summary.headlines.map((h) => {
    const [big, unit] = bigNumber(h);
    return el("li", { class: "finding" },
      el("div", { class: "big" }, big, " ", el("small", { text: unit })),
      el("p", { text: h.text }),
      compact ? null : el("a", { href: h.link, text: "See it →" }));
  }));
}

export async function renderSummary(main) {
  const m = data.summary.meta, c = data.summary.counts;
  const left = el("div", {},
    el("div", { class: "kicker", text: "Independent analysis · Environment Canterbury data" }),
    el("h1", { text: "Groundwater nitrate between the Rangitata and Rakaia rivers: levels and trends" }),
    el("p", { class: "sub", text: "The rest of mid Canterbury, from the Rakaia to the Waimakariri, is not yet covered." }),
    el("p", { class: "lede", text: "Is nitrate in the groundwater under the Ashburton plains rising or falling, and how much of it is above the drinking-water limit? This page answers from the groundwater nitrate results Environment Canterbury published for the area's wells." }),
    el("div", { class: "asat" },
      el("span", { class: "pill", text: `Results to ${dateText(m.as_at)}` }),
      el("span", { class: "pill", text: `Collected from ECan ${m.collected}` }),
      el("span", { class: "pill", text: `${c.wells_in_area_with_nitrate} wells, ${c.observations_in_area.toLocaleString("en-NZ")} sampling days` })),
    el("p", { class: "notice", text: "This analysis covers the Rangitata to the Rakaia: Environment Canterbury's Ashburton water management zone. The plains from the Rakaia to the Waimakariri (the Selwyn - Waihora and Christchurch - West Melton zones) are not covered." }));
  const right = el("div", {});
  main.append(el("section", { class: "hero" }, left, right));
  right.append(areaMap({ w: Math.max(320, width(right, 520)) }));
  main.append(el("h2", { text: "What the data show" }), findings());
  main.append(el("section", { class: "howto" },
    H("How to read this"),
    el("p", { text: `Nitrate is given as nitrate-nitrogen (mg/L as N). The drinking-water limit (New Zealand's Maximum Acceptable Value) is 11.3 mg/L, the same as 50 mg/L as nitrate; half of it, 5.65 mg/L, is the usual early-warning line. A trend says how likely it is that a well's nitrate rose or fell over a fixed window (${WIN_LABEL("10y")} or ${WIN_LABEL("20y")}), using the test New Zealand councils and LAWA use (Mann-Kendall), and how fast (the Sen slope, mg/L a year). "Very likely increasing" means at least 90% confidence that it rose; "indeterminate" means the data cannot say either way. A trend in a well is a trend in that well: ECan's wells were chosen for many reasons, not as a random sample of the aquifer, and nitrate follows land use, rainfall, irrigation and the time water takes to reach a well. Nothing here says why nitrate changed.` }),
    el("p", { text: seasonMixText() }),
    el("p", {}, el("a", { href: "#/map", text: "Open the map" }), " · ", el("a", { href: "#/trends", text: "Area trends" }), " · ", el("a", { href: "#/method", text: "Method, sources and limits" }), " · ", el("a", { href: "#/print", text: "Print summary" }))));
}

// ---- a well -----------------------------------------------------------------------------------------------------------------
function trendFor(w, win) { return win === "10y" ? w.t10 : win === "full" ? w.tf : w.t20; }

function trendSentence(t, win) {
  if (!t || t.c === undefined) {
    const n = t?.na;
    if (typeof n === "number") {
      const span = win === "full" ? "the record" : WIN_LABEL(win);
      return win === "full" ? `Not assessed over the full record: samples in ${n} years (needs 10).` : `Not assessed for ${span}: samples in ${n} of its years (needs at least 80%).`;
    }
    return `Not assessed: ${n || "not enough data"}.`;
  }
  const c = CLASSES[t.c];
  return `${c.label} (${confText(t.p)} confidence of an increase). Sen slope ${signed(t.s, 3)} mg/L a year, about ${signed(t.s * 10, 1)} mg/L a decade; 90% interval ${signed(t.lo, 3)} to ${signed(t.hi, 3)}. ${t.n} values (${t.res}${t.seas ? ", seasonal test" : ""}).`;
}

export function confText(p) {
  if (p >= 0.995) return "over 99%";
  if (p <= 0.005) return "under 1%";
  return `${Math.round(100 * p)}%`;
}

export async function wellPanel(w, win = "20y", { compact = false, onWindow = null, back = null } = {}) {
  const box = el("section", { class: "panel", "aria-labelledby": "well-h" });
  const head = el("div", {});
  if (back) head.append(back);
  head.append(el("h2", { id: "well-h", text: `Well ${w.id}` }),
    el("p", { class: "meta", text: [w.loc, subName(w.sub), w.depth !== null ? `${fmt(w.depth, 1)} m deep` : "depth not recorded"].filter(Boolean).join(" · ") }));
  box.append(head);
  const wins = [["10y", "10 years"], ["20y", "20 years"], ["full", "Full record"]];
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Trend window" }, wins.map(([k, t]) => el("button", {
    type: "button", "aria-pressed": String(win === k), onclick: () => onWindow && onWindow(k), text: t })));
  if (onWindow) box.append(seg);
  const t = trendFor(w, win);
  box.append(el("p", { class: "trendline" }, t && t.c !== undefined ? classSymbol(t.c, 16) : null, el("span", { text: trendSentence(t, win) })));
  const chartHolder = el("div", {}, el("p", { class: "muted", text: "Loading the samples…" }));
  box.append(chartHolder);
  const rows = [
    ["Samples (sampling days)", `${w.n}${w.nc ? `, ${w.nc} below detection` : ""}`],
    ["First and last", `${dateText(w.first)} to ${dateText(w.last)}`],
    ["Latest", `${w.lc ? "< " : ""}${fmt(w.latest, 2)} mg/L (${dateText(w.last)})`],
    [`Median ${data.summary.meta.recent.join("–")}`, w.m5 === null ? "no samples" : `${fmt(w.m5, 2)} mg/L (${w.n5} samples)`],
    [`Highest ${data.summary.meta.recent.join("–")}`, w.x5 === null ? "–" : `${fmt(w.x5, 2)} mg/L`],
    ["Samples above 5.65 / 11.3", `${Math.round(100 * w.so)}% / ${Math.round(100 * w.sm)}%`],
    ["Highest ever", `${fmt(w.max, 2)} mg/L`],
    ["Well depth", w.depth === null ? "not recorded" : `${fmt(w.depth, 1)} m (${depthName(w.dc)})`],
    ["Screen(s)", w.scr.length ? w.scr.map(([a, b]) => `${fmt(a, 1)}–${fmt(b, 1)} m`).join(", ") : "not recorded"],
    ["Sub-area", subName(w.sub)],
  ];
  if (w.nnn) rows.push(["Reported as nitrate+nitrite-N", `${w.nnn} samples (used as nitrate-N; see Method)`]);
  box.append(el("table", { class: "stats" }, el("tbody", {}, rows.map(([a, b]) => el("tr", {}, el("th", { scope: "row", text: a }), el("td", { text: b }))))));
  const links = el("p", { class: "small" });
  if (w.link) links.append(el("a", { href: w.link, target: "_blank", rel: "noopener noreferrer", text: "ECan's page for this well ↗" }));
  if (compact) links.append(w.link ? " · " : "", el("a", { href: href("well", { win }, w.id), text: "Open as a page" }));
  box.append(links);
  loadSeries().then((series) => {
    const pts = (series[w.id] || []).map(([d, v, c, o]) => ({ d, t: intDateToYear(d), v, c: !!c, o }));
    const used = new Set(t?.u || []);
    for (const p of pts) p.used = used.has(p.d);
    const win2 = win === "full" ? (t?.w || null) : data.summary.meta.windows[win];
    chartHolder.replaceChildren(wellChart({ points: pts, trend: t && t.c !== undefined ? t : null, window: t && t.c !== undefined ? win2 : (win === "full" ? null : win2),
      asAt: intDateToYear(Number(data.summary.meta.as_at.replaceAll("-", ""))), width: width(chartHolder, 340), height: compact ? 240 : 320, wellId: w.id }),
    el("p", { class: "small", text: "Dots: samples (teal: the values the trend test used). Open triangles: below the detection limit, drawn at the limit. Dark line: Sen slope over the window, shaded: its 90% interval. Dashed: 5.65 mg/L. Red: 11.3 mg/L." }));
  }).catch((e) => chartHolder.replaceChildren(el("p", { class: "error", text: "The samples could not load: " + e.message })));
  return box;
}

export async function renderWellPage(main, r) {
  const w = data.byId.get(r.arg);
  if (!w) { main.append(el("h1", { text: "Well not found" }), el("p", {}, `No well ${r.arg} in this analysis. `, el("a", { href: "#/map", text: "Open the map" }))); return; }
  const win = ["10y", "20y", "full"].includes(r.params.get("win")) ? r.params.get("win") : "20y";
  main.append(el("p", { class: "no-print" }, el("a", { href: href("map", { well: w.id }), text: "← Back to the map" })));
  main.append(el("h1", { class: "visually-hidden", text: `Well ${w.id}` }));
  main.append(await wellPanel(w, win, { onWindow: (k) => { location.hash = href("well", { win: k }, w.id).slice(1); } }));
  const t = (k) => trendFor(w, k);
  main.append(el("h2", { text: "Trend in every window" }), el("div", { class: "table-wrap" }, dataTable(["Window", "Class", "Confidence of an increase", "Sen slope (mg/L a year)", "90% interval", "Values", "Resolution"],
    ["10y", "20y", "full"].map((k) => {
      const x = t(k);
      const label = k === "full" ? (x?.w ? `${x.w[0]}–${x.w[1]} (full record)` : "Full record") : WIN_LABEL(k);
      return x && x.c !== undefined ? [label, CLASSES[x.c].label, confText(x.p), signed(x.s, 3), `${signed(x.lo, 3)} to ${signed(x.hi, 3)}`, x.n, x.res + (x.seas ? ", seasonal" : "")]
        : [label, "Not assessed", "–", "–", "–", "–", "–"];
    }), [2, 3, 5])));
}

// ---- area trends -----------------------------------------------------------------------------------------------------------
function rowsFor(table) {
  const g = (r, label, strong) => ({ label, strong, counts: CLASSES.map((c) => r[c.label.toLowerCase()]), assessed: r.assessed, na: r.not_assessed });
  return [g(table.all, "All wells", true),
    ...table.subarea.map((r) => g(r, r.group)),
    ...table.depth.filter((r) => r.group !== "unknown" || r.assessed).map((r) => g(r, depthName(r.group).replace(/^./, (s) => s.toUpperCase())))];
}

export async function renderTrends(main, r) {
  const s = data.summary, m = s.meta;
  const win = r.params.get("win") === "10y" ? "10y" : "20y";
  const [y0, y1] = m.windows[win];
  const p = s.panels[win], tab = s.trend_tables[win];
  main.append(el("h1", { text: "Area trends" }),
    el("p", { class: "lede", text: `How nitrate has changed across the area, ${y0} to ${y1}. Choose the window; every chart has its data under "Show the data".` }));
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Window" }, ["10y", "20y"].map((k) => el("button", {
    type: "button", "aria-pressed": String(k === win), onclick: () => { location.hash = href("trends", { win: k }).slice(1); }, text: `${k === "10y" ? "10" : "20"} years, ${WIN_LABEL(k)}` })));
  main.append(el("div", { class: "toolbar" }, seg));

  // 1. the consistent panel
  const sec1 = el("section", { class: "section", id: "sec-panel" });
  main.append(sec1);
  const allYears = s.years_all.filter((d) => d.year >= y0 && d.year <= y1);
  const mt = p.median_trend;
  sec1.append(H("The same wells, every year"), el("p", { text: `${p.wells.length} wells were sampled in every year from ${y0} to ${y1}. Following only these wells means a change in which wells ECan sampled cannot create or hide a trend. The line is the median of the wells' yearly medians, the band the middle half of them. Across those years the median of the ${p.wells.length} wells changed by ${signed(mt.slope, 3)} mg/L a year (Sen slope, 90% interval ${signed(mt.lo, 3)} to ${signed(mt.hi, 3)}; ${mt.class}, ${confText(mt.p_increasing)} confidence of an increase). The dotted line is every well sampled in each year, whatever the year: that set changes from year to year, so read it with care.` }),
    el("p", { text: `These are long-term monitoring wells, not a sample of the area: ${Object.entries(p.subarea).map(([k, v]) => `${v} ${k.replace(" to ", "–")}`).join(", ")}; ${p.deep} of them 80 m or deeper.${mt.lo <= 0 && mt.hi >= 0 ? ` The class is one-sided (the probability that the trend is upward: ${confText(mt.p_increasing)}) while the interval is two-sided, so a probability of about ${Math.round(100 * mt.p_increasing)}% sits with a 90% interval that just includes zero.` : ""}` }));
  sec1.append(bandChart({ years: p.years, other: allYears, width: width(sec1), firstYear: y0, lastYear: y1,
    title: `Median and middle half of nitrate-N, ${p.wells.length} wells sampled every year ${y0}–${y1}`,
    caption: `Solid: the ${p.wells.length} wells sampled every year (median; band: lower to upper quartile). Dotted: all wells sampled that year (${Math.min(...allYears.map((d) => d.wells))} to ${Math.max(...allYears.map((d) => d.wells))} wells; the network changes). Panel by sub-area: ${Object.entries(p.subarea).map(([k, v]) => `${k} ${v}`).join(", ")}; by depth: ${Object.entries(p.depth).map(([k, v]) => `${depthName(k)} ${v}`).join(", ")}.` }));

  // 2. share over the lines
  const sec2 = el("section", { class: "section", id: "sec-share" });
  main.append(sec2);
  const share = (rows, key, den) => rows.map((d) => [d.year, (100 * d[key]) / d[den]]);
  sec2.append(H("Share over each line, by year"), el("p", { text: "Each chart shows three shares: of the same wells every year (solid), of all wells sampled that year (dashed), and of all samples taken that year (dotted). A well's value for a year is the median of its samples that year." }));
  const g2 = el("div", { class: "grid2" });
  sec2.append(g2);
  for (const [lineKey, wellsKey, samplesKey, label] of [[MAV, "wells_over_mav", "samples_over_mav", "Above 11.3 mg/L (the limit)"], [HALF, "wells_over_half", "samples_over_half", "Above 5.65 mg/L (half the limit)"]]) {
    const holder = el("div", {});
    g2.append(holder);
    holder.append(el("h3", { text: label }));
    holder.append(linesChart({
      width: width(g2) / (window.innerWidth > 860 ? 2 : 1) - 10,
      series: [
        { points: share(p.years, wellsKey, "wells"), color: "--line-1", w: 2.5, end: "same wells" },
        { points: share(allYears, wellsKey, "wells"), color: "--line-2", dash: "6 4", end: "all wells" },
        { points: share(allYears, samplesKey, "samples"), color: "--line-2", dash: "1 4", w: 2, end: "samples" },
      ],
      title: `Percentage ${label.toLowerCase()}, by year, ${y0}–${y1}`,
      tableHead: ["Year", "Same wells: over", "Same wells: n", "All wells: over", "All wells: n", "Samples: over", "Samples: n"],
      tableRows: p.years.map((d) => { const a = allYears.find((x) => x.year === d.year) || {}; return [d.year, d[wellsKey], d.wells, a[wellsKey] ?? "–", a.wells ?? "–", a[samplesKey] ?? "–", a.samples ?? "–"]; }),
    }));
  }

  // 3. classes by sub-area and depth
  const sec3 = el("section", { class: "section", id: "sec-depth" });
  main.append(sec3);
  sec3.append(H("Trend classes by sub-area and depth"), el("p", { text: `${tab.all.assessed} of the ${tab.all.assessed + tab.all.not_assessed} wells had enough data for ${y0}–${y1} (samples in at least 80% of the years). Filled shapes are "very likely", hollow ones "likely".` }), classLegend());
  sec3.append(classBars({ rows: rowsFor(tab), width: width(sec3), title: `Number of wells in each trend class, ${y0}–${y1}, by sub-area and depth`,
    caption: "Counts of wells. The number after each bar is the wells assessed in that group; small groups say little on their own." }));
  const lv = s.levels;
  sec3.append(el("h3", { text: `Levels by sub-area and depth, ${m.recent[0]}–${m.recent[1]}` }), el("div", { class: "table-wrap" }, dataTable(
    ["Group", "Wells sampled", "Median of 5-year medians (mg/L)", "Middle half", "Above 5.65", "Above 11.3"],
    [lv.all, ...lv.subarea, ...lv.depth.filter((d) => d.wells)].map((d) => [d.group === "all" ? "All wells" : (m.subareas.includes(d.group) ? d.group : depthName(d.group)), d.wells, fmt(d.median, 2), `${fmt(d.q25, 1)} to ${fmt(d.q75, 1)}`, `${d.over_half} (${pct(d.over_half, d.wells)}%)`, `${d.over_mav} (${pct(d.over_mav, d.wells)}%)`]),
    [1, 2, 4, 5])));

  // 4. how fast
  const sec4 = el("section", { class: "section", id: "sec-slopes" });
  main.append(sec4);
  const key = win === "10y" ? "t10" : "t20";
  const items = data.wells.filter((w) => w[key].c !== undefined).map((w) => ({ id: w.id, ...w[key] })).sort((a, b) => b.s - a.s);
  sec4.append(H("How fast"), el("p", { text: `The Sen slope of each assessed well, fastest rise at the top, with its 90% interval. The typical (median) well changed by ${signed(tab.all.median_slope, 3)} mg/L a year, about ${signed(tab.all.median_slope * 10, 1)} mg/L a decade; the middle half of wells lay between ${signed(tab.all.q25_slope, 2)} and ${signed(tab.all.q75_slope, 2)} mg/L a year.` }));
  sec4.append(forest({ items, median: tab.all.median_slope, width: width(sec4), title: `Sen slopes of ${items.length} wells, ${y0}–${y1}` }));

  // 5. highest and fastest, and the ranked table
  const sec5 = el("section", { class: "section", id: "sec-table" });
  main.append(sec5);
  const top = [...data.wells].filter((w) => w.m5 !== null).sort((a, b) => b.m5 - a.m5).slice(0, 5);
  const fast = items.filter((d) => d.c === 4).slice(0, 5);
  const wl = (id, txt) => el("li", {}, el("a", { href: href("map", { well: id }), text: id }), " ", el("span", { class: "muted", text: txt }));
  sec5.append(H("Where the highest and the fastest-rising wells are"), el("div", { class: "grid2" },
    el("div", {}, el("h3", { text: `Highest five-year medians (${m.recent[0]}–${m.recent[1]})` }), el("ol", {}, top.map((w) => wl(w.id, `${fmt(w.m5, 1)} mg/L · ${subName(w.sub)} · ${w.depth === null ? "depth not recorded" : fmt(w.depth, 0) + " m"}`)))),
    el("div", {}, el("h3", { text: `Fastest very likely rises (${y0}–${y1})` }), el("ol", {}, fast.map((d) => { const w = data.byId.get(d.id); return wl(d.id, `${signed(d.s, 2)} mg/L a year · ${subName(w.sub)} · ${w.depth === null ? "depth not recorded" : fmt(w.depth, 0) + " m"}`); })))));
  sec5.append(rankedTable(win, r));
}

function rankedTable(win, r) {
  const key = win === "10y" ? "t10" : "t20";
  const [y0, y1] = data.summary.meta.windows[win];
  const box = el("div", {});
  const cols = [
    ["id", "Well", (w) => w.id, false], ["sub", "Sub-area", (w) => subName(w.sub), false], ["depth", "Depth (m)", (w) => w.depth, true],
    ["last", "Last sampled", (w) => w.last, false], ["latest", "Latest (mg/L)", (w) => (w.lc ? w.latest / 2 : w.latest), true],
    ["m5", "Median 2021–25", (w) => w.m5, true], ["cls", `Trend ${y0}–${y1}`, (w) => (w[key].c ?? -1), true],
    ["s", "Sen slope (mg/L/yr)", (w) => w[key].s ?? null, true], ["n", "Samples", (w) => w.n, true],
  ];
  let sort = r.params.get("sort") || "s", dir = r.params.get("dir") === "asc" ? 1 : -1;
  const search = el("input", { type: "search", placeholder: "Well number", "aria-label": "Search the table by well number", value: r.params.get("q") || "" });
  const onlyAssessed = el("input", { type: "checkbox", checked: r.params.get("all") !== "1" });
  const tbody = el("tbody");
  const thead = el("thead");
  const count = el("p", { class: "small", "aria-live": "polite" });
  const rows = () => {
    const q = search.value.trim().toUpperCase();
    const c = cols.find((x) => x[0] === sort) || cols[7];
    return data.wells.filter((w) => (!onlyAssessed.checked || w[key].c !== undefined) && (!q || w.id.toUpperCase().includes(q)))
      .sort((a, b) => { const va = c[2](a), vb = c[2](b); if (va === null || va === undefined) return 1; if (vb === null || vb === undefined) return -1; return (va < vb ? -1 : va > vb ? 1 : 0) * dir; });
  };
  const keep = () => replaceParams("trends", { win, sec: "table", sort, dir: dir === 1 ? "asc" : null, q: search.value.trim() || null, all: onlyAssessed.checked ? null : "1" });
  const draw = () => {
    thead.replaceChildren(el("tr", {}, cols.map(([k, label, , num]) => el("th", { scope: "col", class: num ? "r" : null, "aria-sort": sort === k ? (dir === 1 ? "ascending" : "descending") : null },
      el("button", { type: "button", class: "sortbtn", onclick: () => { if (sort === k) dir = -dir; else { sort = k; dir = num ? -1 : 1; } keep(); draw(); }, text: label + (sort === k ? (dir === 1 ? " ↑" : " ↓") : "") })))));
    const list = rows();
    count.textContent = `${list.length} wells`;
    tbody.replaceChildren(...list.map((w) => {
      const t = w[key];
      return el("tr", {},
        el("td", {}, el("a", { href: href("map", { well: w.id }), text: w.id })),
        el("td", { text: subName(w.sub) }), el("td", { class: "r", text: w.depth === null ? "–" : fmt(w.depth, 1) }),
        el("td", { text: dateText(w.last) }), el("td", { class: "r", text: (w.lc ? "< " : "") + fmt(w.latest, 2) }),
        el("td", { class: "r", text: fmt(w.m5, 2) }),
        el("td", {}, t.c !== undefined ? el("span", { class: "classchip" }, classSymbol(t.c, 12), CLASSES[t.c].label) : el("span", { class: "muted", text: "not assessed" })),
        el("td", { class: "r", text: t.c !== undefined ? signed(t.s, 3) : "–" }), el("td", { class: "r", text: w.n }));
    }));
  };
  search.addEventListener("input", () => { keep(); draw(); });
  onlyAssessed.addEventListener("change", () => { keep(); draw(); });
  const csv = () => {
    const head = ["well", "sub_area", "depth_m", "depth_class", "locality", "first_sample", "last_sample", "latest_mg_L", "latest_below_detection",
      "samples", "median_2021_2025", "max_2021_2025", "share_over_5_65", "share_over_11_3",
      "class_2016_2025", "sen_slope_2016_2025", "ci90_low_2016_2025", "ci90_high_2016_2025", "p_increase_2016_2025",
      "class_2006_2025", "sen_slope_2006_2025", "ci90_low_2006_2025", "ci90_high_2006_2025", "p_increase_2006_2025", "ecan_page"];
    const tr = (t) => (t.c !== undefined ? [CLASSES[t.c].label, t.s, t.lo, t.hi, t.p] : ["not assessed", null, null, null, null]);
    downloadCSV(`groundwater-nitrate-wells-${data.summary.meta.as_at}.csv`, head, rows().map((w) => [w.id, subName(w.sub), w.depth, w.dc, w.loc, w.first, w.last, w.latest, w.lc ? "yes" : "no",
      w.n, w.m5, w.x5, w.so, w.sm, ...tr(w.t10), ...tr(w.t20), w.link]));
  };
  box.append(el("h3", { text: "All wells, ranked" }),
    el("div", { class: "toolbar" }, el("label", { class: "field" }, el("span", { text: "Find" }), search),
      el("label", { class: "field" }, el("span", { text: "Show" }), el("span", {}, onlyAssessed, ` only wells assessed for ${y0}–${y1}`)),
      el("button", { type: "button", class: "btn", onclick: csv, text: "Download CSV" })),
    count, el("div", { class: "table-wrap ranked" }, el("table", {}, el("caption", { class: "visually-hidden", text: "Wells, sortable by each column" }), thead, tbody)),
    el("p", { class: "small", text: "Latest is sorted on half the limit where it was below detection. The CSV has the rows shown, both windows, and ECan's page for each well. Data: Environment Canterbury, CC BY 4.0; provisional until reviewed by ECan." }));
  draw();
  return box;
}

export function seasonMixText(where = "on the method page") {
  const m = data.summary.disclose.season_mix;
  return `Most wells are tested on one value a year. Where a well was sampled more than once in a year, LAWA's rule takes the sample nearest the middle of the year (2 July), so a winter value can stand in for a year whose other samples were taken in September to December, the annual survey's months: ${m["10y"].mixed} of the ${m["10y"].yearly} yearly series over ten years and ${m["20y"].mixed} of ${m["20y"].yearly} over twenty mix September-to-December values with values from other months. The sensitivity checks ${where} show what using one season only, or the spring (September to November) sample where there is one, changes.`;
}

function crossText(cc) {
  if (!cc) return "The statistics are written in plain Python and tested against worked examples from Gilbert (1987) and van Belle & Hughes (1984).";
  const d = cc.max_abs_difference;
  const worst = Math.max(...Object.entries(d).filter(([k]) => !k.startsWith("scipy theilslopes interval")).map(([, v]) => v ?? 0));
  return `The statistics are written in plain Python and tested against worked examples from Gilbert (1987) and van Belle & Hughes (1984). Every assessed series (${cc.series}) was also run through scipy and pymannkendall: S, its variance, Z, the probability, the Sen slope, the 90% interval and the Kruskal-Wallis test agree to within ${worst.toExponential(0)}, and ${cc.class_disagreements === 0 ? "no well's class differs" : cc.class_disagreements + " classes differ"}.${cc.current ? "" : " (The cross-check was run on an earlier version of the inputs.)"}`;
}

function resText() {
  const part = (k) => {
    const a = data.wells.map((w) => (k === "10y" ? w.t10 : w.t20)).filter((t) => t.c !== undefined);
    return { n: a.filter((t) => t.res === "yearly").length, all: a.length, seas: a.filter((t) => t.seas).length };
  };
  const a = part("10y"), b = part("20y");
  return `Of the assessed wells, ${a.n} of ${a.all} (ten years) and ${b.n} of ${b.all} (twenty years) are tested on yearly values, mostly wells in ECan's annual survey, which samples once a year; ${a.seas} and ${b.seas} wells showed seasonality and used the seasonal test.`;
}

const MAJORITY = "A majority of assessed wells is rising under every variant tried; individual wells' classes do change";
const pct1 = (a, b) => (b ? (Math.round((1000 * a) / b) / 10).toFixed(1) : "0.0");
const variant = (s, k, start) => s.sensitivity[k].find((v) => v.variant.startsWith(start));

function holdsText(s) {
  const majority = ["10y", "20y"].every((k) => s.sensitivity[k].every((v) => v.increasing > v.assessed / 2));
  const parts = ["10y", "20y"].map((k) => {
    const b = s.trend_tables[k].all, vs = s.sensitivity[k];
    const shares = vs.map((v) => pct(v.increasing, v.assessed)), slopes = vs.map((v) => v.median_slope);
    return `${WIN_LABEL(k)}: ${pct(b.increasing, b.assessed)}% of assessed wells rising as published, ${Math.min(...shares)}% to ${Math.max(...shares)}% across the variants; median slope ${signed(b.median_slope, 3)} as published, ${signed(Math.min(...slopes), 3)} to ${signed(Math.max(...slopes), 3)} across them`;
  });
  const big = [];
  for (const k of ["10y", "20y"]) for (const v of s.sensitivity[k]) for (const c of v.changed_wells) if (c.steps >= 2) big.push(`${c.well} (${WIN_LABEL(k)}, ${v.variant}): from ${c.from} to ${c.to}`);
  const season = ["10y", "20y"].map((k) => variant(s, k, "one season"));
  const steps = season.flatMap((v) => v.changed_wells);
  const one = steps.filter((c) => c.steps === 1).length;
  const cen = Math.max(...["10y", "20y"].flatMap((k) => s.sensitivity[k].filter((v) => v.variant.startsWith("censored")).map((v) => v.class_changed)));
  return `${majority ? MAJORITY + "." : "Not every variant keeps a majority of rising wells: see the table."} ${parts.join(". ")}. ` +
    `The censoring choice changes ${cen === 0 ? "no well's class" : cen === 1 ? "1 well's class" : `${cen} wells' classes`} or fewer. The one-season check changes ${season[0].class_changed} of ${season[0].both_assessed} classes over ten years and ${season[1].class_changed} of ${season[1].both_assessed} over twenty; ${one} of those ${steps.length} changes are one step (for example from "likely" to "very likely", or to "indeterminate"). ` +
    (big.length ? `Changes of more than one step: ${big.join("; ")}.` : "No well changes by more than one step.");
}

function tieText(s) {
  const out = [];
  for (const k of ["10y", "20y"]) {
    const v = variant(s, k, "two samples equally near");
    for (const c of v.changed_wells) out.push(`${c.well} (${WIN_LABEL(k)}) would read ${c.to} rather than ${c.from}, making ${v.increasing} of ${v.assessed} (${pct(v.increasing, v.assessed)}%) rising rather than ${s.trend_tables[k].all.increasing} of ${s.trend_tables[k].all.assessed} (${pct(s.trend_tables[k].all.increasing, s.trend_tables[k].all.assessed)}%)`);
  }
  return out.length ? `Breaking that tie the other way (a sensitivity check) changes one result: ${out.join("; ")}.` : "Breaking that tie the other way changes no well's class.";
}

function sharedText(s) {
  const d = s.disclose;
  const ids = d.shared_sample_ids.map((x) => `sample ${x.sample_id} (${[...new Set(x.rows.filter((r) => r.parameter === "nitrate-n").map((r) => r.value_text))].join(", ")} mg/L nitrate-N, ${x.rows[0].date}) under ${x.wells.join(" and ")}`);
  const parts = ["10y", "20y"].map((k) => {
    const v = variant(s, k, "the two ECan sample ids"), pc = s.panels[k].shared_check, mt = s.panels[k].median_trend;
    const moved = pc.moved.map((x) => `${x.year} median moves from ${fmt(x.from, 2)} to ${fmt(x.to, 2)}`).join(", ");
    const prob = mt.p_increasing > 0.999 && pc.p_increasing > 0.999 ? "the probability stays above 0.999" : `${k === "10y" ? "its probability of an upward trend" : "the probability"} from ${fmt(mt.p_increasing, 3)} to ${fmt(pc.p_increasing, 3)}`;
    const cls = v.class_changed === 0 ? "no well's class changes" : v.class_changed === 1 ? "1 well's class changes" : `${v.class_changed} wells' classes change`;
    return `${WIN_LABEL(k)}: ${cls}${v.changed_wells.length ? ` (${v.changed_wells.map((c) => `${c.well} from ${c.from} to ${c.to}`).join("; ")})` : ""}; ${moved ? `${k === "10y" ? "the panel's " : "the "}${moved}` : "the panel's median does not move"} and ${prob}`;
  });
  const lost = [...new Map(["10y", "20y"].flatMap((k) => s.panels[k].shared_check.lost).map((x) => [x.well + x.year, x])).values()];
  const lostText = lost.length ? ` (${lost.map((x) => `${x.well} then has no ${x.year} value`).join("; ")})` : "";
  return `Two ECan sample ids are each attached to two wells: ${ids.join("; ")}. A sample belongs to one well, so these look like attribution errors upstream; the data are kept as ECan published them (where a well has its own sample the same day, the two are averaged). Left out of both wells, as a sensitivity check, with the panels kept as published${lostText}: ${parts.join(". ")}.`;
}

function repText(s) {
  const d = s.disclose, lv = s.levels.all, t3 = d.recent_three_or_more;
  const g = d.geotechnical_cluster, up = (x, n) => (Math.ceil(x * 10 ** n - 1e-9) / 10 ** n).toFixed(n);
  const cl = g && g.wells ? `${g.wells} geotechnical investigation wells at ${g.locality}, ${up(g.max_depth, 1)} m deep or less, with five-year medians of ${up(g.max_median, 2)} mg/L or less` : "";
  return `The wells sampled in ${s.meta.recent.join("–")} are not a representative network. ${d.recent_single_sample} of the ${lv.wells} have a single sample in those years, and some are clusters: ${cl}${cl ? "; " : ""}${d.recent_top_localities.map(([l, n]) => `${n} wells give the locality ${l}`).join(", ")}. Counting only the ${t3.wells} wells with at least three samples in those years, ${t3.over_half} (${pct(t3.over_half, t3.wells)}%) had a median above 5.65 mg/L and ${t3.over_mav} (${pct(t3.over_mav, t3.wells)}%) above 11.3 mg/L, against ${pct(lv.over_half, lv.wells)}% and ${pct(lv.over_mav, lv.wells)}% for all ${lv.wells}.`;
}

function depthText(s) {
  const dep = Object.fromEntries(s.levels.depth.map((d) => [d.group, d]));
  const sh = dep.shallow, dp = dep.deep, md = dep.mid, t = s.disclose.depth_test;
  return `Depth: deep wells (80 m or more) were less often above the limit in ${s.meta.recent.join("–")} (${dp.over_mav} of ${dp.wells}) than wells under 30 m (${sh.over_mav} of ${sh.wells}; Fisher's exact test, two-sided, p = ${fmt(t.deep_v_shallow_over_mav_p, 2)}) or all shallower wells (${sh.over_mav + md.over_mav} of ${sh.wells + md.wells}; p = ${fmt(t.deep_v_all_shallower_over_mav_p, 2)}). The difference is suggestive, not established, and deep wells were not lower overall: their median was ${fmt(dp.median, 2)} mg/L against ${fmt(sh.median, 2)} mg/L under 30 m, and ${dp.over_half} of ${dp.wells} were above half the limit.`;
}

function dataRowsText(s) {
  const d = s.disclose, u = d.unit_check, np = d.nonpositive_difference, cl = d.clamped_to_zero, nz = d.no2_censored_as_zero, na = d.nitrite_area;
  const odd = d.odd_rows;
  const none = (a) => (a.length ? `${a.length} of them assessed for trend (${a.join(", ")})` : "none of them assessed for trend");
  return {
    units: `One basis: nitrate-nitrogen, mg/L as N. What establishes this is ECan's own naming and units: the results are "Nitrate Nitrogen", "Nitrite Nitrogen" and "Nitrate-N Nitrite-N", in mg/L (g/m3 for the last, the same unit). A check on the ${u.samples} samples that report all three (nitrite below detection counted as 0): nitrate+nitrite-N equals nitrate-N plus nitrite-N within 0.01 mg/L for ${u.within_0_01} (${pct1(u.within_0_01, u.samples)}%), within 0.1 mg/L for ${u.within_0_1} (${pct1(u.within_0_1, u.samples)}%), and differs by more than 1 mg/L for ${u.over_1} (${pct1(u.over_1, u.samples)}%); the largest difference is ${fmt(u.max, 2)} mg/L (well ${u.max_well}). On its own this check proves little: ${u.calculation_rows} rows in ECan's file carry the text "Calculation: (Nitrate-N + Nitrite-N) - NO2N. In-House.", so at least some nitrate-N results are themselves calculated from the sum, and for those the identity is circular. No conversion was needed; a result as nitrate (NO3) would be 4.43 times its nitrate-N value.`,
    nitrite: `Where it had only nitrate+nitrite-N, nitrite-N of the same sample was subtracted when there was one (${s.counts.origins_in_area["nnn-minus-nitrite"] ?? 0} sampling days), otherwise nitrate+nitrite-N was used as it is and flagged (${s.counts.origins_in_area["nnn-as-is"] ?? 0}). A nitrite result below detection counts as 0 when subtracted (${nz.days} sampling days in the area). A difference of zero or below (nitrite reported at or above the sum) is set to 0 and kept as an uncensored value: ${np.days} sampling days in ${np.wells} wells (${cl.days} of them below zero), ${none(np.assessed_wells)}, ${np.recent_wells} of those wells sampled in ${s.meta.recent.join("–")}. In the area, nitrite-N has a median of ${fmt(na.median_half_limit, 3)} mg/L and a 95th percentile of ${fmt(na.p95_half_limit, 2)} mg/L (${na.results} results; values below detection at half the limit).`,
    odd: `ECan's file also has odd rows, kept or left out as the QA summary (JSON, linked below) lists: ${odd.bacterium_name_as_value.rows} nitrate rows at ${odd.bacterium_name_as_value.wells.join(", ")} whose value is the name of a bacterium (left out), and ${odd.long_decimals.rows} rows at ${odd.long_decimals.wells.length} wells written to four or more decimal places, unlike ECan's usual three (kept), ${none(odd.long_decimals.assessed)}. ${d.blank_sample_id_rows} rows have no sample id; each is treated as its own sample.`,
  };
}

// ---- method and limits ----------------------------------------------------------------------------------------------------------
export async function renderMethod(main) {
  const s = data.summary, m = s.meta, c = s.counts;
  const t10 = s.trend_tables["10y"].all, t20 = s.trend_tables["20y"].all;
  const p = (text) => el("p", { text });
  const li = (text) => el("li", { text });
  const sensRows = [];
  for (const k of ["10y", "20y"]) {
    const base = s.trend_tables[k].all;
    sensRows.push([WIN_LABEL(k), "Baseline (as published)", base.assessed, `${base.increasing} (${pct(base.increasing, base.assessed)}%)`, base.decreasing, base["very likely increasing"], signed(base.median_slope, 3), "–"]);
    for (const v of s.sensitivity[k]) sensRows.push([WIN_LABEL(k), v.variant, v.assessed, `${v.increasing} (${pct(v.increasing, v.assessed)}%)`, v.decreasing, v.very_likely_increasing, signed(v.median_slope, 3), `${v.class_changed} of ${v.both_assessed} (rising/not rising: ${v.increasing_status_changed})`]);
  }
  const o = c.origins_in_area;
  const dr = dataRowsText(s);
  const LAWA = "https://www.lawa.org.nz/learn/factsheets/calculating-groundwater-quality-trends";
  const TA = "https://www.taumataarowai.govt.nz/home/articles/maximum-amount-of-nitrate-that-is-acceptable-in-drinking-water";
  const NPS = "https://environment.govt.nz/publications/national-policy-statement-for-freshwater-management/";
  const RCL = "https://ruralconsulting.co.nz";
  main.append(el("article", { class: "prose" },
    el("h1", { text: "Method, sources and limits" }),
    el("p", { class: "lede", text: "Exactly what was done, with what data, and what it cannot tell you." }),
    H("The question and the area"),
    p("How much nitrate is in the groundwater between the Rangitata and Rakaia rivers, and is it rising or falling? This analysis covers the Rangitata to the Rakaia: Environment Canterbury's Ashburton water management zone (Canterbury Water Management Strategy), which runs from the coast to the Main Divide between the two rivers. It uses the groundwater results Environment Canterbury published for the zone's wells, collected on " + m.collected + ". The plains from the Rakaia to the Waimakariri (the Selwyn - Waihora and Christchurch - West Melton zones) are not covered. Wells in the collected results that lie outside the Ashburton zone are left out: " +
      Object.entries(c.wells_outside_area).map(([k, v]) => `${v} in ${k}`).join(", ") + "."),
    p(`Sub-areas: which side of the Hinds/Hekeao River (with its South Branch) and the Ashburton River/Hakatere (with its South Branch) a well lies on, from ECan's river network: Rangitata to Hinds, Hinds to Ashburton, Ashburton to Rakaia. That split agrees with ECan's groundwater allocation zones (all Mayfield-Hinds wells fall in "Rangitata to Hinds"; all but one Valetta well in "Hinds to Ashburton"). An inland/coastal split was considered but not made: with ${t20.assessed} wells assessed over twenty years, a further split would leave groups too small to say anything. Depth classes, from the well's recorded depth: shallower than 30 m (the median depth of the ${c.depth_recorded} wells with a recorded depth is ${fmt(c.depth_median_m, 1)} m; ${c.depth_under_30} are shallower than 30 m), 30 to 80 m, and 80 m or deeper (${c.depth_over_80} wells, ${pct(c.depth_over_80, c.depth_recorded)}%); ${c.wells_in_area_with_nitrate - c.depth_recorded} wells have no recorded depth and are kept, shown as such.`),
    H("The data"),
    p(`Every nitrate result Environment Canterbury published for wells in the area, from ECan's public per-well "export all samples" files, collected on ${m.collected}. Wells and their depth, screens and position: ECan's "Water Quality – Groundwater" layer. Positions and results are Environment Canterbury's public records; this page shows wells to about 100 m (positions to 3 decimal places of a degree), and where several wells fall on one such point the map draws them on a small ring about 25 m across so none hides another. Sub-areas and the zone are worked out from ECan's exact positions. Results run from ${dateText(c.first_in_area)} to ${dateText(m.as_at)} in the area. ECan's results are provisional until reviewed by ECan and appear up to about three months after sampling, so 2026 is incomplete.`),
    el("ul", {},
      li(dr.units),
      li(`Where a sample had nitrate-N, it was used (${o["nitrate-n"] ?? 0} sampling days).`),
      li(dr.nitrite),
      li(`The sampling day is the New Zealand local date of ECan's timestamp. Results are grouped into samples by well and ECan sample id; two results of one measure in one sample are averaged (or, if equal, one kept), and two or more samples of one well on one day count once, as the mean of their uncensored values (all below detection: the highest limit). Results below the detection limit (${c.censored_in_area} of ${c.observations_in_area} sampling days in the area) keep their "less than" flag.`),
      li(sharedText(s)),
      li(dr.odd),
      li("Values that were not numbers in ECan's file were left out and listed in the QA summary (JSON, linked below); nothing was dropped without being counted. Results above 50 mg/L were kept but listed for a second look; none was negative or impossible."),
      li("What the files cannot tell: they do not mark field or laboratory measurements (every result is taken as ECan's reported result), they do not link a well number to a well it replaced (each well number is its own well), and they hold no sample depth (the well's recorded depth and screens are used)."),
      li(repText(s))),
    H("Reference values"),
    el("ul", {},
      el("li", {}, "11.3 mg/L as nitrate-nitrogen is the same limit as 50 mg/L as nitrate: New Zealand's Maximum Acceptable Value (MAV) for nitrate in drinking water (", el("a", { href: TA, target: "_blank", rel: "noopener noreferrer", text: "Taumata Arowai, the maximum amount of nitrate that is acceptable in drinking water" }), "). The same page says the Ministry of Health considers the current MAV appropriate and continues to monitor and review the evidence. It applies to water people drink, not to an aquifer as such."),
      li("5.65 mg/L is half the MAV. The same Taumata Arowai page says that when testing of a small or medium supply gives a result above 50% of the MAV, the water must be tested every three months until six results in a row are below 50%; that is why this line is drawn."),
      el("li", {}, "Not used here: the National Policy Statement for Freshwater Management's nitrate toxicity attribute is for rivers and the life in them, not for groundwater or drinking water ", el("a", { href: NPS, target: "_blank", rel: "noopener noreferrer", text: "(National Policy Statement for Freshwater Management 2020, as amended, Appendix 2A, Table 6: rivers; national bottom line annual median 2.4 and annual 95th percentile 3.5 mg/L nitrate-N)" }), ". This analysis reports against the drinking-water limit and half of it, and makes no health claim. 'Above' always means strictly greater than: above 5.65 is more than 5.65 mg/L, above 11.3 is more than 11.3 mg/L.")),
    H("Statistics"),
    el("ul", {},
      li(`Trend windows end at the latest complete year, ${m.last_complete_year}: ten years ${WIN_LABEL("10y")} and twenty years ${WIN_LABEL("20y")}, the windows LAWA's groundwater trend factsheet gives for trends ending in 2025. The full record (from a well's first year with a sample to ${m.last_complete_year}, yearly values, at least 10 years with a sample in at least half the years) is shown for context only.`),
      el("li", {}, "Data rules, from ", el("a", { href: LAWA, target: "_blank", rel: "noopener noreferrer", text: "LAWA's factsheet, Calculating groundwater quality trends" }), ": for each well and window, the finest of monthly, two-monthly, quarterly, half-yearly or yearly at which at least 80% of the increments and at least 80% of the years have a sample. Not assessed: fewer than 80% of years sampled, fewer than 5 values or 3 different uncensored values, or one value repeated in a row for more than half the series. One departure: LAWA's factsheet asks quarterly series for 80% of half-years; requiring 80% of quarters is slightly stricter and only moves a series to a coarser resolution."),
      li(`One value per increment: the sampling day the fewest whole days from the increment's midpoint, which is its first day plus half its length in days rounded down (2 July for a year); of two equally near, the earlier. ${tieText(s)}`),
      li(`Seasons are the increments within a year (months, two-month blocks, quarters or half-years). Where the series is finer than yearly, a Kruskal-Wallis test across the seasons; if p < 0.05 the seasonal Kendall test and seasonal Sen slope are used, otherwise the Mann-Kendall test and Sen slope. The seasonal Kendall variance is the plain sum of the seasons' variances, with no covariance term between seasons; no correction is made for serial correlation (as LAWA). ${resText()}`),
      li(seasonMixText("below")),
      el("li", {}, "Mann-Kendall S with the variance corrected for ties; Z with the continuity correction; the probability that the trend is upward is the normal probability of Z (C = 1 − p/2 in the trend's direction, as LWPTrends and LAWA use). Classes, as ", el("a", { href: LAWA, target: "_blank", rel: "noopener noreferrer", text: "LAWA's" }), ": a probability of 90% or more very likely, 67% to 90% likely, otherwise indeterminate. LAWA calls rising nitrate 'degrading' and falling nitrate 'improving'; here the words are 'increasing' and 'decreasing'. The class is one-sided (how likely an upward or a downward trend is) while the Sen slope's interval is two-sided, so a probability near 95% can sit beside a 90% interval that just touches zero."),
      li(`Values below the detection limit: for the test, all values below the series' highest detection limit tie at one level below it (Helsel 2012); for the Sen slope, half the limit, and the slope between two censored values is zero (as LWPTrends). For medians and shares, half the limit. Only a few values are censored (${c.censored_in_area} sampling days); the sensitivity checks below show what the choice changes.`),
      li("Sen slope: the median of all pairwise slopes (within a season for the seasonal version), mg/L a year, with time as the decimal year of the sampling day (year plus (day of year − 0.5) / days in the year). Its 90% confidence interval comes from the variance of S (Gilbert 1987, section 16.5), interpolating between neighbouring ordered slopes where the rank is fractional. The line on a well's chart passes through the median of (value − slope × time)."),
      li("Consistent panel: the wells with at least one sample in every year of the window; each well's yearly median, then the median and quartiles across the wells (quartiles by linear interpolation). Its median series is tested with Mann-Kendall and the Sen slope, with time in whole years, as a description of those wells, not of the aquifer. Shares by year: of wells, each well's median for the year compared with the line; of samples, every sampling day in the area in that year (values below detection at half the limit)."),
      li(depthText(s)),
      li(crossText(s.crosscheck))),
    H("Sensitivity checks"),
    p("The trend counts were recomputed with censored values at half the limit and at the limit; with a stricter data rule (90% of increments and years); with one season only (one sample a year, the one nearest 1 November, from September to December, the annual survey's months); with ties between two equally near samples broken to the later date; with yearly series taking the spring (September to November) sample where there is one; and with the two ECan sample ids that are attached to two wells left out of both."),
    el("div", { class: "table-wrap" }, dataTable(["Window", "Variant", "Assessed", "Rising", "Falling", "Very likely rising", "Median slope", "Wells whose class changed"], sensRows, [2, 4, 5, 6])),
    p(holdsText(s)),
    H("What this cannot tell you"),
    el("ul", {},
      li("Why nitrate changed. Nitrate in a well reflects land use, how much water drains through the soil, irrigation, rainfall and the years it takes water to reach the well; this analysis does not attribute any change to a cause."),
      li("The state of the whole aquifer. ECan's wells are not a random sample: many are private bores chosen for other reasons, the annual survey samples once a year in spring, and investigation wells cluster where problems were suspected. A trend in a well is a trend in that well."),
      li(`Anything about wells with too little data: only ${t10.assessed} wells had enough data for ${WIN_LABEL("10y")} and ${t20.assessed} for ${WIN_LABEL("20y")}; most wells in the area were sampled once or a few times.`),
      li("Whether your water is safe to drink. Ask your water supplier, or have your own bore tested."),
      li("Anything north of the Rakaia. That land is not covered.")),
    H("Sources, licence and attribution"),
    el("ul", {},
      li(`Groundwater quality results and wells: Environment Canterbury. ${m.attribution_statement} ${m.provisional_note}`),
      li("River lines, water management zones and allocation zones: Environment Canterbury's public map services (gis.ecan.govt.nz), CC BY 4.0."),
      li("Optional map backgrounds: LINZ Basemaps, CC BY 4.0 (Toitū Te Whenua Land Information New Zealand)."),
      el("li", {}, "Drinking-water limit: ", el("a", { href: TA, target: "_blank", rel: "noopener noreferrer", text: "Taumata Arowai" }), ". Trend method: ", el("a", { href: LAWA, target: "_blank", rel: "noopener noreferrer", text: "LAWA, Calculating groundwater quality trends" }), " (following LandWaterPeople's LWPTrends); Helsel (2012) Statistics for Censored Environmental Data; Gilbert (1987) Statistical Methods for Environmental Pollution Monitoring; Hirsch, Slack & Smith (1982)."),
      li("No well owner's name or other personal detail is used: wells are identified by ECan's public well numbers only.")),
    el("h3", { text: "ECan's Water Quality Data Terms of Use (as recorded when the data were collected)" }),
    el("div", { class: "terms", text: m.terms_text || "See ecan.govt.nz/data/water-quality-data." }),
    H("Reproduce it"),
    p("The method and every rule are given on this page. The code and derived data are available from Rural Consulting Limited on request."),
    el("p", {}, el("a", { href: "data/qa.json", text: "QA summary (JSON)" }), " · ", el("a", { href: "data/summary.json", text: "Summary data (JSON)" }), " · ", el("a", { href: "data/wells.json", text: "Wells (JSON)" })),
    el("p", {}, "Questions or corrections: Rural Consulting Limited, ", el("a", { href: RCL, target: "_blank", rel: "noopener noreferrer", text: "ruralconsulting.co.nz" }), "."),
    el("p", { class: "small", text: `Input files: wells.csv ${m.input_sha256["wells.csv"]}; nitrate_results.csv ${m.input_sha256["nitrate_results.csv"]}. Outlines fetched ${dateText(m.outlines_fetched_nz.slice(0, 10))}. Built ${m.built_at}.` })));
}

// ---- print summary --------------------------------------------------------------------------------------------------------
export async function renderPrint(main) {
  const s = data.summary, m = s.meta, c = s.counts;
  const p = s.panels["20y"], t10 = s.trend_tables["10y"], t20 = s.trend_tables["20y"];
  const W = 680;
  const brief = el("article", { class: "brief" });
  main.append(el("div", { class: "no-print toolbar" }, el("button", { type: "button", class: "btn btn-primary", onclick: () => window.print(), text: "Print or save as PDF" }), el("span", { class: "small", text: "Two to three A4 pages." })), brief);
  brief.append(
    el("div", { class: "kicker", text: `Rural Consulting Limited · independent analysis · results to ${dateText(m.as_at)}` }),
    el("h1", { text: "Groundwater nitrate between the Rangitata and Rakaia rivers" }),
    el("p", { class: "lede", text: `Levels and trends from Environment Canterbury's results for ${c.wells_in_area_with_nitrate} wells in the Ashburton water management zone. The rest of mid Canterbury, from the Rakaia to the Waimakariri, is not covered.` }),
    findings(true),
    areaMap({ w: 560 }),
    el("h2", { text: "The same wells, every year" }),
    bandChart({ height: 240, years: p.years, other: s.years_all.filter((d) => d.year >= m.windows["20y"][0] && d.year <= m.windows["20y"][1]), width: W, firstYear: m.windows["20y"][0], lastYear: m.windows["20y"][1],
      title: "Consistent panel", caption: `${p.wells.length} wells sampled every year ${WIN_LABEL("20y")}: median (line) and middle half (band) of their yearly medians; dotted: all wells sampled each year.` }),
    el("h2", { text: "Trend classes (number of wells)" }), classLegend(),
    el("div", { class: "grid2" },
      el("div", {}, el("h3", { text: WIN_LABEL("10y") }), classBars({ rows: rowsFor(t10), width: W / 2 - 8, title: `Trend classes ${WIN_LABEL("10y")}` })),
      el("div", {}, el("h3", { text: WIN_LABEL("20y") }), classBars({ rows: rowsFor(t20), width: W / 2 - 8, title: `Trend classes ${WIN_LABEL("20y")}` }))),
    el("h2", { text: "Method in brief" }),
    el("p", { text: `Nitrate-nitrogen (mg/L as N) from the results Environment Canterbury published for the area's wells (collected ${m.collected}; provisional until reviewed by ECan). Trends: Mann-Kendall (seasonal Kendall where sampling is regular within the year and seasonal), Sen slope with 90% interval, LAWA's data rules (samples in at least 80% of the years) and likelihood classes, windows ${WIN_LABEL("10y")} and ${WIN_LABEL("20y")}. Values below detection: tied at the highest limit for the test, half the limit for slopes and medians. A majority of assessed wells is rising under every variant tried; individual wells' classes do change (see Method). Reference values: 11.3 mg/L, New Zealand's drinking-water Maximum Acceptable Value, and half of it, 5.65 mg/L.` }),
    el("h2", { text: "Limits" }),
    el("ul", {}, [
      "ECan's wells are not a random sample of the aquifer; a trend in a well is a trend in that well.",
      "Nitrate responds to land use, drainage, irrigation and climate, with lags of years; nothing here attributes a cause.",
      `Only ${t10.all.assessed} wells (10 years) and ${t20.all.assessed} (20 years) had enough data for a trend.`,
      "The land north of the Rakaia is not covered.",
    ].map((t) => el("li", { text: t }))),
    el("p", { class: "small", text: `Built ${dateText(m.built_at.slice(0, 10))}. Full method, data and QA: the "Method" view of this site.` }));
}
