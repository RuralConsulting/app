// Chart block: one measure over time at one site, hand-drawn SVG (no library). Shows the results as points joined by a
// line, a censored result ("<0.002", ">2419") as an open triangle at its limit and never as an exact value, an optional
// comparison site (a second series, its own style, named in the legend with its owner), optional band ranges that the
// caller supplies (the block draws the ranges and the method label it is given and never computes a band), the unit,
// the source's attribution and a "provisional" flag. Beneath the picture a sentence (count, period, latest) and the
// results as a table, so nothing depends on seeing the drawing. Pure: data in, HTML out (docs/BUILDING-BLOCKS.md §2).
//
// Data: { title?, parameter: { name, unit }, attribution?, provenance? (a line or lines naming a reference source, its as-at date and licence), provisional?,
//         series: [{ id?, label, owner?, note?, points: [{ t, value, qualifier?, text? }] }],     // first = the site, second = comparison
//         (a second series may carry a `note`, which the key shows in place of "comparison": WQ6, another member's different key)
//         (WQ8: up to four series, each its own line, never joined to another; a series with `part: true` is the first's place in
//         another dataset, kept when the comparison is turned off)
//         bands?: { label, demo?, ranges: [{ label, from, to }] },                          // from/to numbers, null = open ended
//         limits?: [{ value, label, style? }],   // N2: horizontal limit lines the caller gives (style "solid", "dashed" or "dotted";
//                                                // dashed when not said), drawn across the plot and labelled; the scale reaches them
//         assess?: "a line in place of 'Bands and trend: not assessed.'" (when no band ranges are given),
//         palette?: "sites" }                    // N2: several sites side by side, each its own colour (and dash and marker)
// t is an ISO time or epoch ms; value is the number (the limit, for a censored result); qualifier is "<", ">", "≤" or "≥";
// text is the value as reported ("<0.002"), shown where given.
(function (root, factory) {
  const blocks = typeof module === "object" && module.exports ? require("./registry.js") : root.FP.blocks;
  const api = factory(blocks);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FP.chart = api;
})(typeof window === "undefined" ? globalThis : window, function (blocks) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const list = (v) => Array.isArray(v) ? v : [];
  const text = (v) => typeof v === "string" && v.trim() ? v.trim() : "";
  const CENSORED = ["<", ">", "≤", "≥"];
  const BELOW = ["<", "≤"];
  const SPARSE_BELOW = 6;           // fewer results than this: sparse (still drawn)
  const TABLE_ROWS = 60;            // the table shows the latest rows; the sentence above it says how many there are
  const DRAW_MAX = 2000;            // most points drawn per series; a longer series is thinned for the picture only (below)
  const NZ = "Pacific/Auckland";
  const dateFormat = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: NZ });
  const monthFormat = new Intl.DateTimeFormat("en-NZ", { month: "short", year: "numeric", timeZone: "UTC" });
  const yearFormat = new Intl.DateTimeFormat("en-NZ", { year: "numeric", timeZone: "UTC" });
  const dayFormat = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" });

  const ms = (t) => typeof t === "number" ? t : Date.parse(t);
  const when = (t) => dateFormat.format(new Date(ms(t)));
  const number = (v) => { const n = Number(Number(v).toPrecision(3)); return Math.abs(n) > 0 && Math.abs(n) < 1e-4 ? String(Number(v).toPrecision(2)) : String(n); };
  // A result as it is read aloud: the text as reported, else the qualifier and the number.
  const shown = (p) => text(p.text) || (CENSORED.includes(p.qualifier) ? p.qualifier : "") + number(p.value);
  const censored = (p) => CENSORED.includes(p.qualifier);

  // Only results with a real time and a real number are drawn; the rest are left out (never turned into zeros).
  function clean(series) {
    return list(series).map((s, i) => ({
      id: text(s?.id) || "series-" + i, label: text(s?.label) || (i ? "Comparison site" : "This site"), owner: text(s?.owner), note: text(s?.note), part: i > 0 && s?.part === true,
      points: list(s?.points).map((p) => ({ ...p, ms: ms(p?.t), value: p?.value === null || p?.value === "" ? NaN : Number(p?.value) }))
        .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.value)).sort((a, b) => a.ms - b.ms),
    }));
  }

  // The series drawn: at most MAX_SERIES. Without the comparison (compare: false), the first and the `part` series right after it
  // (WQ8: the same place's record in another dataset), never a comparison.
  const MAX_SERIES = 6;   // N2: a comparison of up to six sites
  function shownSeries(data, o = {}) {
    const all = clean(data?.series);
    if (o.compare !== false) return all.slice(0, MAX_SERIES);
    const out = all.slice(0, 1);
    for (const s of all.slice(1)) { if (!s.part || out.length >= MAX_SERIES) break; out.push(s); }
    return out;
  }

  // N2: the limit lines the caller gives, each a finite value with a label; at most MAX_LIMITS. The block never makes one.
  const MAX_LIMITS = 8, LIMIT_STYLES = ["solid", "dashed", "dotted"];
  const limitLines = (data) => list(data?.limits).filter((l) => l && l.value !== null && l.value !== "" && Number.isFinite(Number(l.value)))
    .slice(0, MAX_LIMITS).map((l) => ({ value: Number(l.value), label: text(l.label) || "Limit", style: LIMIT_STYLES.includes(l.style) ? l.style : "dashed" }));

  // "Nice" axis values: about n steps of 1, 2 or 5 times a power of ten, covering [lo, hi].
  function niceScale(lo, hi, n = 5) {
    if (!(hi > lo)) { const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.5 : 1; lo -= pad; hi += pad; if (lo < 0 && lo > -pad * 2) lo = Math.min(lo, 0); }
    const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
    for (let v = a; v <= b + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
    return { lo: ticks[0], hi: ticks[ticks.length - 1], step, ticks };
  }
  // Calendar ticks (UTC month starts) with the fewest months between them that gives six or fewer.
  function timeTicks(t0, t1) {
    const start = new Date(t0), steps = [1, 2, 3, 6, 12, 24, 60, 120];
    for (const step of steps) {
      const out = [];
      let y = start.getUTCFullYear(), m = step >= 12 ? 0 : Math.floor(start.getUTCMonth() / step) * step;
      if (step >= 12) y = Math.floor(y / (step / 12)) * (step / 12);
      for (let t = Date.UTC(y, m, 1); t <= t1 + 1; t = Date.UTC(y, m += step, 1)) if (t >= t0 - 1) out.push(t);
      if (out.length <= 6 && out.length >= 2) return { ticks: out, step };
      if (out.length < 2 && step === steps[steps.length - 1]) return { ticks: out, step };
    }
    return { ticks: [], step: 0 };
  }
  function timeLabel(t, step, span) {
    if (step >= 12) return yearFormat.format(new Date(t));
    return span < 70 * 86400000 ? dayFormat.format(new Date(t)) : monthFormat.format(new Date(t));
  }

  // Thin a long series for drawing: by time bucket, each bucket keeps its lowest and highest result; every censored
  // result, the first and last, and the overall lowest and highest are always kept. The text summary and the table use the full series.
  function thin(points, max = DRAW_MAX) {
    const n = points.length;
    if (n <= max) return points;
    const buckets = Math.max(1, Math.floor(max / 2)), t0 = points[0].ms, span = points[n - 1].ms - t0 || 1;
    const keep = new Uint8Array(n), lo = new Int32Array(buckets).fill(-1), hi = new Int32Array(buckets).fill(-1);
    let gmin = 0, gmax = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i], b = Math.min(buckets - 1, Math.floor((p.ms - t0) / span * buckets));
      if (censored(p)) keep[i] = 1;
      if (lo[b] < 0 || p.value < points[lo[b]].value) lo[b] = i;
      if (hi[b] < 0 || p.value > points[hi[b]].value) hi[b] = i;
      if (p.value < points[gmin].value) gmin = i;
      if (p.value > points[gmax].value) gmax = i;
    }
    for (let b = 0; b < buckets; b++) if (lo[b] >= 0) { keep[lo[b]] = 1; keep[hi[b]] = 1; }
    keep[0] = keep[n - 1] = keep[gmin] = keep[gmax] = 1;
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
    return out;
  }

  // Where each band's label sits: the first corner of its band where no drawn point or line segment would run under the text.
  // Tried bottom-left, top-left, bottom-right, top-right; if every corner is crossed, the first (the label is drawn on top with a halo).
  const LABEL_CHAR = 7.2, LABEL_H = 14;
  function placeBandLabels(bands, series, P) {
    const crosses = (box) => series.some((s) => s.points.some((p, i, ps) => {
      if (p.cx >= box.x0 - 6 && p.cx <= box.x1 + 6 && p.cy >= box.y0 - 6 && p.cy <= box.y1 + 6) return true;
      if (!i) return false;
      const a = ps[i - 1], dx = p.cx - a.cx, dy = p.cy - a.cy;
      let t0 = 0, t1 = 1;
      for (const [d, q] of [[-dx, a.cx - box.x0], [dx, box.x1 - a.cx], [-dy, a.cy - box.y0], [dy, box.y1 - a.cy]]) {
        if (d === 0) { if (q < 0) return false; continue; }
        const r = q / d;
        if (d < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      }
      return true;
    }));
    for (const b of bands) {
      if (!b.label || b.y1 - b.y0 < 15) { b.labelAt = null; continue; }
      const w = b.label.length * LABEL_CHAR;
      const tries = [[P.x0 + 6, "start", b.y1 - 5], [P.x0 + 6, "start", b.y0 + LABEL_H - 2], [P.x1 - 6, "end", b.y1 - 5], [P.x1 - 6, "end", b.y0 + LABEL_H - 2]];
      const found = tries.find(([x, anchor, y]) => { const x0 = anchor === "start" ? x : x - w; return !crosses({ x0, x1: x0 + w, y0: y - LABEL_H + 2, y1: y + 3 }); });
      const [x, anchor, y] = found || tries[0];
      b.labelAt = { x, y, anchor, clear: Boolean(found) };
    }
  }

  // The chart's geometry and everything drawn, as numbers, in a box of width x height. Pure, so the tests check scaling.
  function layout(data, o = {}, width = 560, height = 300) {
    const series = shownSeries(data, o);
    const all = series.flatMap((s) => s.points);
    const m = { l: 46, r: 12, t: 26, b: 28 }, w = Math.max(width, 240) - m.l - m.r, h = height - m.t - m.b;
    // Plain loops: spreading tens of thousands of values into the Math min or max functions throws in Safari.
    let t0 = Infinity, t1 = -Infinity, vmin = 0, vmax = -Infinity;
    for (const p of all) { if (p.ms < t0) t0 = p.ms; if (p.ms > t1) t1 = p.ms; if (p.value < vmin) vmin = p.value; if (p.value > vmax) vmax = p.value; }
    if (!all.length) { t0 = t1 = 0; vmax = 1; }
    const limits = limitLines(data);
    for (const l of limits) { if (l.value < vmin) vmin = l.value; if (l.value > vmax) vmax = l.value; }   // a limit is always on the scale
    if (t1 - t0 < 1) { t0 -= 15 * 86400000; t1 += 15 * 86400000; }
    const y = niceScale(vmin, vmax * 1.05, 4);
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * w, yy = (v) => m.t + h - ((v - y.lo) / (y.hi - y.lo)) * h;
    const tt = timeTicks(t0, t1);
    const bands = o.bands === false ? [] : list(data?.bands?.ranges).map((r) => {
      const from = r?.from === null || r?.from === undefined ? -Infinity : Number(r.from), to = r?.to === null || r?.to === undefined ? Infinity : Number(r.to);
      if (!(from < to) || to < y.lo || from > y.hi) return null;   // not a range, or wholly off the scale
      const lo = Math.max(from, y.lo), hi = Math.min(to, y.hi);
      return { label: text(r.label), from: r.from ?? null, to: r.to ?? null, y0: yy(hi), y1: yy(lo) };
    }).filter(Boolean);
    const drawn = series.map((s) => ({ ...s, total: s.points.length, points: thin(s.points).map((p) => ({ ...p, cx: x(p.ms), cy: yy(p.value), censored: censored(p) })) }));
    placeBandLabels(bands, drawn, { x0: m.l, x1: m.l + w, y0: m.t, y1: m.t + h });
    // each limit's label sits just above its line at the right; one that would touch the label above it goes under its line
    const placed = limits.map((l) => ({ ...l, y: yy(l.value) })).sort((a, b) => a.y - b.y);
    let lastLabel = -Infinity;
    for (const l of placed) { l.labelY = l.y - 4 - LABEL_H + 2 < lastLabel + 2 ? l.y + LABEL_H : l.y - 4; lastLabel = l.labelY; }
    return {
      width, height, margin: m, plot: { x0: m.l, x1: m.l + w, y0: m.t, y1: m.t + h }, t0, t1, y, x, y_: yy,
      xticks: tt.ticks.map((t) => ({ t, x: x(t), label: timeLabel(t, tt.step, t1 - t0) })),
      yticks: y.ticks.map((v) => ({ v, y: yy(v), label: number(v) })), bands, limits: placed,
      series: drawn,
    };
  }

  let seq = 0;   // ids for the picture's title and description, so two charts on a page never share them
  const MARK = ["circle", "square", "diamond", "circle", "square", "diamond"];
  const tagOf = (kind) => kind === "square" ? "rect" : kind === "diamond" ? "path" : "circle";
  // WQV1: a point with `field: true` (a field meter or test-strip reading) is drawn hollow; a laboratory result stays solid
  function marker(kind, c, p) {
    const cx = p.cx.toFixed(1), cy = p.cy.toFixed(1), cls = "chart-mark chart-s" + c + (p.field === true && !p.censored ? " chart-field" : "");
    if (p.censored) {   // an open triangle at the limit: pointing down for "less than", up for "more than"
      const d = BELOW.includes(p.qualifier) ? 1 : -1, a = 5.5;
      return '<path class="' + cls + ' chart-censored" d="M' + cx + " " + (p.cy + d * a).toFixed(1) + " l" + (-a) + " " + (-d * a * 1.7).toFixed(1) + " h" + 2 * a + ' z" data-qualifier="' + esc(p.qualifier) + '"/>';
    }
    if (kind === "diamond") return '<path class="' + cls + '" d="M' + cx + " " + (p.cy - 4.5).toFixed(1) + ' l4.5 4.5 l-4.5 4.5 l-4.5 -4.5 z"/>';
    return kind === "square" ? '<rect class="' + cls + '" x="' + (p.cx - 3.5).toFixed(1) + '" y="' + (p.cy - 3.5).toFixed(1) + '" width="7" height="7"/>' : '<circle class="' + cls + '" cx="' + cx + '" cy="' + cy + '" r="3.8"/>';
  }

  function svg(data, o, width, height, id) {
    const g = layout(data, o, width, height), P = g.plot;
    const name = text(data?.parameter?.name) || "Result", unit = text(data?.parameter?.unit);
    const parts = [];
    for (const b of g.bands) parts.push('<rect class="chart-band chart-band-' + (g.bands.indexOf(b) % 2) + '" x="' + P.x0 + '" y="' + b.y0.toFixed(1) + '" width="' + (P.x1 - P.x0) + '" height="' + Math.max(b.y1 - b.y0, 0).toFixed(1) + '"/>');
    for (const t of g.yticks) parts.push('<line class="chart-grid" x1="' + P.x0 + '" x2="' + P.x1 + '" y1="' + t.y.toFixed(1) + '" y2="' + t.y.toFixed(1) + '"/><text class="chart-tick" x="' + (P.x0 - 6) + '" y="' + (t.y + 4).toFixed(1) + '" text-anchor="end">' + esc(t.label) + "</text>");
    for (const t of g.xticks) parts.push('<line class="chart-tickmark" x1="' + t.x.toFixed(1) + '" x2="' + t.x.toFixed(1) + '" y1="' + P.y1 + '" y2="' + (P.y1 + 4) + '"/><text class="chart-tick" x="' + t.x.toFixed(1) + '" y="' + (P.y1 + 18) + '" text-anchor="middle">' + esc(t.label) + "</text>");
    parts.push('<line class="chart-axis" x1="' + P.x0 + '" x2="' + P.x1 + '" y1="' + P.y1 + '" y2="' + P.y1 + '"/><line class="chart-axis" x1="' + P.x0 + '" x2="' + P.x0 + '" y1="' + P.y0 + '" y2="' + P.y1 + '"/>');
    parts.push('<text class="chart-unit" x="' + P.x0 + '" y="14">' + esc(name + (unit ? " (" + unit + ")" : "")) + "</text>");
    g.series.forEach((s, c) => {
      // The line joins results in time order; a stretch that touches a censored result is dotted, so it is never read as exact.
      for (let i = 1; i < s.points.length; i++) {
        const a = s.points[i - 1], b = s.points[i];
        parts.push('<line class="chart-line chart-s' + c + (a.censored || b.censored ? " chart-line-censored" : "") + '" x1="' + a.cx.toFixed(1) + '" y1="' + a.cy.toFixed(1) + '" x2="' + b.cx.toFixed(1) + '" y2="' + b.cy.toFixed(1) + '"/>');
      }
      for (const p of s.points) parts.push(marker(MARK[c], c, p).replace("/>", "><title>" + esc(s.label + ", " + when(p.ms) + ": " + shown(p) + (unit ? " " + unit : "")) + "</title></" + (p.censored ? "path" : tagOf(MARK[c])) + ">"));
    });
    // N2: the limit lines over the results, each labelled with its name and value at the right end (a halo keeps the label readable)
    for (const l of g.limits) {
      parts.push('<line class="chart-limit chart-limit-' + l.style + '" x1="' + P.x0 + '" x2="' + P.x1 + '" y1="' + l.y.toFixed(1) + '" y2="' + l.y.toFixed(1) + '"/>' +
        '<text class="chart-limit-label" x="' + (P.x1 - 4) + '" y="' + l.labelY.toFixed(1) + '" text-anchor="end">' + esc(l.label + ": " + number(l.value) + (unit ? " " + unit : "")) + "</text>");
    }
    // Band labels last, so they sit above the lines and markers (a halo in the panel colour keeps them readable), at a corner the data does not cross.
    for (const b of g.bands) if (b.labelAt) parts.push('<text class="chart-band-label" x="' + b.labelAt.x.toFixed(1) + '" y="' + b.labelAt.y.toFixed(1) + '" text-anchor="' + b.labelAt.anchor + '">' + esc(b.label) + "</text>");
    return '<svg class="chart-svg" viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '" role="img" aria-labelledby="' + id + '-t ' + id + '-d" focusable="false">' +
      '<title id="' + id + '-t">' + esc(name + (unit ? " in " + unit : "") + " over time") + '</title><desc id="' + id + '-d">' + esc(describe(data, o)) + "</desc>" + parts.join("") + "</svg>";
  }

  // The sentence the picture is read from: how many results, the period, the latest (and the comparison's, the same way).
  function describe(data, o = {}) {
    const series = shownSeries(data, o), unit = text(data?.parameter?.unit);
    const limits = limitLines(data).map((l) => l.label + " at " + number(l.value) + (unit ? " " + unit : ""));
    return series.map((s) => {
      if (!s.points.length) return s.label + ": no results.";
      const first = s.points[0], last = s.points[s.points.length - 1], n = s.points.length;
      const cens = s.points.filter(censored).length;
      return s.label + ": " + n + (n === 1 ? " result" : " results") + (n > 1 ? " from " + when(first.ms) + " to " + when(last.ms) : "") + "; latest " + shown(last) + (unit ? " " + unit : "") + " on " + when(last.ms) +
        (cens ? "; " + cens + (cens === 1 ? " is" : " are") + " below or above a detection limit, not an exact value" : "") + ".";
    }).join(" ") + (limits.length ? " " + (limits.length === 1 ? "Limit line: " : "Limit lines: ") + limits.join("; ") + "." : "");
  }

  function state(data) {
    // N2: a comparison of sites is as full as its fullest site (the first chosen may have none of this measure)
    const all = clean(data?.series), n = data?.palette === "sites" ? Math.max(0, ...all.map((s) => s.points.length)) : all[0]?.points.length || 0;
    return n === 0 ? "empty" : n < SPARSE_BELOW ? "sparse" : "full";
  }

  function legend(series, any, o, data) {
    const items = series.map((s, c) => '<li class="chart-key"><svg class="chart-swatch" viewBox="0 0 28 12" width="28" height="12" aria-hidden="true" focusable="false"><line class="chart-line chart-s' + c + '" x1="1" x2="27" y1="6" y2="6"/>' +
      (MARK[c] === "square" ? '<rect class="chart-mark chart-s' + c + '" x="10.5" y="2.5" width="7" height="7"/>' : MARK[c] === "diamond" ? '<path class="chart-mark chart-s' + c + '" d="M14 1.5 l4.5 4.5 l-4.5 4.5 l-4.5 -4.5 z"/>' : '<circle class="chart-mark chart-s' + c + '" cx="14" cy="6" r="3.8"/>') + "</svg>" +
      "<span><b>" + esc(s.label) + "</b>" + (s.owner ? " · " + esc(s.owner) : "") + (c && (s.note || data?.palette !== "sites") ? " (" + (s.note || "comparison") + ")" : "") + (s.points.length || data?.palette !== "sites" ? "" : " · no results in this window") + "</span></li>");
    if (any) items.push('<li class="chart-key"><svg class="chart-swatch" viewBox="0 0 28 12" width="28" height="12" aria-hidden="true" focusable="false"><path class="chart-mark chart-s0 chart-censored" d="M14 9.5 l-5.5 -9.4 h11 z"/></svg><span>Open triangle: below (&lt;) or above (&gt;) a detection limit, so not an exact value</span></li>');
    // WQV1: only when a field reading is drawn
    if (series.some((s) => s.points.some((p) => p.field === true && !censored(p)))) items.push('<li class="chart-key"><svg class="chart-swatch" viewBox="0 0 28 12" width="28" height="12" aria-hidden="true" focusable="false"><circle class="chart-mark chart-s0" cx="7" cy="6" r="3.8"/><circle class="chart-mark chart-s0 chart-field" cx="21" cy="6" r="3.8"/></svg><span>Solid: a laboratory result. Hollow: a field meter or test-strip reading</span></li>');
    return '<ul class="chart-legend" aria-label="Key">' + items.join("") + "</ul>";
  }

  // Where the series comes from when it is drawn from a reference source (PROV1): one or more provenance lines
  // (FP.provenance.line: source, provider, as-at date, licence), quiet, under the attribution.
  const provenanceLines = (data) => list(typeof data?.provenance === "string" ? [data.provenance] : data?.provenance).filter(text)
    .map((l) => '<p class="chart-provenance prov-line">' + esc(l) + "</p>").join("");

  function render(data, o, ctx, width = 560) {
    const series = shownSeries(data, o);
    if (!(data?.palette === "sites" ? series.some((s) => s.points.length) : series[0]?.points.length)) return "";
    const h = ctx.level, id = "chart-" + ++seq;
    const unit = text(data?.parameter?.unit), height = width < 480 ? 250 : 300;
    const anyCensored = series.some((s) => s.points.some(censored));
    const bands = o.bands === false ? null : data?.bands;
    const rangesGiven = list(bands?.ranges).length > 0;
    const title = text(data?.title) || text(data?.parameter?.name) || "Chart";
    const rows = series.flatMap((s) => s.points.map((p) => ({ s, p }))).sort((a, b) => b.p.ms - a.p.ms || a.s.label.localeCompare(b.s.label)).slice(0, TABLE_ROWS);
    const total = series.reduce((n, s) => n + s.points.length, 0);
    const table = o.table === false ? "" : '<details class="chart-table"><summary>Results as a table</summary>' + (total > rows.length ? "<p>The latest " + rows.length + " of " + total + " results.</p>" : "") +
      '<div class="chart-table-scroll"><table><thead><tr><th scope="col">Date</th>' + (series.length > 1 ? '<th scope="col">Site</th>' : "") + '<th scope="col">Result' + (unit ? " (" + esc(unit) + ")" : "") + "</th></tr></thead><tbody>" +
      rows.map(({ s, p }) => "<tr><td>" + esc(when(p.ms)) + "</td>" + (series.length > 1 ? "<td>" + esc(s.label) + "</td>" : "") + "<td>" + esc(shown(p)) + (censored(p) ? " (limit, not exact)" : "") + "</td></tr>").join("") + "</tbody></table></div></details>";
    const assess = rangesGiven
      ? '<p class="chart-assess" data-assessed="true">Bands: ' + esc(text(bands.label) || "no method named") + (bands.demo ? ' <span class="chart-demo">· invented for the demo, not a standard or a grading</span>' : "") + "</p>"
      : '<p class="chart-assess" data-assessed="false">' + esc(text(data?.assess) || "Bands and trend: not assessed.") + "</p>";
    return '<section class="chart-block' + (data?.palette === "sites" ? " chart-palette-sites" : "") + '" data-chart-series="' + series.length + '">' +
      "<h" + h + ' class="block-title">' + esc(title) + (data?.provisional ? ' <span class="chart-provisional" title="The source says these results are provisional">Provisional</span>' : "") + "</h" + h + ">" +
      '<p class="chart-summary">' + esc(describe(data, o)) + "</p>" +
      '<div class="chart-plot" data-chart-width="' + width + '">' + svg(data, o, width, height, id) + "</div>" + legend(series, anyCensored, o, data) + assess +
      (text(data?.attribution) ? '<p class="chart-attribution">' + esc(data.attribution) + "</p>" : "") + provenanceLines(data) + table + "</section>";
  }

  // In a browser the picture is drawn at the width it has (so its type stays readable on a phone); the HTML above is the same at a default width.
  function mounted(host, data, o, ctx) {
    const plot = host.querySelector(".chart-plot");
    if (!plot || typeof ResizeObserver === "undefined") return null;
    let last = 0;
    const fit = () => {
      const w = Math.round(plot.clientWidth);
      if (!w || Math.abs(w - last) < 2) return;
      last = w;
      const section = host.querySelector(".chart-block"), id = plot.querySelector("svg")?.getAttribute("aria-labelledby")?.split(" ")[0]?.replace(/-t$/, "") || "chart";
      plot.innerHTML = svg(data, o, w, w < 480 ? 250 : 300, id);
      if (section) section.dataset.chartWidth = String(w);
    };
    const watch = new ResizeObserver(fit);
    watch.observe(plot); fit();
    ctx.onDestroy?.(() => watch.disconnect());
    return null;
  }

  const block = blocks.define({
    id: "chart", title: "Chart", empty: "No results for this site and parameter.",
    options: {
      bands: { type: "boolean", default: true },    // draw the band ranges the data carries (the block never makes any)
      compare: { type: "boolean", default: true },  // draw the second series, the comparison site
      table: { type: "boolean", default: true },    // the results as a table under the picture
    },
    state, render, mounted,
  });
  return { block, state, layout, thin, DRAW_MAX, MAX_SERIES, MAX_LIMITS, limitLines, shownSeries, niceScale, timeTicks, describe, clean, shown, svg, SPARSE_BELOW };
});
