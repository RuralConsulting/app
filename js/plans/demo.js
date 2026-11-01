// The demo of the Farm Environment Plan and Freshwater Farm Plan (#/demo/plans): the invented Tussock Rise Farm
// rendered by plans/render.js from the template definitions in demo/plans/, with a choice of document, brand
// (RCL's brand, an invented catchment group's, or none) and how much is filled in, and Print. Fixture data only:
// the brands are org_brands rows in demo/plans/brands.json, put through the same brandFromRow() a signed-in page
// uses on what brand_for returns (brandFor below).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./render.js") : root.FP.farmPlans);
  if (node) module.exports = api; else root.FP.farmPlansDemo = api;
})(typeof window === "undefined" ? globalThis : window, function (R) {
  const root = typeof window === "undefined" ? globalThis : window;
  const DOCS = [["fep-cant-s7", "Farm Environment Plan"], ["fwfp-cant-s7", "Freshwater Farm Plan"]];
  const BRANDS = [["rcl", "Rural Consulting"], ["group", "Example Plains Catchment Group"], ["none", "Unbranded"]];
  const DATA = [["full", "Full"], ["sparse", "Sparse"], ["empty", "Empty"]];

  // The brands render() is given, by choice, from the fixture rows: "rcl" is RCL's (as seeded by the org_brands
  // migration, with the app's logo standing in for RCL's logo file), "group" an invented catchment group's, and
  // "none" no brand at all (an organisation without an org_brands row).
  function brands(fixture) {
    const rows = fixture?.brands || {};
    return Object.fromEntries(BRANDS.map(([k]) => [k, R.brandFromRow(rows[k] || null, { logo: rows[k]?.logo, logo_dark: rows[k]?.logo_dark })]));
  }

  // A signed-in preview or issue takes its brand from the database. brand_for(farm, org) gives the one brand the
  // document carries: the farm's servicing organisation's by default, or (org named) a group the farm belongs to,
  // never both; no row means unbranded. The logo is an organisation file in private storage: it is downloaded and
  // handed to the renderer as a data: image, since the document never loads from another site.
  async function brandFor(sb, farm, org = null) {
    const { data, error } = await sb.rpc("brand_for", org ? { farm, org } : { farm });
    if (error) throw new Error(error.message || String(error));
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    let logo = null;
    if (row.logo_path) {
      const { data: file, error: fileError } = await sb.storage.from("documents").download(row.logo_path);
      if (!fileError && file) logo = "data:" + (row.logo_mime_type || file.type) + ";base64," + base64(new Uint8Array(await file.arrayBuffer()));
    }
    return R.brandFromRow(row, { logo });
  }
  function base64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // What render() is given for one choice of document and data, from the demo fixture.
  function values(fixture, doc, data) {
    const d = fixture.documents[doc];
    const keep = data === "full" ? null : data === "sparse" ? new Set(d.sparse) : new Set();
    const nodes = keep ? Object.fromEntries(Object.entries(d.nodes).filter(([k]) => keep.has(k))) : d.nodes;
    return {
      values: { farm: fixture.farm, issued_on: fixture.issued_on, nodes, switched_off: data === "full" ? d.switched_off : [] },
      figures: data === "full" ? d.figures : {},
    };
  }

  const params = (hash) => new URLSearchParams(String(hash || "").split("?")[1] || "");
  const pick = (v, list) => (list.some(([k]) => k === v) ? v : list[0][0]);
  const view = (hash) => { const p = params(hash); return { doc: pick(p.get("doc"), DOCS), brand: pick(p.get("brand"), BRANDS), data: pick(p.get("data"), DATA) }; };

  // ---- the page (browser only) ---------------------------------------------------------------------------------
  let screen = null, settings = null, opened = 0;
  const cache = {};
  const fetchJson = (url) => (cache[url] = cache[url] || fetch(url).then((r) => { if (!r.ok) throw new Error(url + " is unavailable"); return r.json(); }));
  const el = (...a) => root.FP.el(...a);
  function switcher(label, list, key) {
    return el("div", { class: "plans-switch", role: "group", "aria-label": label },
      ...list.map(([value, name]) => el("button", { type: "button", "data-value": value, "aria-pressed": "false",
        onclick: () => { settings[key] = value; remember(); draw(); } }, name)));
  }
  function remember() {
    const q = new URLSearchParams();
    for (const [k, list] of [["doc", DOCS], ["brand", BRANDS], ["data", DATA]]) if (settings[k] !== list[0][0]) q.set(k, settings[k]);
    history.replaceState(null, "", location.pathname + location.search + location.hash.split("?")[0] + (q.size ? "?" + q : ""));
  }
  async function draw() {
    const mine = ++opened, s = { ...settings };
    for (const [k] of [["doc"], ["brand"], ["data"]]) for (const b of screen.querySelectorAll('[data-setting="' + k + '"] button')) b.setAttribute("aria-pressed", String(b.dataset.value === s[k]));
    const host = screen.querySelector(".plans-page");
    host.setAttribute("aria-busy", "true");
    try {
      const [definition, fixture, brandRows] = await Promise.all([fetchJson("demo/plans/" + s.doc + ".v1.json"), fetchJson("demo/plans/tussock-rise.json"), fetchJson("demo/plans/brands.json")]);
      if (mine !== opened) return;
      const { values: v, figures } = values(fixture, s.doc, s.data);
      host.innerHTML = R.render(definition, v, brands(brandRows)[s.brand], figures);
      document.title = fixture.farm + " · " + DOCS.find(([k]) => k === s.doc)[1];
    } catch (e) {
      if (mine !== opened) return;
      host.replaceChildren(el("p", { class: "plans-error", role: "alert" }, e.message || String(e)));
    }
    host.removeAttribute("aria-busy");
  }
  function open(hash) {
    settings = view(hash);
    if (!screen) {
      const bar = el("div", { class: "plans-bar" },
        el("div", { "data-setting": "doc" }, switcher("Document", DOCS, "doc")),
        el("div", { "data-setting": "brand" }, switcher("Brand", BRANDS, "brand")),
        el("div", { "data-setting": "data" }, switcher("Content", DATA, "data")),
        el("button", { type: "button", class: "plans-print", onclick: () => root.print() }, "Print"));
      screen = el("main", { id: "screen-farm-plans", class: "plans-screen", hidden: true }, bar, el("div", { class: "plans-page", "aria-live": "polite" }));
      document.body.append(screen);
    }
    document.body.classList.add("plans-open");
    root.FP.show("screen-farm-plans");
    return draw();
  }
  function close() { opened++; document.body?.classList.remove("plans-open"); }
  return { DOCS, BRANDS, DATA, brands, brandFor, values, view, open, close };
});
