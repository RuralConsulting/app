// PH4: one pattern for every add form (the owner, 13 Nov 2026, from his iPhone: "The photo and add details forms are also clunky";
// his style guide: plain rows of text with a small leading circle or icon, no box round each option, one thin outline round a set,
// hairlines between rows, headings the size of the body, one quiet action, ink controls). A form is a sheet that takes the screen on
// a phone: one thin top row (Cancel on the left, the title, Save on the right as the one ink action), then its fields as plain rows
// in one or two outlined sets, the label on the left in quiet ink and the value on the right, no box round each field; what is
// optional folded behind one "More details" row; a choice (a date, a kind, a species, a site, tags) opens a plain list of rows with a
// tick or a circle; long text is one row that grows. A message about a field is a plain sentence under its row. The keyboard never
// covers the field being typed in or Save: on a phone the sheet is fitted to what the keyboard leaves of the screen.
//
//   FP.formRows.sheet({ id, title, saveLabel, onSave, onCancel, form, page, className, labelledBy })   the sheet: { node, sheet, top,
//                                       body, save, cancel, close() }; page: true makes `node` an in-page form (a section's route) that
//                                       takes the screen on a phone and sits in the page on a computer; otherwise an overlay dialog
//   FP.formRows.set(...rows)            one outlined set
//   FP.formRows.row({ key, label, forId, control, msgId })          a row: label left, value right, its message under it
//   FP.formRows.input(attrs) / text({ ... }) / long({ ... }) / big({ ... }) / pick({ ... }) / toggle({ ... }) / action({ ... })
//   FP.formRows.more({ label, rows, open })                       "More details": a row that opens the set under it
//   FP.formRows.say(row, text)                                     a plain sentence under a row (empty clears it)
//   FP.formRows.fit(node)                                          keep `node` inside what the keyboard leaves (a phone)
(function (root) {
  const FP = root.FP;
  const el = (...a) => FP.el(...a);
  const phone = () => !!root.matchMedia?.("(max-width: 800px)").matches;
  let n = 0;
  const uid = (p) => p + "-" + (++n).toString(36);

  // ---- the keyboard ---------------------------------------------------------------------------------------------------------------------
  // A phone's keyboard shrinks the visual viewport, not the page: a sheet fixed to the page's bottom would sit partly under it. While
  // `node` is on the page, on a phone, it is fitted to the visual viewport (its top and height), and the field with the focus is
  // scrolled into what shows of its scroller. The top row (Save) is at the sheet's top, so it always shows. Nothing on a computer.
  function fit(node, { bottom = false } = {}) {
    const vv = root.visualViewport;
    if (!vv || !node) return () => {};
    let seen = false;   // (a form drawn before it is placed on the page is fitted from when it is there until it is taken off)
    const apply = () => {
      if (!node.isConnected) { if (seen) stop(); return; }
      seen = true;
      if (!phone()) { node.style.removeProperty("top"); node.style.removeProperty("height"); node.style.removeProperty("bottom"); node.style.removeProperty("max-height"); return; }
      const full = vv.height >= root.innerHeight - 1 && !vv.offsetTop;
      if (bottom) {   // a sheet along the bottom: lifted to the keyboard's top, never taller than what shows
        if (full) { node.style.removeProperty("bottom"); node.style.removeProperty("max-height"); return; }
        node.style.bottom = Math.max(0, root.innerHeight - vv.height - vv.offsetTop) + "px";
        node.style.maxHeight = Math.round(vv.height - 8) + "px";
        return;
      }
      if (full) { node.style.removeProperty("top"); node.style.removeProperty("height"); node.style.removeProperty("bottom"); }
      else { node.style.top = Math.round(vv.offsetTop) + "px"; node.style.height = Math.round(vv.height) + "px"; node.style.bottom = "auto"; }
      reveal();
    };
    const reveal = () => {
      const f = root.document.activeElement;
      if (!f || !node.contains(f) || f === node) return;
      // inside its scroller, clear of the top row: the nearest scrolling box round it is moved, never the page
      for (let p = f.parentElement; p && p !== node.parentElement; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) {
          const r = f.getBoundingClientRect(), c = p.getBoundingClientRect(), pad = 12;
          const limit = Math.min(c.bottom, vv.offsetTop + vv.height);
          if (r.bottom > limit - pad) p.scrollTop += r.bottom - limit + pad;
          else if (r.top < c.top + pad) p.scrollTop -= c.top + pad - r.top;
          return;
        }
      }
    };
    const onFocus = () => { setTimeout(apply, 60); };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    node.addEventListener("focusin", onFocus);
    function stop() { vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply); node.removeEventListener("focusin", onFocus); }
    apply();
    return stop;
  }

  // ---- the sheet --------------------------------------------------------------------------------------------------------------------------
  function sheet({ id = null, title, titleId = null, saveLabel = "Save", onSave = null, onCancel = null, cancelLabel = "Cancel", form = false, page = false,
    className = "", saveId = null, cancelId = null, extra = null }) {
    const tid = titleId || uid("fs-title");
    const cancel = el("button", { type: "button", class: "fs-cancel", ...(cancelId ? { id: cancelId } : {}) }, cancelLabel);
    const save = onSave === false ? null : el("button", { type: form ? "submit" : "button", class: "fs-save", ...(saveId ? { id: saveId } : {}) }, saveLabel);
    const top = el("div", { class: "fs-top" }, cancel, el("h2", { id: tid, class: "fs-title", tabindex: "-1" }, title), el("span", { class: "fs-top-end" }, extra, save));
    const body = el("div", { class: "fs-body" });
    const sheetNode = el(form ? "form" : "div", { class: "fs-sheet" + (page ? " fs fs-page " + className : ""), ...(form ? { novalidate: true } : {}),
      ...(page ? (id ? { id } : {}) : { role: "dialog", "aria-modal": "true", "aria-labelledby": tid }) }, top, body);
    const node = page ? sheetNode : el("div", { class: "fs fs-overlay " + className, ...(id ? { id } : {}) }, sheetNode);
    if (!page) { node.setAttribute("role", "presentation"); }
    cancel.addEventListener("click", () => onCancel?.());
    if (save && !form && onSave) save.addEventListener("click", () => onSave());
    if (!page) {
      node.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onCancel?.(); return; }
        if (e.key !== "Tab") return;
        const f = [...sheetNode.querySelectorAll("button:not([disabled]), input:not([type=file]):not([disabled]), select, textarea, a[href]")].filter((x) => x.getClientRects().length && !x.closest("[hidden]"));
        if (!f.length) return;
        if (e.shiftKey && root.document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && root.document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      });
    }
    // fitted to the keyboard once it is on the page: an overlay when the caller has appended it (mounted), a page's form from now on
    let unfit = page ? fit(node) : null;
    const mounted = () => { unfit?.(); unfit = fit(node); };
    return { node, sheet: sheetNode, top, body, save, cancel, titleId: tid, mounted, close() { unfit?.(); node.remove(); } };
  }

  // ---- rows ------------------------------------------------------------------------------------------------------------------------------
  const set = (...rows) => el("div", { class: "fs-set" }, ...rows.flat().filter(Boolean));
  // A row: its label on the left (for the control), the value on the right, and a line for a message under it
  function row({ key = null, label, forId = null, control, msgId = null, className = "", hidden = false, hint = null }) {
    const msg = el("p", { class: "fs-msg", role: "status", ...(msgId ? { id: msgId } : {}) });
    const lab = forId ? el("label", { class: "fs-label", for: forId }, label) : el("span", { class: "fs-label" }, label);
    const r = el("div", { class: "fs-row " + className, ...(key ? { "data-row": key, "data-field": key } : {}), ...(hidden ? { hidden: true } : {}) }, lab, el("div", { class: "fs-value" }, control),
      hint ? el("small", { class: "fs-hint" }, hint) : null, msg);
    return r;
  }
  function say(r, text) {
    const m = r?.querySelector(":scope > .fs-msg");
    if (!m) return;
    m.textContent = text || "";
    const field = r._input || r.querySelector("input, textarea, select");
    if (field) { field.setAttribute("aria-invalid", text ? "true" : "false"); if (m.id) field.setAttribute("aria-describedby", m.id); }
    if (text) { const more = r.closest(".fs-more-set"); if (more?.hidden) more._open?.(); }
  }
  const input = (attrs = {}) => el("input", { class: "fs-input", autocomplete: "off", ...attrs });
  // A one-line text row
  function text({ id, key = id, label, value = "", placeholder = "", max = null, type = "text", inputmode = null, onInput = null, attrs = {}, hint = null }) {
    const i = input({ id, type, placeholder, ...(max ? { maxlength: String(max) } : {}), ...(inputmode ? { inputmode } : {}), ...attrs });
    i.value = value ?? "";
    if (onInput) i.addEventListener("input", () => onInput(i.value));
    const r = row({ key, label, forId: id, control: i, msgId: id + "-msg", hint });
    r._input = i;
    return r;
  }
  // Long text: one row that grows as it is typed in (up to about eight lines, then it scrolls)
  function grow(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 200) + "px"; }
  function long({ id, key = id, label, value = "", placeholder = "", max = null, onInput = null, attrs = {}, hint = null }) {
    const t = el("textarea", { id, class: "fs-input fs-long", rows: "1", placeholder, ...(max ? { maxlength: String(max) } : {}), ...attrs });
    t.value = value ?? "";
    t.addEventListener("input", () => { grow(t); onInput?.(t.value); });
    requestAnimationFrame(() => { if (t.isConnected) grow(t); });
    const r = row({ key, label, forId: id, control: t, msgId: id + "-msg", className: "fs-row-long", hint });
    r._input = t;
    return r;
  }
  // The one number a record is about (a reading, a count): large and easy, with its unit beside it
  function big({ id, key = id, label, value = "", placeholder = "", unit = null, inputmode = "decimal", labelNode = null, attrs = {} }) {
    const i = input({ id, type: "text", inputmode, placeholder, class: "fs-input fs-big-input", ...attrs });
    i.value = value ?? "";
    const r = el("div", { class: "fs-row fs-big", "data-row": key },
      labelNode || el("label", { class: "fs-label", for: id }, label),
      el("div", { class: "fs-value" }, i, unit ? (unit.nodeType ? unit : el("span", { class: "fs-unit" }, unit)) : null),
      el("p", { class: "fs-msg", role: "status", id: id + "-msg" }));
    r._input = i;
    return r;
  }
  // A choice: the row shows what is chosen and opens a plain list (list(), below). options: [{ value, label, hint? }] or a function
  // giving them; value(): the chosen value (or a list of them, multi); onPick(value | values). allowNew: { label, max, placeholder }
  // lets the person type one more (tags).
  function pick({ id, key = id, label, title = label, options, value, onPick, multi = false, allowNew = null, empty = "None", words = null, icon = null, max = null, tooMany = null }) {
    const shown = el("span", { class: "fs-chosen" });
    const b = el("button", { type: "button", id, class: "fs-row fs-pick", "data-row": key, "aria-haspopup": "dialog" },
      icon ? el("span", { class: "fs-lead", "aria-hidden": "true" }, FP.icon(icon, 20)) : null,
      el("span", { class: "fs-label" }, label), el("span", { class: "fs-value" }, shown), el("span", { class: "fs-chev", "aria-hidden": "true" }, FP.icon("chevron", 16)));
    const draw = () => {
      const v = value(), opts = typeof options === "function" ? options() : options;
      const text = words ? words(v) : multi ? (v || []).join(", ") : (opts.find((o) => String(o.value) === String(v))?.label ?? "");
      shown.textContent = text || empty;
      shown.classList.toggle("fs-empty", !text);
      b.setAttribute("aria-label", label + ": " + (text || empty));
    };
    b.addEventListener("click", () => list({ opener: b, title, options: typeof options === "function" ? options() : options, value: value(), multi, allowNew, max, tooMany,
      onPick: (v) => { onPick(v); draw(); } }));
    draw();
    const wrap = el("div", { class: "fs-pick-wrap" }, b, el("p", { class: "fs-msg", role: "status", id: id + "-msg" }));
    wrap.dataset.row = key;
    wrap._draw = draw;
    return wrap;
  }
  // The plain list a choice opens (FP.sheet: from the bottom on a phone, under the row on a computer): one outlined set of rows, a tick
  // (several) or a circle (one) at the start of each; one is chosen with a tap and the list closes; several are ticked and Done closes it.
  function list({ opener, title, options, value, multi, onPick, allowNew = null, max = null, tooMany = null }) {
    const chosen = new Set(multi ? (value || []).map((x) => String(x).toLowerCase()) : [String(value ?? "")]);
    let kept = multi ? [...(value || [])] : value;
    const extra = multi ? [...(value || [])].filter((v) => !options.some((o) => String(o.value).toLowerCase() === String(v).toLowerCase())).map((v) => ({ value: v, label: v })) : [];
    let all = [...extra, ...options];
    const box = el("div", { class: "fs-set fs-options", role: multi ? "group" : "radiogroup", "aria-label": title });
    const note = el("p", { class: "fs-msg fs-list-msg", role: "status" });
    const draw = (focus) => {
      box.replaceChildren(...all.map((o) => {
        const on = multi ? chosen.has(String(o.value).toLowerCase()) : chosen.has(String(o.value));
        const b = el("button", { type: "button", class: "fs-option", role: multi ? "checkbox" : "radio", "aria-checked": String(on), "data-value": String(o.value) },
          el("span", { class: multi ? "fs-tick" : "fs-circle", "aria-hidden": "true" }, multi && on ? FP.icon("check", 18) : null),
          el("span", { class: "fs-option-words" }, el("span", {}, o.label), o.hint ? el("small", {}, o.hint) : null));
        b.addEventListener("click", () => {
          if (!multi) { kept = o.value; onPick(o.value); FP.sheet.close(); return; }
          const k = String(o.value).toLowerCase();
          if (chosen.has(k)) { chosen.delete(k); kept = kept.filter((x) => String(x).toLowerCase() !== k); }
          else {
            if (max && kept.length >= max) { note.textContent = tooMany || "At most " + max + "."; return; }
            chosen.add(k); kept = [...kept, o.value];
          }
          note.textContent = "";
          onPick(kept.slice());
          draw(String(o.value));
        });
        return b;
      }));
      if (focus != null) box.querySelector('[data-value="' + CSS.escape(focus) + '"]')?.focus();
    };
    draw();
    const kids = [box];
    if (allowNew) {
      const field = input({ id: "fs-new-" + (++n), type: "text", placeholder: allowNew.placeholder || "New", maxlength: String(allowNew.max || 40), enterkeyhint: "done", "aria-label": allowNew.label || "New" });
      const add = el("button", { type: "button", class: "fs-add" }, allowNew.add || "Add");
      const addIt = () => {
        const v = (allowNew.tidy ? allowNew.tidy(field.value) : field.value.trim());
        if (!v) return;
        if (!all.some((o) => String(o.value).toLowerCase() === v.toLowerCase())) all = [{ value: v, label: v }, ...all];
        if (!chosen.has(v.toLowerCase())) {
          if (max && kept.length >= max) { note.textContent = tooMany || "At most " + max + "."; return; }
          chosen.add(v.toLowerCase()); kept = [...kept, v];
        }
        field.value = ""; note.textContent = "";
        onPick(kept.slice());
        draw();
        field.focus();
      };
      add.addEventListener("click", addIt);
      field.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addIt(); } });
      kids.push(el("div", { class: "fs-set fs-new" }, el("div", { class: "fs-row" }, el("label", { class: "fs-label", for: field.id }, allowNew.label || "New"), el("div", { class: "fs-value" }, field, add))));
    }
    kids.push(note);
    const node = FP.sheet.open({ opener, title, className: "fs-list" + (multi ? " fs-list-multi" : ""), body: () => kids });
    const panel = node?.querySelector(".add-panel");
    if (panel) fit(panel, { bottom: true });
    // the focus on the chosen row (one), else the first
    (box.querySelector('[aria-checked="true"]') || box.querySelector(".fs-option"))?.focus();
    return node;
  }
  // A yes or no as a row: the words on the left, the switch on the right
  function toggle({ id, key = id, label, hint = null, checked = false, onChange = null }) {
    const c = el("input", { id, type: "checkbox", role: "switch", class: "fs-switch", ...(checked ? { checked: true } : {}) });
    if (onChange) c.addEventListener("change", () => onChange(c.checked));
    const r = el("label", { class: "fs-row fs-toggle", for: id, "data-row": key }, el("span", { class: "fs-label fs-toggle-words" }, el("span", {}, label), hint ? el("small", {}, hint) : null), el("span", { class: "fs-value" }, c));
    r._input = c;
    return r;
  }
  // An action as a row: a small leading icon, then the words (a photo to add, a place to drop a pin)
  function action({ id, key = id, icon = null, label, value = null, onClick, attrs = {} }) {
    const b = el("button", { type: "button", id, class: "fs-row fs-action", "data-row": key, ...attrs },
      icon ? el("span", { class: "fs-lead", "aria-hidden": "true" }, FP.icon(icon, 20)) : null, el("span", { class: "fs-action-words" }, label), value ? el("span", { class: "fs-value fs-quiet-value" }, value) : null);
    b.addEventListener("click", onClick);
    return b;
  }
  // "More details": one row that opens the set of optional rows under it (and stays open once something in it needs fixing)
  function more({ label = "More details", rows = [], open = false, id = uid("fs-more") }) {
    const box = el("div", { class: "fs-set fs-more-set", id, hidden: !open }, ...rows.flat().filter(Boolean));
    const b = el("button", { type: "button", class: "fs-more", "aria-expanded": String(open), "aria-controls": id }, el("span", {}, label), el("span", { class: "fs-chev", "aria-hidden": "true" }, FP.icon("down", 16)));
    const setOpen = (on) => { box.hidden = !on; b.setAttribute("aria-expanded", String(on)); };
    box._open = () => setOpen(true);
    b.addEventListener("click", () => { setOpen(box.hidden); if (!box.hidden) box.querySelector("input, textarea, button, select")?.scrollIntoView?.({ block: "nearest" }); });
    const node = el("div", { class: "fs-more-wrap" }, b, box);
    node._open = () => setOpen(true);
    node._box = box;
    return node;
  }
  const quiet = (text, attrs = {}) => el("p", { class: "fs-quiet", ...attrs }, text);

  FP.formRows = { sheet, set, row, say, input, text, long, big, pick, list, toggle, action, more, quiet, fit, grow };
})(window);
