// Small shared helpers: DOM and SVG builders (text is always set as text, never parsed as HTML), formats, classes, symbols.

export const SVGNS = "http://www.w3.org/2000/svg";

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "style" && typeof v === "object") for (const [p, pv] of Object.entries(v)) e.style.setProperty(p, pv);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

export function sv(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "text") e.textContent = v;
    else if (k === "style" && typeof v === "object") for (const [p, pv] of Object.entries(v)) e.style.setProperty(p, pv);
    else e.setAttribute(k, String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

export const MAV = 11.3, HALF = 5.65;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmt(v, d = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return Number(v).toFixed(d);
}
export function signed(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const s = Number(v).toFixed(d);
  return (v > 0 && Number(s) !== 0 ? "+" : "") + s.replace("-", "−");
}
export function pct(a, b) { return b ? Math.round((100 * a) / b) : 0; }
export function dateText(iso) {
  if (!iso) return "–";
  const s = String(iso);
  const y = s.slice(0, 4), m = Number(s.slice(s.length === 8 ? 4 : 5, s.length === 8 ? 6 : 7)), d = Number(s.slice(-2));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function intDateToYear(n) {
  // 20160315 -> decimal year at mid-day (the pipeline's own rule: year + (day of year - 0.5) / days in year)
  const y = Math.floor(n / 10000), m = Math.floor((n % 10000) / 100), d = n % 100;
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1), t = Date.UTC(y, m - 1, d);
  return y + ((t - start) / 86400000 + 0.5) / ((end - start) / 86400000);
}

export const LEVELS = [
  { key: "under", label: "5.65 mg/L or below", short: "≤ 5.65", shape: "circle", color: "--lv-under" },
  { key: "half", label: "above 5.65, up to 11.3 mg/L", short: "5.65–11.3", shape: "diamond", color: "--lv-half" },
  { key: "over", label: "above 11.3 mg/L (the drinking-water limit)", short: "> 11.3", shape: "square", color: "--lv-over" },
];
export function levelOf(v) { return v > MAV ? "over" : v > HALF ? "half" : "under"; }
export const level = (k) => LEVELS.find((l) => l.key === k);

export const CLASSES = [
  { i: 0, label: "Very likely decreasing", lawa: "very likely improving", shape: "down", filled: true, color: "--tr-0" },
  { i: 1, label: "Likely decreasing", lawa: "likely improving", shape: "down", filled: false, color: "--tr-1" },
  { i: 2, label: "Indeterminate", lawa: "indeterminate", shape: "circle", filled: false, color: "--tr-2" },
  { i: 3, label: "Likely increasing", lawa: "likely degrading", shape: "up", filled: false, color: "--tr-3" },
  { i: 4, label: "Very likely increasing", lawa: "very likely degrading", shape: "up", filled: true, color: "--tr-4" },
];

export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// one small symbol as inline SVG: the same shapes the map draws
export function symbol(shape, colorVar, filled = true, size = 14, label = null) {
  const s = size, c = s / 2, r = s * 0.38;
  const a = { style: { fill: filled ? `var(${colorVar})` : "none", stroke: `var(${colorVar})` }, "stroke-width": filled ? 1 : 2 };
  let mark;
  if (shape === "circle") mark = sv("circle", { cx: c, cy: c, r, ...a });
  else if (shape === "square") mark = sv("rect", { x: c - r, y: c - r, width: 2 * r, height: 2 * r, ...a });
  else if (shape === "diamond") mark = sv("path", { d: `M${c} ${c - r * 1.25}L${c + r * 1.25} ${c}L${c} ${c + r * 1.25}L${c - r * 1.25} ${c}Z`, ...a });
  else if (shape === "up") mark = sv("path", { d: `M${c} ${c - r * 1.2}L${c + r * 1.15} ${c + r * 0.9}L${c - r * 1.15} ${c + r * 0.9}Z`, ...a });
  else mark = sv("path", { d: `M${c} ${c + r * 1.2}L${c + r * 1.15} ${c - r * 0.9}L${c - r * 1.15} ${c - r * 0.9}Z`, ...a });
  const svg = sv("svg", { width: s, height: s, viewBox: `0 0 ${s} ${s}`, "aria-hidden": label ? null : "true", role: label ? "img" : null, "aria-label": label }, mark);
  return svg;
}
export const levelSymbol = (k, size) => { const l = level(k); return symbol(l.shape, l.color, true, size); };
export const classSymbol = (i, size) => { const c = CLASSES[i]; return symbol(c.shape, c.color, c.filled, size); };

// CSV: numbers stay numbers; text that a spreadsheet would read as a formula (its first non-space character = + - or @, or a
// leading tab or return) gets a leading quote
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[\t\r]/.test(s) || /^\s*[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function downloadCSV(name, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function niceTicks(lo, hi, n = 5) {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}
