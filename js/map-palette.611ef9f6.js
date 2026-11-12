// UI2: the calm map palette for the app's own overview maps (the home Places map and a group's or farm's Overview), after Felt:
// seven soft hues chosen only to be told apart (a softened Okabe-Ito set, safe for the common colour-vision deficiencies; never a group's brand) on a quiet background, thin crisp outlines of the same hue with a gentle translucent fill, and a
// subtle casing under each line so it still reads on the aerial. Each group keeps one hue wherever it is drawn (from its id, so the
// Places map and its Overview agree); a sub-group takes its parent's hue, lighter. The hues are tokens (--map-hue-1 … 7,
// tokens.css); the outline is the hue toned darker on a light map and lighter on a dark map or the aerial. The published maps'
// viewer (viewer.js) has its own styles and is not touched.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.mapPalette = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const HUES = 7;
  // the tokens' values, for use where there is no stylesheet (tests); the browser reads tokens.css
  const DEFAULT_HUES = ["#5f9bd8", "#3fae8c", "#b083c4", "#d6ad4f", "#6cc0e5", "#d98879", "#8f9bb3"];
  // A stable hue for a key (a group's id): FNV-1a, so the same group has the same colour on every map and every visit.
  function hueIndex(key) {
    let h = 2166136261;
    for (const ch of String(key ?? "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h % HUES;
  }
  const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const out = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  // Mixed towards white (t > 0) or black (t < 0) by |t|.
  function tone(colour, t) {
    const rgb = hex(colour);
    if (!rgb) return colour;
    return out(rgb.map((v) => (t >= 0 ? v + (255 - v) * t : v * (1 + t))));
  }
  // WCAG relative luminance and contrast, for the outlines' rule below
  const lum = (c) => { const rgb = hex(c); if (!rgb) return 1; const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // The plain light map's ground (LINZ Topolite's paper and the app's own map background) an outline must stand out from
  const LIGHT_GROUND = "#f2f2ee";
  // An outline on a light map: the hue toned darker until it reaches `min` against the ground (3:1, WCAG's non-text contrast)
  function darkEnough(c, t, min) { let out = tone(c, t); for (let k = t; contrast(out, LIGHT_GROUND) < min && k > -0.9; k -= 0.05) out = tone(c, k); return out; }
  // The look of one place. hue: its hue's colour; sub: a sub-group (a lighter fill, a thinner outline); onDark: a dark map or the
  // aerial (lighter lines). On a light map every outline reaches 3:1 against the ground; a group's own reaches 4:1.
  function look(hue, { sub = false, onDark = false } = {}) {
    const base = sub ? tone(hue, 0.3) : hue;
    return {
      fill: base, fillOpacity: sub ? 0.14 : 0.2,
      line: onDark ? tone(base, sub ? 0.45 : 0.3) : darkEnough(hue, sub ? -0.25 : -0.3, sub ? 3.05 : 4),
      lineWidth: sub ? 1.2 : 1.5,
      casing: onDark ? "rgba(0, 0, 0, 0.38)" : "rgba(255, 255, 255, 0.85)",
    };
  }
  // A farm's marker: ink on a light map, white on a dark one, with a ring of the other for contrast.
  const farmMarker = (onDark) => (onDark ? { fill: "#ffffff", ring: "#1c1c1e" } : { fill: "#2f3542", ring: "#ffffff" });
  // The hue colours from the page's tokens (falls back to the defaults outside a browser)
  function hues(css) {
    return DEFAULT_HUES.map((d, i) => { const v = css ? String(css("--map-hue-" + (i + 1)) || "").trim() : ""; return hex(v) ? v : d; });
  }
  // A member block counts as leased when its `leased` attribute says yes (yes, y, true or 1, any case; empty is not leased); only a
  // block with no `leased` attribute at all falls back to a tenure, ownership or status that mentions a lease. The map draws the
  // same rule as a MapLibre expression (blocks/map-scene.js LEASED).
  function isLeased(props) {
    const p = props || {};
    if (Object.prototype.hasOwnProperty.call(p, "leased")) return ["yes", "y", "true", "1"].includes(String(p.leased ?? "").trim().toLowerCase());
    return String(p.tenure ?? p.Tenure ?? p.ownership ?? p.status ?? "").toLowerCase().includes("lease");
  }
  // UI2b: the background an overview map (Places, a group's or farm's Overview) opens on: the person's stored choice when it is one
  // of the backgrounds this map can draw, otherwise the plain map ("topolite"); the aerial only when there is no plain map to draw.
  // choices: the backgrounds this map offers (none without a LINZ key, except the demo's stand-ins).
  function startBackground(stored, choices) {
    const c = Array.isArray(choices) ? choices : [];
    return c.includes(stored) ? stored : c.includes("topolite") ? "topolite" : c[0] || "aerial";
  }
  return { HUES, DEFAULT_HUES, LIGHT_GROUND, startBackground, hueIndex, tone, look, farmMarker, hues, contrast, isLeased };
});
