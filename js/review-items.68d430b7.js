// RV1: review items a group can come back to (LT1: and the LINZ titles check's questions about members' land), drawn inside the People view (people.js reads and answers them; the words and the logic
// are in review-items-model.js). Questions about the group's member register that only someone who knows the farms can answer,
// raised by RCL's tools; the group's facilitators, advisors and admins answer them whenever they get to it. Answering records the
// answer and changes nothing else. Safe DOM only (FP.el): no data is ever written as HTML.
(function (root) {
  const FP = root.FP;
  const M = () => FP.reviewItemsModel;
  const el = (...a) => FP.el(...a);

  // ---- a small map of the place, when the item has one (the events place picker's map: MapLibre over the aerial basemap) -----------
  let shown = null;
  function release() { try { shown?.remove(); } catch { /* already gone */ } shown = null; }
  function mapPreview(place) {
    const gl = root.maplibregl;
    if (!place || !(typeof gl === "object" || typeof gl === "function") || !FP.basemaps?.style) return null;
    const slot = el("div", { class: "rv-map", role: "img", "aria-label": "Map of the place: " + M().placeText(place) });
    // made once the slot is on the page, so the map takes its size
    (root.requestAnimationFrame || ((f) => setTimeout(f, 0)))(() => {
      if (!slot.isConnected) return;
      release();
      try {
        gl.setWorkerUrl?.("vendor/maplibre-gl-csp-worker.f950e7b1.js");
        shown = new gl.Map({ container: slot, style: FP.basemaps.style("aerial"), center: [place.lon, place.lat], zoom: 14, interactive: false,
          attributionControl: { compact: true } });
        new gl.Marker().setLngLat([place.lon, place.lat]).addTo(shown);
      } catch { slot.replaceChildren(el("p", { class: "group-fine" }, "The map couldn't open here.")); }
    });
    return slot;
  }

  // The member numbers, each a button to that business's page in People when the register has it.
  function members(list, directory, onMember) {
    const links = M().memberLinks(list, directory);
    if (!links.length) return null;
    return el("span", { class: "rv-members" }, links.length === 1 ? "Member " : "Members ", ...links.flatMap((l, i) => [
      i ? ", " : null,
      l.business ? el("button", { type: "button", class: "link", "data-member": l.number, title: l.business.business_name + (l.business.ended ? " (ended)" : ""),
        onclick: (e) => { e.stopPropagation(); onMember(l.business.group_member_id); } }, l.number)
        : el("span", { "data-member": l.number, title: "Not on the group's register" }, l.number + " (not on the register)")]));
  }

  // ---- the list ----------------------------------------------------------------------------------------------------------------------
  // o: { all: items, filter, failed, truncated, directory, onFilter(k), onOpen(item), onMember(id), backButton }
  function listScreen(o) {
    const box = el("div", { class: "rv-list", "data-view": "review" }, o.backButton("Back to People"), el("h3", {}, "To review"),
      el("p", { class: "crm-sub" }, "Questions about the member register and members' land that need someone who knows the farms. Come back to them when you can. "
        + "Answering records what you say for RCL and the group to act on; it changes nothing by itself."));
    if (o.failed) { box.append(el("p", { role: "alert", class: "crm-failed" }, "Couldn't read the items to review just now: " + o.failed)); return box; }
    const all = o.all || [], open = M().openCount(all);
    box.append(el("div", { class: "crm-chips", role: "group", "aria-label": "Show" }, ...M().FILTERS.map(([k, label]) =>
      el("button", { type: "button", class: "crm-chip", "aria-pressed": String(o.filter === k), "data-filter": k, onclick: () => o.onFilter(k) },
        label + (k === "open" ? " (" + open + ")" : k === "answered" ? " (" + (all.length - open) + ")" : "")))));
    // PF1: a search (member number, or words in the topic or question), and the list in the order a person works through it:
    // the items that stand out first, then the rest grouped by topic with a count, a long group folded (review-items-model.js arrange)
    const search = el("input", { id: "rv-search", type: "search", autocomplete: "off", placeholder: "Member number, or words in the question", "aria-label": "Search the items" });
    search.value = o.q || "";
    const status = el("p", { class: "crm-count", role: "status" }), list = el("div", { class: "rv-sections" });
    const row = (it) => el("li", { class: "crm-row rv-row" + (it.open ? "" : " ended") },
      el("button", { type: "button", "data-review": String(it.id), onclick: () => o.onOpen(it) },
        el("span", { class: "crm-row-main" }, el("b", {}, it.topic),
          it.open ? null : el("span", { class: "crm-badge" }, it.state === "not_needed" ? "Not needed" : "Answered")),
        el("span", { class: "rv-question" }, it.question),
        el("small", {}, M().raisedText(it))),
      members(it.members, o.directory, o.onMember));
    function fill() {
      const sections = M().arrange(all, { filter: o.filter, q: search.value }), n = M().arrangedCount(sections);
      status.textContent = M().countText(n, o.filter);
      list.replaceChildren(...(!n ? [el("p", { class: "crm-empty" }, search.value.trim() ? "Nothing matches." : M().emptyText(o.filter, all.length))]
        : sections.map((sec) => {
          const ul = el("ul", { class: "crm-list" }, ...sec.items.map(row));
          if (sec.answered && o.filter === "all") return el("section", { class: "rv-section" }, el("h4", {}, "Answered (" + sec.items.length + ")"), ul);
          if (!sec.topic) return ul;
          const group = el("details", { class: "rv-group", "data-topic": sec.topic, ...(sec.folded ? {} : { open: true }) },
            el("summary", {}, sec.topic + " (" + sec.items.length + ")"), ul);
          return group;
        })));
    }
    search.addEventListener("input", () => { o.onSearch?.(search.value); fill(); });
    box.append(el("div", { class: "crm-search" }, search), status, list);
    fill();
    if (o.truncated) box.append(el("p", { class: "group-fine" }, "Only the newest " + M().CAP + " are listed."));
    return box;
  }

  // ---- one item ------------------------------------------------------------------------------------------------------------------------
  // o: { item, team, me, directory, form: {action, answer, note}, errors, busy, onAnswer(form), onMember(id), backButton }
  function itemScreen(o) {
    const it = o.item;
    const page = el("div", { class: "crm-page rv-item", "data-review": String(it.id) }, o.backButton("Back to the list"), el("h3", {}, it.topic));
    page.append(el("p", { class: "crm-sub" }, M().raisedText(it), it.members.length ? " · " : null, members(it.members, o.directory, o.onMember)));
    page.append(el("p", { class: "crm-notes rv-ask" }, it.question));
    if (it.facts.length) page.append(el("section", { class: "crm-section" }, el("h4", {}, "What we know"), el("ul", { class: "rv-facts" }, ...it.facts.map((f) => el("li", {}, f)))));
    if (it.place) {
      page.append(el("section", { class: "crm-section" }, el("h4", {}, "Where"), mapPreview(it.place),
        el("p", { class: "group-fine" }, M().placeText(it.place))));
    }
    page.append(it.open ? answerForm(o) : answered(o));
    // LT1: a question from the LINZ titles check credits its source (CC BY 4.0), as the basemaps do
    if (M().isTitle(it)) page.append(el("p", { class: "group-fine rv-source" }, M().TITLE_SOURCE));
    return page;
  }

  function answered(o) {
    const it = o.item;
    return el("section", { class: "crm-section rv-answered", "data-state": it.state }, el("h4", {}, it.state === "not_needed" ? "Not needed" : "Answer"),
      el("dl", { class: "crm-facts" },
        el("dt", {}, "Answer"), el("dd", {}, it.answerLabel || "—"),
        ...(it.typed ? [el("dt", {}, "In their words"), el("dd", { class: "crm-notes" }, it.typed)] : []),
        ...(it.note ? [el("dt", {}, "Note"), el("dd", { class: "crm-notes" }, it.note)] : []),
        el("dt", {}, "Who"), el("dd", {}, M().whoText(it, o.team, o.me))),
      el("p", { class: "group-fine" }, "An answer is kept as it was given. Nothing on the register or the map changed because of it: RCL staff act on it. "
        + "If it needs another look, ask RCL to raise it again."));
  }

  function answerForm(o) {
    const it = o.item, f = { action: "", answer: "", note: "", ...(o.form || {}) };
    const form = el("form", { class: "crm-form rv-form", novalidate: true });
    // the reasons from the last Save, cleared as soon as the person changes something
    const errors = el("div", { class: "crm-errors", role: "alert" }, ...(o.errors || []).map((e) => el("p", {}, e)));
    const pick = (action) => { f.action = action; errors.replaceChildren(); sync(); };
    const choice = (a, extra = {}) => el("button", { type: "button", role: "radio", "aria-checked": "false", "data-action": a.action, onclick: () => pick(a.action), ...extra }, a.label);
    const options = el("div", { class: "rv-answers", role: "radiogroup", "aria-label": "Answer" },
      ...M().suggested(it).map((a) => choice(a)), choice({ action: "other", label: M().otherLabel(it) }), choice({ action: "not_needed", label: "Not needed" }));
    const typed = el("textarea", { id: "rv-answer", rows: "3", maxlength: String(M().MAX_TEXT), placeholder: "Say what the answer is" });
    typed.value = f.answer; typed.addEventListener("input", () => { f.answer = typed.value; errors.replaceChildren(); });
    const typedField = el("div", { class: "crm-field" }, el("label", { for: "rv-answer" }, "The answer"), typed);
    const note = el("textarea", { id: "rv-note", rows: "3", maxlength: String(M().MAX_TEXT), placeholder: "Optional: how you know, who you asked, what should happen next" });
    note.value = f.note; note.addEventListener("input", () => { f.note = note.value; });
    function sync() {
      for (const b of options.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.action === f.action));
      typedField.hidden = f.action !== "other";
    }
    sync();
    form.addEventListener("submit", (e) => { e.preventDefault(); if (!o.busy) o.onAnswer({ ...f }); });
    form.append(el("fieldset", {}, el("legend", {}, "Your answer"), options), typedField,
      el("div", { class: "crm-field" }, el("label", { for: "rv-note" }, "Note"), note),
      errors,
      el("p", { class: "group-fine" }, "Saving records the answer and who gave it. It changes nothing on the register, the map or the files by itself: RCL staff act on it."),
      el("div", { class: "crm-save" }, el("button", { type: "submit", class: "primary", ...(o.busy ? { disabled: true } : {}) }, o.busy ? "Saving…" : "Save the answer")));
    return el("section", { class: "crm-section" }, form);
  }

  FP.reviewItems = { listScreen, itemScreen, mapPreview, release };
})(typeof window === "undefined" ? globalThis : window);
