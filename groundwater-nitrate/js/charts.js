// Hand-built SVG charts. Each returns a <figure>: the chart (role="img" with a text alternative), a caption, and the data as a
// table under "Show the data". Charts are drawn at the width they are given (the caller measures its column).
import { CLASSES, HALF, MAV, el, fmt, niceTicks, signed, sv, dateText, classSymbol } from "./util.js";

const M = { t: 26, r: 64, b: 30, l: 44 };

function scale(d0, d1, r0, r1) {
  const k = (r1 - r0) / (d1 - d0 || 1);
  const f = (v) => r0 + (v - d0) * k;
  f.inv = (p) => d0 + (p - r0) / k;
  return f;
}

function figure(svg, caption, table, title) {
  const f = el("figure", { class: "chart" });
  const id = "c" + Math.random().toString(36).slice(2, 9);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-labelledby", id + "t");
  svg.prepend(sv("title", { id: id + "t", text: title || caption }));
  f.append(svg);
  if (caption) f.append(el("figcaption", { text: caption }));
  if (table) f.append(el("details", { class: "data" }, el("summary", { text: "Show the data" }), el("div", { class: "table-wrap" }, table)));
  return f;
}

export function dataTable(head, rows, rightCols = []) {
  return el("table", {},
    el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { scope: "col", class: rightCols.includes(i) ? "r" : null, text: h })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c, i) => el("td", { class: rightCols.includes(i) ? "r" : null, text: c ?? "–" }))))));
}

function yAxis(g, y, ticks, x0, x1, fmtTick = (v) => String(v)) {
  const grid = sv("g", { class: "grid" });
  const axis = sv("g", { class: "axis" });
  for (const v of ticks) {
    grid.append(sv("line", { x1: x0, x2: x1, y1: y(v), y2: y(v) }));
    axis.append(sv("text", { x: x0 - 6, y: y(v) + 4, "text-anchor": "end", text: fmtTick(v) }));
  }
  g.append(grid, axis);
}

function xAxisYears(g, x, y0px, years, step) {
  const axis = sv("g", { class: "axis" });
  axis.append(sv("line", { x1: x(years[0]), x2: x(years[years.length - 1]), y1: y0px, y2: y0px }));
  for (const yr of years) {
    if (yr % step) continue;
    axis.append(sv("line", { x1: x(yr), x2: x(yr), y1: y0px, y2: y0px + 4 }));
    axis.append(sv("text", { x: x(yr), y: y0px + 17, "text-anchor": "middle", text: String(yr) }));
  }
  g.append(axis);
}

function refLines(g, y, x0, x1, ymax) {
  for (const [v, name, cls, dash] of [[MAV, "11.3 limit", "--mav", null], [HALF, "5.65 half", "--half", "5 4"]]) {
    if (v > ymax) continue;
    g.append(sv("line", { x1: x0, x2: x1, y1: y(v), y2: y(v), "stroke-width": 1.5, "stroke-dasharray": dash, style: { stroke: `var(${cls})` } }));
    g.append(sv("text", { x: x1 + 6, y: y(v) + 4, class: "lbl", text: name, style: { fill: `var(${cls})` } }));
  }
}

