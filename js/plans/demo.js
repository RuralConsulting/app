// The demo of the Farm Environment Plan and Freshwater Farm Plan (#/demo/plans): the invented Tussock Rise Farm
// rendered by plans/render.js from the template definitions in demo/plans/, with a choice of document, brand
// (the app's own brand and an invented catchment group) and how much is filled in, and Print. Fixture data only.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./render.js") : root.FP.farmPlans);
  if (node) module.exports = api; else root.FP.farmPlansDemo = api;
})(typeof window === "undefined" ? globalThis : window, function (R) {
  const root = typeof window === "undefined" ? globalThis : window;
  const DOCS = [["fep-cant-s7", "Farm Environment Plan"], ["fwfp-cant-s7", "Freshwater Farm Plan"]];
  const BRANDS = [["app", null], ["group", "Example Plains Catchment Group"]];
  const DATA = [["full", "Full"], ["sparse", "Sparse"], ["empty", "Empty"]];

  // The brands, as data. "app" is the app's own organisation (brand.json, built into FP.brand); the accent is a
  // dark gold that reads on paper (the logo's yellow does not: 1.5:1). "group" is invented.
  function brands(appBrand) {
    const org = appBrand?.org || "Farm platform";
    return {
      app: { display_name: org, accent: "#7d5c0f", logo: "brand/logo.png", logo_dark: "brand/logo-dark.png",
        footer: [appBrand?.org_legal || org, appBrand?.domain].filter(Boolean).join(" · "), contact: appBrand?.domain ? "Questions about this document: " + appBrand.domain : null },
      group: { display_name: "Example Plains Catchment Group", accent: "#1f5f5b",
        footer: "Example Plains Catchment Group · invented for this demonstration", contact: "Coordinator: coordinator@example.invalid" },
    };
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
      const [definition, fixture] = await Promise.all([fetchJson("demo/plans/" + s.doc + ".v1.json"), fetchJson("demo/plans/tussock-rise.json")]);
      if (mine !== opened) return;
      const { values: v, figures } = values(fixture, s.doc, s.data);
      host.innerHTML = R.render(definition, v, brands(root.FP.brand)[s.brand], figures);
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
        el("div", { "data-setting": "brand" }, switcher("Brand", BRANDS.map(([k, n]) => [k, n || root.FP.brand?.org || "Farm platform"]), "brand")),
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
  return { DOCS, BRANDS, DATA, brands, values, view, open, close };
});
