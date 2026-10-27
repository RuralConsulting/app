// A deliberately small subset: HTML, links, images and all other syntax are plain text.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./provenance.js") : root.FP.plan.provenance, node ? require("./value.js") : root.FP.plan.value);
  if (node) module.exports = api; else root.FP.plan.markdown = api;
})(typeof window === "undefined" ? globalThis : window, function (P, V) {
  function placeholder(key, ctx) {
    if (key === "landunits.count") return V.render(ctx.pdm.land_unit_count, ctx, "Land unit count");
    if (key === "extent_ha") return V.render(ctx.pdm.extent_ha, ctx, "Farm extent");
    const m = key.match(/^fact:([a-z_]+)(?:\|item=([a-z_]+))?$/);
    if (m) {
      const exists = (ctx.pdm.values || []).some((v) => v.fact_type === m[1] && (v.item ?? null) === (m[2] || null) && !v.place_id && !v.title_nos?.length);
      if (exists) return V.render(V.fact(ctx.pdm, m[1], m[2] || null), ctx, m[1]);
    }
    return '<span class="placeholder-error" role="status">Unknown placeholder: ' + P.esc(key) + "</span>";
  }
  function inline(text, ctx) {
    // Split before escaping. Stored prose cannot inject a token or HTML returned by a placeholder.
    return text.split(/(\{\{[^{}]+\}\})/g).map((s) => s.startsWith("{{") && s.endsWith("}}") ? placeholder(s.slice(2, -2).trim(), ctx) :
      P.esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>")).join("");
  }
  function render(text, ctx) {
    const out = []; let paragraph = [], list = null, items = [];
    const flushP = () => { if (paragraph.length) { out.push("<p>" + inline(paragraph.join(" "), ctx) + "</p>"); paragraph = []; } };
    const flushL = () => { if (list) { out.push("<" + list + ">" + items.map((s) => "<li>" + inline(s, ctx) + "</li>").join("") + "</" + list + ">"); list = null; items = []; } };
    for (const line of String(text || "").split(/\r?\n/)) {
      const m = line.match(/^\s*(-|\d+\.)\s+(.+)$/);
      if (m) { flushP(); const kind = m[1] === "-" ? "ul" : "ol"; if (list !== kind) flushL(); list = kind; items.push(m[2]); }
      else if (/^>\s?/.test(line)) { flushP(); flushL(); out.push("<blockquote>" + inline(line.replace(/^>\s?/, ""), ctx) + "</blockquote>"); }
      else if (!line.trim()) { flushP(); flushL(); }
      else { flushL(); paragraph.push(line); }
    }
    flushP(); flushL(); return out.join("");
  }
  function lint(text) {
    return [...String(text || "").replace(/\{\{[^{}]+\}\}/g, "").matchAll(/\b\d+(?:[.,]\d+)?\s*(?:ha\b|kg\s*N\b|SU\b|SSU\b|CSU\b|L\/s\b|%)/g)].map((m) => m[0]);
  }
  return { render, lint, placeholder };
});
