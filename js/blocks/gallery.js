// The block gallery (#/demo/blocks): every registered block in full, sparse and empty, from the demo fixture,
// with a width switch (phone, desktop) and a theme switch (light, dark). A block PR is reviewed on these
// screenshots against APP-STRUCTURE §5. fixtures() is pure, so the tests check it covers every block and state.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./registry.js") : root.FP.blocks, node ? require("../farm-model.js") : root.FP.farmModel,
    node ? require("../demo-documents.js") : root.FP.demoDocuments);
  if (node) module.exports = api; else root.FP.gallery = api;
})(typeof window === "undefined" ? globalThis : window, function (blocks, M, demoDocuments) {
  const root = typeof window === "undefined" ? globalThis : window;
  const STATES = blocks.STATES;
  const LABELS = { full: "Full", sparse: "Sparse", empty: "Empty" };
  const WIDTHS = [["phone", "Phone"], ["desktop", "Desktop"]], THEMES = [["light", "Light"], ["dark", "Dark"]];
  const none = () => ({ type: "FeatureCollection", features: [] });

  // What each block is shown with, per state, built from the demo dataset (demo.js dataset()).
  // full: the demo farm as it is; sparse: one consent and a boundary; empty: nothing recorded.
  function fixtures(data) {
    const farm = data.tables.farms[0], today = data.asAt;
    const context = (rows = {}) => ({ farm, today, documents: [], authorisations: [], obligations: [], obligationsError: false, ...rows });
    // sparse: the one consent that runs out soonest (a farm with a single permit and nothing else)
    const t = data.tables, oneConsent = t.authorisations.filter((a) => a.valid_to && a.valid_to >= today).sort((a, b) => a.valid_to.localeCompare(b.valid_to)).slice(0, 1);
    const scene = data.map;
    // The List block shown with the demo farm's documents, newest first (the Documents block is their curated view).
    const docs = { kind: "documents", title: "Documents", rows: t.documents.map((d) => ({ id: d.id, title: M.docTitle(d), type: M.docKind(d.doc_type),
      author: [d.author, d.author_org].filter(Boolean).join(", ") || null, date: d.date_prepared || null, pages: d.page_count || null, open: !!d.storage_path })) };
    // A few more kinds than the demo farm holds, so the timeline shows entries and actions interleaving with documents and consents.
    const more = [
      { id: "entry-trough", kind: "entries", date: "2026-10-27", what: "Photo of the trough repair, Back paddock (synthetic)", did: "was captured", by: "Demo farmer", source: "Photo · Back paddock" },
      { id: "action-fence", kind: "actions", date: "2026-10-22", what: "Fence the creek margin (synthetic)", did: "was marked done", by: "Sam Example", source: "Action · Creek margin" },
      { id: "entry-note", kind: "entries", date: "2026-10-12", what: "Note on the effluent pond level (synthetic)", did: "was captured", by: "Demo farmer", source: "Note · Dairy shed" },
    ];
    const changes = (rows) => { const body = M.standingAnswers(context(rows))[1].body.data; return { ...body, title: "What's changed" }; };
    // The checklist: the demo farm's conditions; sparse is one water permit with one recorded condition.
    const checks = (rows) => ({ ...M.standingAnswers(context(rows))[0].body.data, title: "What's due" });
    const onePractice = t.obligations.filter((o) => o.id === "obl-meter");
    return {
      answer: {
        options: {},
        full: M.standingAnswers(context({ documents: t.documents, authorisations: t.authorisations, obligations: t.obligations }))[0],
        sparse: M.standingAnswers(context({ authorisations: oneConsent }))[0],
        empty: M.standingAnswers(context())[0],
      },
      list: {
        options: {},
        full: docs,
        sparse: { ...docs, rows: docs.rows.slice(0, 1) },
        empty: { ...docs, rows: [] },
      },
      timeline: {
        options: {},
        full: (() => { const base = changes({ documents: t.documents, authorisations: t.authorisations }); return { ...base, items: [...base.items, ...more] }; })(),
        sparse: changes({ authorisations: oneConsent }),
        empty: changes(),
      },
      // Full: a farm loaded before tiers existed (shaped on Cairnvale: 29 documents, every one "primary" by default),
      // which the Documents block brings down to its main documents. The HDLG member folder is the same block once
      // a person has tiered it: one main plan with its other format and background under it, an NZFAP+ checklist,
      // working drafts in the archive. Sparse: one consent decision. Empty: an editor's farm with nothing yet.
      documents: {
        options: {},
        full: { documents: demoDocuments().cairnvale },
        sparse: { documents: demoDocuments().cairnvale.filter((d) => d.doc_type === "consent_decision") },
        empty: { documents: [], canAdd: true },
        variants: [["hdlg", "HDLG member folder", { documents: demoDocuments().hdlg, canEdit: true, canAdd: true }]],
      },
      checklist: {
        options: {},
        full: checks({ documents: t.documents, authorisations: t.authorisations, obligations: t.obligations }),
        sparse: checks({ authorisations: oneConsent, obligations: onePractice }),
        empty: checks(),
      },
      "map-scene": {
        // the full scene opens on a photo, framed the way its camera looked, with its card and view cone
        options: { photo: scene.layers.find((l) => l.theme === "photos")?.features.features.find((f) => f.properties.Azimuth != null)?.id ?? null },
        full: scene,
        sparse: { ...scene, titles: none(), land_units: none(), layers: [], reference: [] },
        empty: { ...scene, extent: null, extent_ha: null, titles: none(), land_units: none(), layers: [], reference: [] },
      },
    };
  }

  const params = (hash) => new URLSearchParams(String(hash || "").split("?")[1] || "");
  const pick = (value, list) => (list.some(([k]) => k === value) ? value : null);
  // The gallery's own route state, from "#/blocks?width=desktop&theme=dark" (in the demo: "#/demo/blocks?...").
  const view = (hash) => ({ width: pick(params(hash).get("width"), WIDTHS) || "phone", theme: pick(params(hash).get("theme"), THEMES) });

  // ---- the page (browser only) -----------------------------------------------------------------------------
  // themeBefore: the page's own theme choice (undefined while the gallery is closed), put back when it closes.
  let screen = null, handles = [], settings = null, themeBefore, opened = 0, cache = null;
  const el = (...a) => root.FP.el(...a);
  function switcher(label, list, current, onPick) {
    return el("div", { class: "gallery-switch", role: "group", "aria-label": label },
      ...list.map(([key, name]) => el("button", { type: "button", "data-value": key, "aria-pressed": String(key === current), onclick: () => onPick(key) }, name)));
  }
  function remember() {
    const q = new URLSearchParams();
    if (settings.width !== "phone") q.set("width", settings.width);
    if (settings.theme) q.set("theme", settings.theme);
    const base = location.hash.split("?")[0];
    history.replaceState(null, "", location.pathname + location.search + base + (q.size ? "?" + q : ""));
  }
  function setTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  }
  function applyTheme() {
    setTheme(settings.theme || themeBefore);
    const dark = settings.theme ? settings.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    for (const b of screen.querySelectorAll('[aria-label="Theme"] button')) b.setAttribute("aria-pressed", String(b.dataset.value === (dark ? "dark" : "light")));
  }
  function unmount() { for (const h of handles.splice(0)) h.destroy(); }
  function draw(data) {
    unmount();
    const all = fixtures(data);
    screen.dataset.width = settings.width;
    for (const b of screen.querySelectorAll('[aria-label="Width"] button')) b.setAttribute("aria-pressed", String(b.dataset.value === settings.width));
    const sections = blocks.list().map((id) => {
      const block = blocks.get(id), f = all[id] || {};
      // The three states, then any further fixtures the block is reviewed on (the Documents block's HDLG folder).
      const shown = [...STATES.map((state) => [state, LABELS[state], f[state]]), ...(f.variants || [])];
      const cells = shown.map(([state, label, data]) => {
        const frame = el("div", { class: "gallery-frame" });
        const cell = el("figure", { class: "gallery-cell", "data-state": state }, el("figcaption", {}, label), frame);
        cell.frame = frame; cell.spec = { block: id, options: f.options || {} }; cell.data = data;
        return cell;
      });
      return { cells, node: el("section", { class: "gallery-block", "data-gallery-block": id }, el("h2", {}, block.title), el("div", { class: "gallery-states" }, ...cells)) };
    });
    screen.querySelector(".gallery-blocks").replaceChildren(...sections.map((s) => s.node));
    // Mounted once laid out, so a map knows its frame's size.
    for (const { cells } of sections) for (const c of cells) handles.push(blocks.render(c.frame, c.spec, { read: () => c.data, level: 3, href: root.FP.href }));
  }
  async function open(hash) {
    const mine = ++opened;
    settings = view(hash);
    if (!screen) {
      screen = el("main", { id: "screen-blocks", class: "gallery", hidden: true },
        el("header", { class: "gallery-bar" }, el("h1", {}, "Blocks"),
          switcher("Width", WIDTHS, settings.width, (w) => { settings.width = w; remember(); if (cache) draw(cache); }),
          switcher("Theme", THEMES, null, (t) => { settings.theme = t; remember(); applyTheme(); })),
        el("div", { class: "gallery-blocks" }));
      document.body.append(screen);
    }
    if (themeBefore === undefined) themeBefore = document.documentElement.dataset.theme || null;
    root.FP.show("screen-blocks");
    document.title = "Blocks | " + (root.FP.brand?.product || "");
    applyTheme();
    const d = await root.FP.demo.ready;
    if (mine !== opened) return;
    cache = d; draw(d);
  }
  function close() {
    opened++; unmount();
    if (themeBefore !== undefined) { setTheme(themeBefore); themeBefore = undefined; }
  }
  // Resolves when every block has drawn and every map in the gallery is idle (for screenshots).
  async function ready() {
    const apis = await Promise.all(handles.map((h) => h.ready));
    await Promise.all(apis.map((a) => a?.surface?.whenIdle()));
  }
  return { fixtures, view, open, close, ready, STATES, WIDTHS, THEMES };
});