// ---- a well's samples -------------------------------------------------------------------------------------------------------
export function wellChart({ points, trend, window, asAt, width, height = 300, wellId }) {
  const W = Math.max(300, width), H = height;
  const ts = points.map((p) => p.t);
  const tmin = Math.min(...ts, window ? window[0] : Infinity), tmax = Math.max(...ts, asAt, window ? window[1] + 1 : -Infinity);
  const span = tmax - tmin || 1;
  const x = scale(Math.floor(tmin - span * 0.02), tmax + span * 0.02, M.l, W - M.r);
  const vmax = Math.max(12.5, ...points.map((p) => p.v));
  const ymax = Math.ceil(vmax * 1.08);
  const y = scale(0, ymax, H - M.b, M.t);
  const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const clip = "k" + Math.random().toString(36).slice(2, 8);
  svg.append(sv("defs", {}, sv("clipPath", { id: clip }, sv("rect", { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b }))));
  if (window) {
    svg.append(sv("rect", { x: x(window[0]), y: M.t, width: x(window[1] + 1) - x(window[0]), height: H - M.t - M.b, style: { fill: "var(--surface-2)" } }));
    svg.append(sv("text", { x: x(window[0]) + 4, y: M.t + 12, text: `${window[0]}–${window[1]}` }));
  }
  const g = sv("g");
  svg.append(g);
  yAxis(g, y, niceTicks(0, ymax, 5), M.l, W - M.r);
  const y0 = Math.floor(x.inv(M.l)), y1 = Math.ceil(x.inv(W - M.r));
  const years = [];
  for (let yr = y0; yr <= y1; yr++) years.push(yr);
  const step = years.length > 40 ? 10 : years.length > 16 ? 5 : years.length > 8 ? 2 : 1;
  xAxisYears(g, (v) => x(v), H - M.b, years, step);
  refLines(g, y, M.l, W - M.r, ymax);
  if (trend && trend.s !== undefined && trend.s !== null && window) {
    const a = window[0], b = window[1] + 1;
    const plot = sv("g", { "clip-path": `url(#${clip})` });
    if (trend.lo !== null && trend.hi !== null && trend.ilo !== null && trend.ihi !== null) {
      const lo = (t) => trend.ilo + trend.lo * t, hi = (t) => trend.ihi + trend.hi * t;
      plot.append(sv("path", { d: `M${x(a)},${y(lo(a))}L${x(b)},${y(lo(b))}L${x(b)},${y(hi(b))}L${x(a)},${y(hi(a))}Z`, style: { fill: "var(--sen-band)" } }));
    }
    const f = (t) => trend.i + trend.s * t;
    plot.append(sv("line", { x1: x(a), y1: y(f(a)), x2: x(b), y2: y(f(b)), "stroke-width": 2.5, style: { stroke: "var(--sen)" } }));
    svg.append(plot);
  }
  const dots = sv("g");
  for (const p of points) {
    if (p.c) {
      const cx = x(p.t), cy = y(p.v);
      dots.append(sv("path", { d: `M${cx - 4},${cy - 3}L${cx + 4},${cy - 3}L${cx},${cy + 4}Z`, "stroke-width": 1.5, style: { fill: "var(--surface)", stroke: "var(--ink-2)" } }));
    } else {
      dots.append(sv("circle", { cx: x(p.t), cy: y(p.v), r: p.used ? 3.6 : 2.8, "stroke-width": 1, style: { fill: p.used ? "var(--line-1)" : "var(--ink-3)", stroke: "var(--surface)" } }));
    }
  }
  svg.append(dots);
  svg.append(sv("text", { x: 6, y: 12, text: "mg/L nitrate-N", "text-anchor": "start" }));
  const desc = `Nitrate-nitrogen samples at well ${wellId}: ${points.length} values from ${dateText(points[0].d)} to ${dateText(points[points.length - 1].d)}, ` +
    `highest ${fmt(Math.max(...points.map((p) => p.v)), 2)} mg/L.` + (trend && trend.s !== undefined && window ? ` Sen slope ${window[0]}–${window[1]}: ${signed(trend.s, 3)} mg/L a year.` : "");
  const table = dataTable(["Date", "Nitrate-N (mg/L)", "Reported as", "Used in the trend"],
    points.map((p) => [dateText(p.d), (p.c ? "< " : "") + fmt(p.v, 3), ["nitrate-N", "nitrate+nitrite-N minus nitrite-N", "nitrate+nitrite-N", "mixed"][p.o] || "", p.used ? "yes" : ""]), [1]);
  return figure(svg, null, table, desc);
}

