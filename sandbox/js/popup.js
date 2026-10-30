// What a tap on the map shows: the feature's details, how its layer is qualified, and its photo if any.
FP.popup = (() => {
  const HIDDEN = new Set(["storage_path", "photo_sha256", "fid", "source_fid", "ogc_fid", "label_at", "on_farm",
                          "authorisations", "external_id", "layer_ref"]);
  const photoCache = new Map();

  function rows(props) {
    const out = [];
    for (const [k, v] of Object.entries(props)) {
      if (HIDDEN.has(k) || v == null || v === "" || typeof v === "object") continue;
      if (/^https?:|^[a-z]:\\|<[a-z]/i.test(String(v))) continue;   // paths and HTML never shown
      out.push([k === "area_ha" ? "Area" : k.replace(/_/g, " "), k === "area_ha" ? FP.ha(v) : String(v)]);
    }
    return out;
  }

  async function photoUrl(path) {
    if (!photoCache.has(path)) {
      photoCache.set(path, FP.sb.storage.from("documents").createSignedUrl(path, FP_CONFIG.photoLinkSeconds)
        .then(({ data }) => data?.signedUrl || null));
    }
    return photoCache.get(path);
  }

  // hit: {title, qualifier, props, kind}
  function content(hit) {
    const box = FP.el("div", { class: "pop" });
    box.append(FP.el("h3", {}, hit.title));
    if (hit.layerName && hit.layerName !== hit.title) box.append(FP.el("p", { class: "pop-layer" }, hit.layerName));
    if (hit.qualifier) box.append(FP.el("p", { class: "pop-q" }, hit.qualifier));
    if (hit.props.storage_path) {
      const img = FP.el("img", { class: "pop-photo", alt: hit.title });
      box.append(img);
      photoUrl(hit.props.storage_path).then((u) => { if (u) img.src = u; else img.remove(); });
    }
    if (hit.permits?.length) {
      box.append(FP.el("p", { class: "pop-q" }, "Linked to " + hit.permits.map((a) => a.consent_no || a.title).join(", ")));
    }
    const r = rows(hit.props);
    if (r.length) {
      const dl = FP.el("dl");
      for (const [k, v] of r) dl.append(FP.el("dt", {}, k), FP.el("dd", {}, v));
      box.append(dl);
    }
    if (hit.attribution) box.append(FP.el("p", { class: "pop-attr" }, hit.attribution));
    return box;
  }

  return { content };
})();
