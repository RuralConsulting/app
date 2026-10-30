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

  // A photo's card (E3): the photo first, then one plain line (when, and which way it looked), the land unit it sits
  // in and where the layer came from; Earlier and Later step through the layer's photos in the order they were taken.
  // model: FP.photoModel.card(); step: { at, of, earlier(), later(), close() }.
  // Only the original is stored today, so it is fetched once the card is shown, at most once per path (the signed
  // link is cached), and drawn no larger than the card. A smaller server-side copy is a follow-up.
  function photo(model, step) {
    const box = FP.el("div", { class: "pop photo-pop" });
    box.append(FP.el("button", { type: "button", class: "photo-close", "aria-label": "Close the photo", onclick: step.close }, "×"));
    if (model.image) {
      const img = FP.el("img", { class: "pop-photo", alt: model.line, loading: "lazy", decoding: "async" });
      box.append(img);
      photoUrl(model.image).then((u) => { if (u) img.src = u; else img.remove(); });
      img.addEventListener("error", () => img.remove());
    }
    box.append(FP.el("h3", {}, model.line));
    if (model.place) box.append(FP.el("p", { class: "photo-place" }, model.place));
    if (model.source) box.append(FP.el("p", { class: "pop-q" }, model.source));
    if (step.of > 1) {
      box.append(FP.el("div", { class: "photo-step" },
        FP.el("button", { type: "button", "aria-label": "Earlier photo", onclick: step.earlier, ...(step.at === 0 ? { disabled: true } : {}) }, "‹ Earlier"),
        FP.el("span", {}, step.at + 1 + " of " + step.of),
        FP.el("button", { type: "button", "aria-label": "Later photo", onclick: step.later, ...(step.at === step.of - 1 ? { disabled: true } : {}) }, "Later ›")));
    }
    return box;
  }

  return { content, photo };
})();