// ---- distribution through time (consistent panel) ------------------------------------------------------------------------
export function bandChart({ years, other, width, height = 300, title, caption, firstYear, lastYear }) {
  const W = Math.max(300, width), H = height;
  const xs = years.map((d) => d.year);
  const x = scale(firstYear ?? Math.min(...xs), lastYear ?? Math.max(...xs), M.l, W - M.r);
  const vmax = Math.max(12.5, ...years.map((d) => d.q75), ...(other || []).map((d) => d.median));
  const ymax = Math.ceil(vmax * 1.05);
  const y = scale(0, ymax, H - M.b, M.t);
  const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const g = sv("g");
  svg.append(g);
  yAxis(g, y, niceTicks(0, ymax, 5), M.l, W - M.r);
  const yrs = [];
  for (let yr = Math.min(...xs); yr <= Math.max(...xs); yr++) yrs.push(yr);
  xAxisYears(g, x, H - M.b, yrs, yrs.length > 12 ? 5 : 2);
  refLines(g, y, M.l, W - M.r, ymax);
  const up = years.map((d) => `${x(d.year)},${y(d.q75)}`), dn = [...years].reverse().map((d) => `${x(d.year)},${y(d.q25)}`);
  svg.append(sv("path", { d: `M${up.join("L")}L${dn.join("L")}Z`, style: { fill: "var(--band)" } }));
  if (other && other.length) {
    svg.append(sv("path", { d: "M" + other.map((d) => `${x(d.year)},${y(d.median)}`).join("L"), fill: "none", "stroke-width": 1.5, "stroke-dasharray": "2 4", style: { stroke: "var(--line-2)" } }));
  }
  svg.append(sv("path", { d: "M" + years.map((d) => `${x(d.year)},${y(d.median)}`).join("L"), fill: "none", "stroke-width": 2.5, style: { stroke: "var(--line-1)" } }));
  for (const d of years) svg.append(sv("circle", { cx: x(d.year), cy: y(d.median), r: 3, style: { fill: "var(--line-1)" } }));
  svg.append(sv("text", { x: 6, y: 12, text: "mg/L nitrate-N" }));
  const otherBy = new Map((other || []).map((d) => [d.year, d]));
  const table = dataTable(["Year", "Wells", "Lower quartile", "Median", "Upper quartile", "All wells sampled that year: wells", "All wells: median"],
    years.map((d) => [d.year, d.wells, fmt(d.q25, 2), fmt(d.median, 2), fmt(d.q75, 2), otherBy.get(d.year)?.wells ?? "–", otherBy.has(d.year) ? fmt(otherBy.get(d.year).median, 2) : "–"]),
    [1, 2, 3, 4, 5, 6]);
  return figure(svg, caption, table, title);
}

// ---- lines (percent through time) --------------------------------------------------------------------------------------
export function linesChart({ series, width, height = 240, title, caption, yLabel = "%", tableHead, tableRows }) {
  const W = Math.max(300, width), H = height;
  const all = series.flatMap((s) => s.points);
  const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
  const x = scale(x0, x1, M.l, W - M.r);
  const ymax = Math.max(10, Math.ceil(Math.max(...all.map((p) => p[1])) / 10) * 10);
  const y = scale(0, ymax, H - M.b, M.t);
  const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const g = sv("g");
  svg.append(g);
  yAxis(g, y, niceTicks(0, ymax, 4), M.l, W - M.r, (v) => v + "%");
  const yrs = [];
  for (let yr = x0; yr <= x1; yr++) yrs.push(yr);
  xAxisYears(g, x, H - M.b, yrs, yrs.length > 12 ? 5 : 2);
  const ends = [];
  for (const s of series) {
    svg.append(sv("path", { d: "M" + s.points.map((p) => `${x(p[0])},${y(p[1])}`).join("L"), fill: "none", "stroke-width": s.w || 2, "stroke-dasharray": s.dash || null, style: { stroke: `var(${s.color})` } }));
    const last = s.points[s.points.length - 1];
    if (s.end) ends.push({ x: x(last[0]) + 6, y: y(last[1]) + 4, s });
  }
  // end labels pushed apart so they never overlap (at least 13 px between baselines)
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  for (const e of ends) svg.append(sv("text", { x: e.x, y: e.y, class: "lbl", text: e.s.end, style: { fill: `var(${e.s.color})` } }));
  svg.append(sv("text", { x: 6, y: 12, text: yLabel }));
  return figure(svg, caption, tableHead ? dataTable(tableHead, tableRows, tableHead.map((_, i) => i).slice(1)) : null, title);
}

