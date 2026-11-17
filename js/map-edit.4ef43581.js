// ML1: "Edit layers" on a published map's panel (the Maps tab, a farm's or a group's), for the people the database lets change that
// map: today RCL staff in a two-factor session (public.published_map_edit_allowed; the policies on public.published_map_edits decide).
// Computer only in this first cut (a phone's map is for looking things up, docs/PRODUCT.md): at a phone's width no button is offered.
// The editor takes the place of the panel's list (the panel's box and the map's box never change size: WebKit blanks a map whose box
// is resized after its first draw, map-keep.js). For each of the map's own layers: on or off as the map opens for everyone, its name,
// up or down under its heading, its opacity, and for a simple layer its colour and line from a small calm set; a layer can be taken
// off the map (hidden for everyone, never deleted) and put back; the darkening outside the place can be turned off for everyone.
// Switches, colours, lines and opacity show on the map at once; names and order show in the list, and on the map once saved. Nothing
// is saved until "Save changes": a save is a new version (a new row), Cancel discards, "Reset to published" brings back the map as
// published. Rules and words: js/map-edit-model.js. maps-view.js applies the latest saved version as it reads the map.
(function (root) {
  const FP = (root.FP = root.FP || {});
  const PHONE = "(max-width: 720px)";
  const allowedFor = new Map();   // map id -> Promise<boolean>, for this visit (a sign-in change reloads the app)

  function allowed(sb, mapId) {
    if (!allowedFor.has(mapId)) {
      const p = Promise.resolve(sb?.rpc?.("published_map_edit_allowed", { m: mapId })).then((r) => !r?.error && r?.data === true, () => false);
      allowedFor.set(mapId, p);
      p.then((ok) => { if (!ok) setTimeout(() => allowedFor.delete(mapId), 60000); });
    }
    return allowedFor.get(mapId);
  }

  // ---- what shows on the map while editing (the viewer's own map layers, switched and painted from here) -------------------------------
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cid = (id) => "rv-l-" + String(id).replace(/[^a-z0-9_-]/gi, "");   // (as the viewer names a layer's switch)
  function styleLayers(map, L) {
    let all = [];
    try { all = map.getStyle()?.layers || []; } catch { return []; }
    const part = new RegExp("^v-" + esc(L.id) + "-(\\d+)-\\d+(-aside)?$"), raster = new RegExp("^t-" + esc(L.id) + "(-\\d+)?$");
    return all.map((l) => { const m = part.exec(l.id); return m ? { id: l.id, type: l.type, j: Number(m[1]) } : raster.test(l.id) ? { id: l.id, type: "raster", j: -1 } : null; }).filter(Boolean);
  }
  function previewer(map, holder, M, published, saved) {
    const orig = new Map();   // style layer id + property -> the value it was drawn with (the saved version)
    const keep = (id, prop) => { const k = id + "|" + prop; if (!orig.has(k)) { try { orig.set(k, map.getPaintProperty(id, prop)); } catch { orig.set(k, undefined); } } return orig.get(k); };
    const paint = (id, prop, v) => { try { map.setPaintProperty(id, prop, v); } catch { /* a value MapLibre refuses: the map stays as it was */ } };
    const savedRows = new Map(M.rowsOf(published, saved).map((r) => [r.id, r]));
    const sw = (id, on) => { const i = holder.querySelector("#" + cid(id)); if (i && i.checked !== on) { i.checked = on; i.dispatchEvent(new Event("change", { bubbles: true })); } };
    return function show(draft) {
      for (const r of M.rowsOf(published, draft)) {
        const L = r.published, was = savedRows.get(r.id);
        if (!was || was.removed) continue;   // a layer taken off in the saved version is not on the map; it comes back once saved
        sw(r.id, r.visible && !r.removed);
        const factor = (r.opacity || 0) / (was.opacity || 1);
        for (const s of styleLayers(map, L)) {
          const part = s.j >= 0 ? L.vector?.layers?.[s.j] : null, pk = part?.by ? Object.keys(part.by)[0] : null, pub = pk ? part.by[pk] : {};
          const props = s.type === "fill" ? ["fill-opacity"] : s.type === "line" ? ["line-opacity"] : s.type === "circle" ? ["circle-opacity", "circle-stroke-opacity"] : s.type === "raster" ? ["raster-opacity"] : [];
          for (const p of props) { const o = keep(s.id, p); paint(s.id, p, factor === 1 || o === undefined ? o : ["*", factor, o]); }
          if (r.simple && r.colour) {
            const p = s.type === "fill" ? "fill-color" : s.type === "line" ? "line-color" : s.type === "circle" ? "circle-color" : null;
            if (p) { keep(s.id, p); paint(s.id, p, r.colour); }
          } else if (r.simple) for (const p of ["fill-color", "line-color", "circle-color"]) if (orig.has(s.id + "|" + p)) paint(s.id, p, orig.get(s.id + "|" + p) ?? pub.color);
          if (r.line && s.type === "line") { const o = keep(s.id, "line-width"); paint(s.id, "line-width", typeof r.width === "number" ? r.width : o); }
        }
      }
      // the darkening outside: the package's own (the viewer's "Shade outside" switch) and the app's (maps-view.js focusMap)
      const on = M.shadeOn(draft), mask = holder.querySelector("#rv-l-mask");
      if (mask && mask.checked !== on) { mask.checked = on; mask.dispatchEvent(new Event("change", { bubbles: true })); }
      try { if (map.getLayer("ph-mask")) map.setLayoutProperty("ph-mask", "visibility", on ? "visible" : "none"); } catch { /* the map is going */ }
    };
  }

  // ---- the editor --------------------------------------------------------------------------------------------------------------------
  // ctx: { map, holder, sb, owner, chosen (the published_maps row), read (maps-view readPackage: published, saved, version), redraw() }
  function attach(ctx) {
    const M = FP.mapEditModel, el = (...a) => FP.el(...a);
    const { map, holder, sb, owner, chosen, read } = ctx;
    if (!M || !map || !holder || !chosen?.id || !read?.published) return null;
    const panel = holder.querySelector(".rv-panel"), foot = panel?.querySelector(".rv-foot");
    if (!panel || !foot) return null;
    let gone = false, button = null, box = null;
    const phone = () => !!root.matchMedia?.(PHONE).matches;
    // the "may I edit?" read is asked only by someone the app already knows is RCL staff, at a width where the button can show; nobody
    // else makes it (review of #594: a member's or a phone's map open makes no read it never needs)
    if (FP.ops?.isStaff?.() !== true || phone()) return null;
    allowed(sb, chosen.id).then((ok) => {
      if (!ok || gone || !holder.isConnected || panel.querySelector(".ml-open")) return;
      button = el("button", { type: "button", class: "ml-open", id: "ml-open", "aria-haspopup": "true", onclick: () => open() }, FP.icon ? FP.icon("layers", 16) : null, el("span", {}, "Edit layers"));
      foot.append(el("div", { class: "ml-open-row" }, button));
    });

    function open() {
      if (box || phone()) return;
      const published = read.published, saved = M.normalize(read.saved?.edits || {});
      let draft = M.normalize(saved), styleOpen = null, busy = false;
      const show = previewer(map, holder, M, published, saved);
      const place = owner?.farm ? "farm" : "group";
      const status = el("p", { class: "ml-status", role: "status", "aria-live": "polite" });
      const list = el("div", { class: "ml-list" });
      const count = el("span", { class: "ml-count" });
      const save = el("button", { type: "button", class: "ml-save", id: "ml-save", onclick: () => commit() }, "Save changes");
      const cancel = el("button", { type: "button", class: "ml-cancel", id: "ml-cancel", onclick: () => close(true) }, "Cancel");
      const reset = el("button", { type: "button", class: "ml-reset", id: "ml-reset", onclick: () => { draft = M.normalize({}); styleOpen = null; changed(); } }, "Reset to published");
      box = el("section", { class: "ml-edit", id: "ml-edit", "aria-labelledby": "ml-edit-title" },
        el("div", { class: "ml-head" }, el("h2", { id: "ml-edit-title" }, "Edit layers"), el("p", { class: "ml-who" }, M.WHO)),
        list,
        el("div", { class: "ml-foot" },
          el("p", { class: "ml-kept" }, M.savedLine(read.saved), " ", M.KEPT),
          status,
          el("div", { class: "ml-actions" }, count, el("span", { class: "ml-gap" }), cancel, save)));
      panel.classList.add("ml-editing");
      panel.append(box);
      button?.setAttribute("aria-expanded", "true");
      function changed() { show(draft); render(); }
      function render() {
        const rows = M.rowsOf(published, draft), here = rows.filter((r) => !r.removed), off = rows.filter((r) => r.removed);
        const kids = [];
        if (M.hasShade(published)) {
          kids.push(el("div", { class: "ml-map-row" }, el("label", { class: "ml-switch-row" },
            el("input", { type: "checkbox", class: "rv-switch ml-shade", id: "ml-shade", ...(M.shadeOn(draft) ? { checked: true } : {}), onchange: (e) => { draft = M.setShade(draft, e.target.checked); changed(); } }),
            el("span", {}, "Shade outside the " + place)),
            el("p", { class: "ml-note" }, "The darkening outside the " + place + "'s edge, for everyone.")));
        }
        let heading = null;
        for (const r of here) {
          if (r.group !== heading) { heading = r.group; if (r.group) kids.push(el("h3", { class: "ml-group" }, r.group)); }
          kids.push(row(r));
        }
        if (!here.length) kids.push(el("p", { class: "ml-note" }, "Every layer is taken off this map."));
        if (off.length) {
          kids.push(el("h3", { class: "ml-group" }, "Taken off this map"));
          for (const r of off) kids.push(el("div", { class: "ml-row ml-off", "data-layer": r.id }, el("div", { class: "ml-line" }, el("span", { class: "ml-name-text" }, r.title),
            el("button", { type: "button", class: "ml-back", "aria-label": "Put back " + r.title, onclick: () => { draft = M.set(draft, r.id, "removed", null); changed(); } }, "Put back"))));
        }
        kids.push(el("div", { class: "ml-reset-row" }, reset));
        const focus = document.activeElement?.closest?.(".ml-edit") ? { id: document.activeElement.id, at: document.activeElement.selectionStart } : null;
        const top = list.scrollTop;
        list.replaceChildren(...kids);
        list.scrollTop = top;
        if (focus?.id) { const f = document.getElementById(focus.id); if (f) { f.focus(); if (typeof focus.at === "number" && f.setSelectionRange) try { f.setSelectionRange(focus.at, focus.at); } catch { /* not a text box */ } } }
        const n = M.changes(draft, published), dirty = !M.same(draft, saved, published);
        count.textContent = dirty ? (n ? M.countLine(n) : "As published") : "";
        save.disabled = busy || !dirty;
        reset.disabled = busy || M.isEmpty(M.prune(draft, published));
        cancel.disabled = busy;
      }
      function row(r) {
        const name = r.title, key = String(r.id).replace(/[^a-z0-9_-]/gi, "");
        const up = el("button", { type: "button", class: "ml-move", id: "ml-up-" + key, "aria-label": "Move " + name + " up", title: "Move up", ...(M.canMove(published, draft, r.id, -1) ? {} : { disabled: true }), onclick: () => { draft = M.move(published, draft, r.id, -1); changed(); } }, FP.icon ? FP.icon("up", 16) : "↑");
        const down = el("button", { type: "button", class: "ml-move", id: "ml-down-" + key, "aria-label": "Move " + name + " down", title: "Move down", ...(M.canMove(published, draft, r.id, 1) ? {} : { disabled: true }), onclick: () => { draft = M.move(published, draft, r.id, 1); changed(); } }, FP.icon ? FP.icon("down", 16) : "↓");
        const swatchKid = r.simple && r.colour ? el("span", { class: "ml-dot", style: "--dot: " + r.colour }) : el("span", { class: "ml-dot ml-dot-qgis" });
        const more = el("button", { type: "button", class: "ml-more", id: "ml-more-" + key, "aria-expanded": String(styleOpen === r.id), "aria-controls": "ml-style-" + key, "aria-label": "Style of " + name, title: "Style",
          onclick: () => { styleOpen = styleOpen === r.id ? null : r.id; render(); } }, swatchKid);
        const kids = [el("div", { class: "ml-line" },
          el("input", { type: "checkbox", class: "rv-switch ml-on", id: "ml-on-" + key, "aria-label": "Show " + name + " when the map opens", ...(r.visible ? { checked: true } : {}),
            onchange: (e) => { draft = M.set(draft, r.id, "visible", e.target.checked === (r.published.visible !== false) ? null : e.target.checked); changed(); } }),
          el("input", { type: "text", class: "ml-name", id: "ml-name-" + key, value: name, maxlength: "200", "aria-label": "Name of the layer " + (r.published.title || r.id), spellcheck: "true",
            onchange: (e) => { const t = e.target.value.trim(); draft = M.set(draft, r.id, "title", t && t !== String(r.published.title || "").trim() ? t : null); changed(); } }),
          up, down, more)];
        if (styleOpen === r.id) kids.push(style(r, key));
        return el("div", { class: "ml-row" + (r.visible ? "" : " off"), "data-layer": r.id }, ...kids);
      }
      function style(r, key) {
        const parts = [];
        parts.push(el("label", { class: "ml-field" }, el("span", {}, "Opacity"),
          el("input", { type: "range", min: "10", max: "100", step: "5", value: String(Math.round(r.opacity * 100)), id: "ml-op-" + key, "aria-label": r.title + " opacity",
            oninput: (e) => { const v = Number(e.target.value) / 100; draft = M.set(draft, r.id, "opacity", v >= 1 ? null : v); show(draft); },
            onchange: () => render() }),
          el("output", { class: "ml-pc" }, Math.round(r.opacity * 100) + "%")));
        if (r.simple) {
          const pub = M.colourOf(r.published);
          parts.push(el("div", { class: "ml-field" }, el("span", { id: "ml-col-" + key }, "Colour"),
            el("div", { class: "ml-swatches", role: "group", "aria-labelledby": "ml-col-" + key },
              ...M.PALETTE.map(([c, label]) => el("button", { type: "button", class: "ml-swatch", style: "--dot: " + c, "aria-label": label, title: label, "aria-pressed": String(r.colour === c),
                onclick: () => { draft = M.set(draft, r.id, "color", c === pub ? null : c); changed(); } })),
              ...(pub && !M.PALETTE.some(([c]) => c === pub) ? [el("button", { type: "button", class: "ml-swatch", style: "--dot: " + pub, "aria-label": "As published", title: "As published", "aria-pressed": String(r.colour === pub),
                onclick: () => { draft = M.set(draft, r.id, "color", null); changed(); } })] : []))));
          if (r.line) {
            const pubW = M.widthOf(r.published);
            parts.push(el("div", { class: "ml-field" }, el("span", { id: "ml-w-" + key }, "Line"),
              el("div", { class: "ml-seg", role: "group", "aria-labelledby": "ml-w-" + key },
                ...M.WIDTHS.map(([w, label]) => el("button", { type: "button", "aria-pressed": String(r.width === w), onclick: () => { draft = M.set(draft, r.id, "width", w === pubW ? null : w); changed(); } }, label)))));
          }
        } else if (!r.imagery) parts.push(el("p", { class: "ml-note" }, "Its colours come from QGIS (it has several classes or parts)."));
        parts.push(el("button", { type: "button", class: "ml-takeoff", id: "ml-off-" + key, onclick: () => { draft = M.set(draft, r.id, "removed", true); styleOpen = null; changed(); } }, "Take off this map"));
        parts.push(el("p", { class: "ml-note ml-takeoff-note" }, "Hides the layer on this map for everyone. It is not a way to keep something private: anyone who can open this map can still get the layer's file."));
        return el("div", { class: "ml-style", id: "ml-style-" + key }, ...parts);
      }
      async function commit() {
        if (busy) return;
        const edits = M.prune(draft, published);
        busy = true; save.textContent = "Saving…"; render(); status.textContent = "";
        try {
          // someone else's save since this map was read is not written over (both would be kept; theirs would be hidden)
          const now = await sb.from("published_map_edits").select("id").eq("map_id", chosen.id).order("created_at", { ascending: false }).limit(1);
          if (now.error) throw now.error;
          if ((now.data?.[0]?.id || null) !== (read.saved?.id || null)) throw { code: "stale" };
          const { error } = await sb.from("published_map_edits").insert({ map_id: chosen.id, edits, based_on: read.version || null });
          if (error) throw error;
        } catch (e) {
          busy = false; save.textContent = "Save changes"; render();
          status.textContent = M.refusal(e);
          return;
        }
        close(false);
        ctx.redraw?.();
      }
      close = (discard) => {
        if (!box) return;
        const changedMap = !M.same(draft, saved, published);
        box.remove(); box = null;
        panel.classList.remove("ml-editing");
        button?.setAttribute("aria-expanded", "false");
        button?.focus?.();
        // the map as saved, exactly: its switches put back first (a map made again keeps the switches it had, MV1's withChoices), then drawn again
        if (discard && changedMap) { try { show(saved); } catch { /* drawn again below */ } ctx.redraw?.(); }
      };
      render();
      box.querySelector(".ml-on, .ml-shade, .ml-cancel")?.focus?.();
    }
    let close = () => {};
    return { remove: () => { gone = true; close(false); button?.closest(".ml-open-row")?.remove(); } };
  }

  FP.mapEdit = { attach, allowed };
})(typeof window === "undefined" ? globalThis : window);
