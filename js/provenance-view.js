// The "Sources" entry of a Layers drawer (PROV1): every served source relevant to the space, with when it was refreshed, its
// licence and what the layer is (the dictionary summary); sources registered but empty are listed as "Not loaded yet".
// Folded by default, quiet. Shared by the farm space's drawer and, when it lands, the group space's: both call
// FP.provenance.section(rows, { keys, region }) with the reference_sources rows they read and replace the drawer's #drawer-sources.
(function (root) {
  const P = root.FP.provenance;

  function item(s) {
    const p = P.parts(s);
    if (!s.loaded) {
      return FP.el("li", { class: "source source-empty", "data-source": s.key }, FP.el("b", {}, s.name),
        FP.el("small", {}, [s.provider, p.licence].filter(Boolean).join(" · ")), FP.el("small", { class: "source-state" }, P.NOT_LOADED));
    }
    const head = FP.el("summary", {}, FP.el("b", {}, s.name), FP.el("small", {}, [s.provider, p.asAt, p.licence].filter(Boolean).join(" · ")));
    return FP.el("li", { class: "source", "data-source": s.key }, FP.el("details", {}, head,
      s.summary ? FP.el("p", { class: "source-summary" }, s.summary) : FP.el("p", { class: "source-summary" }, "No description written yet."),
      s.attribution ? FP.el("p", { class: "source-attr" }, s.attribution) : null));
  }

  // rows: reference_sources rows. Returns the drawer entry, or null when no source is relevant (the entry is not drawn).
  function section(rows, options) {
    const { loaded, notLoaded } = P.sourcesFor(rows, options);
    if (!loaded.length && !notLoaded.length) return null;
    const count = [loaded.length ? loaded.length + " loaded" : null, notLoaded.length ? notLoaded.length + " not loaded" : null].filter(Boolean).join(", ");
    return FP.el("details", { class: "drawer-sources", id: "drawer-sources" },
      FP.el("summary", {}, FP.el("span", {}, "Sources"), FP.el("small", {}, count)),
      FP.el("p", { class: "sources-note" }, "Where the reference layers on this map come from, and how recent they are."),
      FP.el("ul", { class: "sources-list" }, ...loaded.map(item), ...notLoaded.map(item)));
  }

  P.section = section;
})(typeof window === "undefined" ? globalThis : window);