// ---- trend classes, stacked --------------------------------------------------------------------------------------------
export function classBars({ rows, width, title, caption }) {
  const W = Math.max(300, width), rowH = 34, labelW = Math.min(170, W * 0.36), H = rows.length * rowH + 8;
  const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const maxN = Math.max(...rows.map((r) => r.assessed), 1);
  const x = scale(0, maxN, labelW, W - 46);
  rows.forEach((r, k) => {
    const yy = k * rowH + 6;
    svg.append(sv("text", { x: 0, y: yy + 17, class: r.strong ? "lbl" : null, text: r.label }));
    let acc = 0;
    r.counts.forEach((n, i) => {
      if (!n) return;
      const x0 = x(acc), x1 = x(acc + n);
      const c = CLASSES[i];
      svg.append(sv("rect", { x: x0, y: yy, width: Math.max(0, x1 - x0 - 1), height: 22, rx: 3, "stroke-width": c.filled ? 0 : 2,
        style: { fill: c.filled ? `var(${c.color})` : "var(--surface)", stroke: `var(${c.color})` } }));
      if (x1 - x0 > 18) svg.append(sv("text", { x: (x0 + x1) / 2, y: yy + 15, "text-anchor": "middle", style: { fill: c.filled ? "var(--surface)" : "var(--ink)" }, text: String(n) }));
      acc += n;
    });
    svg.append(sv("text", { x: x(acc) + 6, y: yy + 15, text: `${r.assessed}` }));
  });
  const table = dataTable(["Group", ...CLASSES.map((c) => c.label), "Assessed", "Not assessed"],
    rows.map((r) => [r.label, ...r.counts, r.assessed, r.na]), [1, 2, 3, 4, 5, 6, 7]);
  return figure(svg, caption, table, title);
}

export function classLegend() {
  return el("div", { class: "legend-row" }, CLASSES.map((c) => el("span", { class: "classchip" }, classSymbol(c.i, 14), c.label)));
}

// ---- Sen slopes with their intervals ---------------------------------------------------------------------------------------
export function forest({ items, median, width, title, caption, onPick }) {
  const W = Math.max(300, width), rowH = 13, labelW = 82;
  const H = items.length * rowH + M.t + M.b + 18;
  const lo = Math.min(-0.2, ...items.map((d) => d.lo ?? d.s)), hi = Math.max(0.2, ...items.map((d) => d.hi ?? d.s));
  const x = scale(lo, hi, labelW, W - 16);
  const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const ticks = niceTicks(lo, hi, 6);
  const g = sv("g", { class: "grid" });
  for (const t of ticks) {
    g.append(sv("line", { x1: x(t), x2: x(t), y1: M.t, y2: H - M.b - 18 }));
    svg.append(sv("text", { x: x(t), y: H - M.b - 2, "text-anchor": "middle", text: signed(t, 1) }));
  }
  svg.append(g);
  svg.append(sv("line", { x1: x(0), x2: x(0), y1: M.t - 4, y2: H - M.b - 18, "stroke-width": 1.5, style: { stroke: "var(--ink-3)" } }));
  if (median !== null && median !== undefined) {
    svg.append(sv("line", { x1: x(median), x2: x(median), y1: M.t - 4, y2: H - M.b - 18, "stroke-width": 1.5, "stroke-dasharray": "4 3", style: { stroke: "var(--ink)" } }));
    svg.append(sv("text", { x: x(median) + 4, y: M.t - 2, class: "lbl", text: `median ${signed(median, 2)}` }));
  }
  items.forEach((d, k) => {
    const yy = M.t + k * rowH + rowH / 2;
    const c = CLASSES[d.c];
    const row = sv("g", { class: "row" });
    row.append(sv("text", { x: labelW - 6, y: yy + 4, "text-anchor": "end", style: { "font-size": "10px" }, text: d.id }));
    if (d.lo !== null && d.hi !== null) row.append(sv("line", { x1: x(d.lo), x2: x(d.hi), y1: yy, y2: yy, "stroke-width": 1.5, style: { stroke: `var(${c.color})` } }));
    row.append(sv("circle", { cx: x(d.s), cy: yy, r: 3.5, "stroke-width": 1.5, style: { fill: c.filled ? `var(${c.color})` : "var(--surface)", stroke: `var(${c.color})` } }));
    svg.append(row);
  });
  svg.append(sv("text", { x: (labelW + W - 16) / 2, y: H - 6, "text-anchor": "middle", class: "lbl", text: "Sen slope, mg/L a year (dot) and its 90% interval (line)" }));
  const table = dataTable(["Well", "Class", "Sen slope (mg/L a year)", "90% interval"],
    items.map((d) => [d.id, CLASSES[d.c].label, signed(d.s, 3), `${signed(d.lo, 3)} to ${signed(d.hi, 3)}`]), [2]);
  return figure(svg, caption, table, title);
}
