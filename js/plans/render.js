// The Farm Environment Plan / Freshwater Farm Plan renderer (docs/side-projects/PLANS.md §6): one function,
// (definition, values, brand, figures) -> semantic HTML, used for the screen and for print; app/css/plan-print.css
// lays the same HTML out on A4. Pure: no DOM, network or clock, so tests and a later PDF export (PL14) run it as is.
//
//   definition  a plan/1 template definition: parts -> nodes (group, item, table, records, map) with fields.
//               Nodes with fixed_text carry wording the plan prints verbatim (Schedule 7 objectives and targets).
//   values      { farm, issued_on: "YYYY-MM-DD", nodes: { [node key]: data }, switched_off: [part or node keys] }
//               data per node kind: item -> { field: value }; item with repeat -> { [instance]: { field: value } }
//               (instances in order, e.g. "LU1"); table and records -> [{ field: value }, ...]; map -> { field: value }.
//               switched_off entries are a key, or { key, reason } to say why (e.g. "No dairy shed on this farm").
//               valuesFromPlanDocument() builds this from a PlanDocument (tools/plans/plan_document.py).
//   brand       { display_name, accent: "#rrggbb", logo?, logo_dark?, footer?, contact? }: applied here, never stored
//               in a definition. An accent below WCAG AA (4.5:1) on paper is refused with a BrandError.
//   figures     { [map node key]: { alt, src?, caption? } }: alt text for each map; src once Map scenes print.
//
// The document never shows a blank where something is required: an empty required node, field or table reads
// "To complete". Guidance text is help for whoever writes the plan and is not printed.
// Management areas (group nodes: Schedule 7 5A–5G) are always printed, in order, so a reader sees every area
// addressed: one switched off prints its heading and "Not applicable — <reason>" (PM ruling on #210, 30 Oct 2026).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.farmPlans = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const TO_COMPLETE = "To complete";
  const PAPER = "#ffffff", AA = 4.5;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const blank = (v) => v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || (isObject(v) && !Object.keys(v).length);
  const id = (key) => "plan-" + String(key).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // A CSS string for the running header and footer: every character but letters, digits and spaces escaped, so
  // nothing in a farm name or brand line can end the string or the <style> element.
  const cssString = (s) => '"' + [...String(s)].map((c) => (/[A-Za-z0-9 ]/.test(c) ? c : "\\" + c.codePointAt(0).toString(16) + " ")).join("") + '"';

  // ---- brand -------------------------------------------------------------------------------------------------
  class BrandError extends Error { constructor(message) { super(message); this.name = "BrandError"; } }
  const channel = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = (hex) => hex.slice(1).match(/../g).map((x) => channel(parseInt(x, 16))).reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0);
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // Images: a data: image or a same-site path (no scheme, no //, no ..). <img> never runs script, SVG included.
  const IMAGE = /^(?:data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+|(?![a-z][a-z0-9+.-]*:)(?!\/\/)[A-Za-z0-9_\-./]+\.(?:png|jpe?g|webp|svg))$/;
  const image = (v) => (typeof v === "string" && IMAGE.test(v) && !v.includes("..") ? v : null);

  function checkBrand(brand) {
    if (!isObject(brand)) throw new BrandError("A brand needs a display name and an accent colour");
    const name = text(brand.display_name);
    if (!name) throw new BrandError("A brand needs a display name");
    const accent = String(brand.accent || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(accent)) throw new BrandError(name + ": the accent must be a colour written #rrggbb");
    const ratio = contrast(accent, PAPER);
    if (ratio < AA) throw new BrandError(name + ": the accent " + accent + " is too light to read on paper (" + ratio.toFixed(2) + ":1; at least " + AA + ":1 is needed)");
    for (const k of ["logo", "logo_dark"]) if (brand[k] != null && !image(brand[k])) throw new BrandError(name + ": the " + k.replace("_", " ") + " must be an image on this site");
    return Object.freeze({ display_name: name, accent, ratio, logo: image(brand.logo), logo_dark: image(brand.logo_dark),
      footer: text(brand.footer) || name, contact: text(brand.contact) || null });
  }

  // ---- values --------------------------------------------------------------------------------------------------
  function* walk(nodes, parent = null) { for (const n of nodes || []) { yield [n, parent]; if (n.kind === "group") yield* walk(n.nodes, n); } }
  function index(definition) {
    const byKey = new Map();
    for (const part of definition.parts || []) for (const [n] of walk(part.nodes)) byKey.set(n.key, n);
    return byKey;
  }
  const isRows = (node) => node.kind === "table" || node.kind === "records";
  const repeats = (node) => node.repeat && node.repeat !== "none";

  // PlanDocument values [{node, instance, field, value}] -> the nested shape render() takes. Table rows are
  // instances "r1", "r2"... in row order; repeated nodes keep their instance keys in first-seen order.
  function valuesFromPlanDocument(definition, doc, extra = {}) {
    const byKey = index(definition), nodes = {};
    for (const v of doc?.values || []) {
      const node = byKey.get(v.node);
      if (!node || v.field == null) continue;
      if (isRows(node)) {
        const rows = nodes[v.node] = nodes[v.node] || {};
        (rows[v.instance || "r1"] = rows[v.instance || "r1"] || {})[v.field] = v.value;
      } else if (repeats(node)) {
        const inst = nodes[v.node] = nodes[v.node] || {};
        (inst[v.instance || "-"] = inst[v.instance || "-"] || {})[v.field] = v.value;
      } else (nodes[v.node] = nodes[v.node] || {})[v.field] = v.value;
    }
    const order = (k) => { const m = /(\d+)$/.exec(k); return m ? Number(m[1]) : 0; };
    for (const [key, data] of Object.entries(nodes)) if (isRows(byKey.get(key))) nodes[key] = Object.keys(data).sort((a, b) => order(a) - order(b)).map((k) => data[k]);
    return { ...extra, nodes, switched_off: [...(doc?.switched_off || [])] };
  }

  // ---- formatting ----------------------------------------------------------------------------------------------
  function formatDate(v) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text(v));
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return String(v);
    return (m[3] ? Number(m[3]) + " " : "") + MONTHS[Number(m[2]) - 1] + " " + m[1];
  }
  function formatNumber(v, unit) {
    const n = typeof v === "number" ? v : Number(text(String(v)));
    if (v === "" || !Number.isFinite(n)) return String(v);
    return n.toLocaleString("en-NZ", { maximumFractionDigits: 2 }) + (unit ? " " + unit : "");
  }
  // Prose: blank lines separate paragraphs; lines that start "- " or "• " make a list.
  function prose(v) {
    return String(v).trim().split(/\n\s*\n/).map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => /^[-•]\s+/.test(l))) return "<ul>" + lines.map((l) => "<li>" + esc(l.replace(/^[-•]\s+/, "")) + "</li>").join("") + "</ul>";
      return "<p>" + lines.map(esc).join("<br>") + "</p>";
    }).join("");
  }
  // A field's value as HTML, or null when there is nothing to show.
  function valueHtml(field, v, { long = false } = {}) {
    if (blank(v)) return null;
    if (field.type === "boolean" && typeof v === "boolean") return v ? "Yes" : "No";
    if (field.type === "number") return esc(formatNumber(v, field.unit));
    if (field.type === "date") return esc(formatDate(v));
    if (field.type === "text" && long) return prose(v);
    return esc(Array.isArray(v) ? v.join(", ") : v);
  }
  // Labels are written for whoever fills the plan in; the printed plan drops the hints ("(e.g. LU1)", "(if used)").
  const label = (field) => String(field.label || field.key).replace(/\s*\((?:e\.g\.|if\b)[^)]*\)\s*$/i, "").replace(/\s*\([^)]*…\)\s*$/, "").trim();
  const todo = (tag = "span") => "<" + tag + ' class="plan-todo">' + TO_COMPLETE + "</" + tag + ">";
  const isLong = (field, v) => field.type === "text" && typeof v === "string" && (v.length > 90 || v.includes("\n"));

  // ---- what is shown ---------------------------------------------------------------------------------------------
  function filled(node, data) {
    if (blank(data)) return false;
    if (isRows(node)) return Array.isArray(data) && data.some((r) => isObject(r) && Object.values(r).some((x) => !blank(x)));
    if (repeats(node)) return isObject(data) && Object.values(data).some((r) => isObject(r) && Object.values(r).some((x) => !blank(x)));
    return isObject(data) && Object.values(data).some((x) => !blank(x));
  }

  function render(definition, values, brand, figures) {
    if (!isObject(definition) || !Array.isArray(definition.parts)) throw new Error("A document definition needs its parts");
    const b = checkBrand(brand);
    const vals = isObject(values) ? values : {};
    const data = isObject(vals.nodes) ? vals.nodes : {};
    // Switched off: a key, or { key, reason }. The reason is printed where a management area does not apply.
    const offList = Array.isArray(vals.switched_off) ? vals.switched_off : [];
    const off = new Set(offList.map((o) => (isObject(o) ? o.key : o)).filter((k) => typeof k === "string"));
    const offReason = new Map(offList.filter((o) => isObject(o) && text(o.reason)).map((o) => [o.key, text(o.reason)]));
    const figs = isObject(figures) ? figures : {};
    const byKey = index(definition);
    let figureCount = 0;

    const hasValues = (node) => node.kind === "group" ? (node.nodes || []).some(hasValues) : filled(node, data[node.key]) || (node.kind === "map" && !!figs[node.key]);
    const shown = (node) => {
      if (node.kind === "group") return true;
      if (off.has(node.key)) return false;
      return node.required === true || hasValues(node);
    };
    // Inside a shown group, a node with fixed text is always printed: it is the plan's own wording.
    const shownInGroup = (node) => !off.has(node.key) && (node.required === true || !!node.fixed_text || hasValues(node));

    // Repeated nodes: instance order. Land units follow the order of the unit node (the one with a name field);
    // a required node lists every unit so a missing one reads "To complete".
    const unitNode = [...byKey.values()].find((n) => n.repeat === "lmu" && (n.fields || []).some((f) => f.key === "name"));
    function instances(node) {
      const own = isObject(data[node.key]) ? Object.keys(data[node.key]) : [];
      if (node.repeat === "lmu") {
        const base = unitNode && isObject(data[unitNode.key]) ? Object.keys(data[unitNode.key]) : [];
        const extra = own.filter((k) => !base.includes(k));
        return node.required === true ? [...base, ...extra] : [...base.filter((k) => own.includes(k)), ...extra];
      }
      const options = (node.fields || []).find((f) => f.key === "management_area")?.options || [];
      return [...options.filter((o) => own.includes(o)), ...own.filter((k) => !options.includes(k))];
    }
    function instanceLabel(node, key) {
      if (node.repeat === "lmu") {
        const u = unitNode ? data[unitNode.key]?.[key] : null;
        const code = text(u?.code) || key, name = text(u?.name);
        return name ? code + " – " + name : code;
      }
      return text(data[node.key]?.[key]?.management_area) || key;
    }
    const labelFields = (node) => (node.repeat === "lmu" ? ["code", "name"] : ["management_area"]);
    const instanceHeading = (node) => {
      if (node.repeat === "lmu") return unitNode?.title || "Land unit";
      return label((node.fields || []).find((f) => f.key === "management_area") || { key: "Management area" });
    };

    // A list of fields (an item, a map's checklist, one instance of a repeated node).
    function fields(node, row, { skip = [] } = {}) {
      const list = (node.fields || []).filter((f) => !skip.includes(f.key));
      const applies = list.find((f) => f.key === "applies");
      const out = [];
      let rest = list;
      // Targets: "Applies" or "Not applicable" is the target's status, in words; a target that does not apply
      // needs only its reason.
      if (applies) {
        const v = text(row?.applies), reason = list.find((f) => f.key === "not_applicable_reason");
        if (v === "Not applicable") {
          const why = reason && valueHtml(reason, row?.[reason.key]);
          out.push('<p class="plan-status" data-status="not-applicable"><strong>Not applicable</strong> — ' + (why || todo()) + "</p>");
          rest = [];
        } else {
          out.push(v ? '<p class="plan-status" data-status="applies"><strong>' + esc(v) + "</strong></p>"
            : applies.required ? '<p class="plan-status" data-status="to-complete">' + todo() + "</p>" : "");
          rest = list.filter((f) => f !== applies && f !== reason);
        }
      }
      const items = rest.map((f) => {
        const v = row?.[f.key], long = isLong(f, v);
        const html = valueHtml(f, v, { long });
        if (html == null && !f.required) return "";
        return '<div class="plan-field' + (long ? " plan-field-long" : "") + '" data-field="' + esc(f.key) + '"><dt>' + esc(label(f)) + "</dt><dd>" + (html ?? todo()) + "</dd></div>";
      }).filter(Boolean);
      if (items.length) out.push('<dl class="plan-fields">' + items.join("") + "</dl>");
      return out.join("");
    }

    // A table: real column headers, the first column as row headers, optional columns with nothing in them left out.
    // Tables with a management area column (risk and action tables) print the area once, as a row spanning the
    // table above its rows, instead of repeating it on every row. Rows keep their recorded order: a new group row
    // starts wherever the area changes.
    function table(labelledBy, columns, rows, { required }) {
      const group = rows.length > 1 && columns.find((c) => c.key === "management_area" && c.field.type === "select");
      const shownColumns = group ? columns.filter((c) => c !== group) : columns;
      const used = shownColumns.filter((c) => c.always || c.field.required || rows.some((r) => !blank(r.cells[c.key])));
      const head = "<thead><tr>" + used.map((c) => '<th scope="col">' + esc(c.label) + "</th>").join("") + "</tr></thead>";
      const cell = (c, r, i) => {
        const v = r.cells[c.key], html = c.html ? c.html(r) : valueHtml(c.field, v);
        const content = html ?? (c.field.required ? todo() : '<span class="plan-none">—</span>');
        const tag = i === 0 ? "th" : "td";
        return "<" + tag + (i === 0 ? ' scope="row"' : "") + ' data-label="' + esc(c.label) + '"' + (c.field.type ? ' data-type="' + esc(c.field.type) + '"' : "") + ">" + content + "</" + tag + ">";
      };
      let last;
      const groupRow = (r) => {
        const v = text(r.cells[group.key]);
        if (v === last) return "";
        last = v;
        return '<tr class="plan-group-row"><th scope="colgroup" colspan="' + used.length + '">' + (v ? esc(v) : todo()) + "</th></tr>";
      };
      const body = rows.length ? rows.map((r) => (group ? groupRow(r) : "") + "<tr>" + used.map((c, i) => cell(c, r, i)).join("") + "</tr>").join("")
        : required ? '<tr><td colspan="' + used.length + '">' + todo() + "</td></tr>" : "";
      return '<div class="plan-table"><table aria-labelledby="' + labelledBy + '">' + head + "<tbody>" + body + "</tbody></table></div>";
    }
    const fieldColumns = (node, skip = []) => (node.fields || []).filter((f) => !skip.includes(f.key)).map((f) => ({ key: f.key, label: label(f), field: f }));

    const print = (node) => node.print || {};
    // The first node in a part never breaks: its part heading would be left alone at the foot of a page.
    const attrs = (node, first = false) => {
      const p = print(node);
      return (p.orientation === "landscape" ? ' data-orientation="landscape"' : "") + (p.break_before && !first ? ' data-break="before"' : "");
    };

    function nodeHtml(node, level, group, first = false) {
      const h = "h" + Math.min(level, 6), hid = id(node.key);
      const title = group && String(node.title).startsWith(group.title + ": ") ? node.title.slice(group.title.length + 2) : node.title;
      const heading = "<" + h + ' id="' + hid + '">' + esc(title) + "</" + h + ">";
      const open = '<section class="plan-node" data-node="' + esc(node.key) + '" data-kind="' + esc(node.kind) + '"' + attrs(node, first) + ">";
      const d = data[node.key];

      if (node.kind === "group") {
        if (off.has(node.key)) {
          const why = offReason.get(node.key);
          return '<section class="plan-group" data-node="' + esc(node.key) + '" data-status="not-applicable">' + heading +
            '<p class="plan-status" data-status="not-applicable"><strong>Not applicable</strong> — ' + (why ? esc(why) : todo()) + "</p></section>";
        }
        const kids = (node.nodes || []).filter(shownInGroup).map((n) => nodeHtml(n, level + 1, node)).join("");
        return '<section class="plan-group" data-node="' + esc(node.key) + '"' + attrs(node, first) + ">" + heading + kids + "</section>";
      }
      if (isRows(node)) {
        const rows = (Array.isArray(d) ? d : []).filter((r) => isObject(r) && Object.values(r).some((x) => !blank(x))).map((r) => ({ cells: r }));
        return open + heading + table(hid, fieldColumns(node), rows, { required: node.required === true }) + "</section>";
      }
      if (repeats(node)) {
        const keys = instances(node).filter((k) => isObject(d?.[k]) || node.repeat === "lmu");
        const skip = labelFields(node).filter((k) => (node.fields || []).some((f) => f.key === k));
        const prose = keys.some((k) => (node.fields || []).some((f) => isLong(f, d?.[k]?.[f.key])));
        if (!keys.length) return open + heading + "<p>" + todo() + "</p></section>";
        if (prose) {
          // One section per instance, headed by its name (e.g. "LU1 – Irrigated light soils").
          return keys.map((k, i) => '<section class="plan-node plan-instance" data-node="' + esc(node.key) + '" data-instance="' + esc(k) + '"' + (i === 0 ? attrs(node, first) : "") + ">" +
            "<" + h + ' id="' + hid + "-" + id(k).slice(5) + '">' + esc(instanceLabel(node, k)) + "</" + h + ">" + fields(node, d?.[k], { skip }) + "</section>").join("");
        }
        const columns = [{ key: "_instance", label: instanceHeading(node), field: { type: "text", required: true }, always: true, html: (r) => esc(r.label) }, ...fieldColumns(node, skip)];
        const rows = keys.map((k) => ({ label: instanceLabel(node, k), cells: d?.[k] || {} }));
        return open + heading + table(hid, columns, rows, { required: node.required === true }) + "</section>";
      }
      if (node.kind === "map") {
        const f = figs[node.key] || (text(d?.scene_ref) && figs[d.scene_ref]) || null;
        const n = ++figureCount, alt = text(f?.alt);
        const src = image(f?.src);
        const frame = src ? '<img src="' + esc(src) + '" alt="' + esc(alt) + '">'
          : '<div class="plan-figure-frame" role="img" aria-label="' + esc(alt || node.title) + '">' + (alt ? "<p>" + esc(alt) + "</p>" : "<p>" + todo() + "</p>") + "</div>";
        const caption = "<figcaption><span class=\"plan-figure-number\">Figure " + n + ".</span> " + esc(text(f?.caption) || node.title) + "</figcaption>";
        return open + heading + '<figure class="plan-figure" data-figure="' + (src ? "image" : "pending") + '">' + frame + caption + "</figure>" + fields(node, d, { skip: ["scene_ref"] }) + "</section>";
      }
      // An item: fixed wording first, then its fields.
      const fixed = node.fixed_text ? '<figure class="plan-fixed"><blockquote><p>' + esc(node.fixed_text) + "</p></blockquote>" +
        (text(node.cite) ? "<figcaption>" + esc(node.cite.replace(/\s*\[[^\]]+\]\s*$/, "")) + "</figcaption>" : "") + "</figure>" : "";
      const body = fields(node, isObject(d) ? d : {});
      return open + heading + fixed + (body || (node.required && !node.fixed_text ? "<p>" + todo() + "</p>" : "")) + "</section>";
    }

    // ---- the document ------------------------------------------------------------------------------------------
    const m = /^(.*?)\s*\((.+)\)\s*$/.exec(text(definition.title));
    const docName = m ? m[1] : text(definition.title) || "Untitled";
    const qualifier = m ? m[2] : "";
    const farm = text(vals.farm) || TO_COMPLETE;
    const issued = text(vals.issued_on) ? formatDate(vals.issued_on) : TO_COMPLETE;
    // Who prepared it and which version, wherever the definition keeps them.
    const first = (keys) => { for (const n of byKey.values()) for (const k of keys) { const v = isObject(data[n.key]) && !isRows(n) && !repeats(n) ? data[n.key][k] : null; if (!blank(v)) return n.fields?.find((f) => f.key === k)?.type === "date" ? formatDate(v) : String(v); } return null; };
    const meta = [["Issued", issued], ["Prepared by", [first(["prepared_by", "preparer_name"]), first(["organisation"])].filter(Boolean).join(", ")], ["Version", first(["version_label"])]].filter(([, v]) => v);
    const parts = definition.parts.filter((p) => !off.has(p.key) && (p.nodes || []).some(shown));
    const logos = b.logo ? '<img class="plan-logo plan-logo-light" src="' + esc(b.logo) + '" alt="' + esc(b.display_name) + '">' +
      (b.logo_dark ? '<img class="plan-logo plan-logo-dark" src="' + esc(b.logo_dark) + '" alt="' + esc(b.display_name) + '">' : "")
      : '<span class="plan-wordmark">' + esc(b.display_name) + "</span>";
    const running = "<style>:root{--plan-running-farm:" + cssString(farm) + ";--plan-running-title:" + cssString(docName) + ";--plan-running-date:" + cssString(issued) +
      ";--plan-running-foot:" + cssString(b.footer) + "}</style>";
    const cover = '<header class="plan-cover">' +
      '<div class="plan-brand' + (b.logo && !b.logo_dark ? " plan-brand-single" : "") + '">' + logos + "</div>" +
      '<h1 class="plan-title">' + esc(docName) + (qualifier ? ' <span class="plan-qualifier">' + esc(qualifier) + "</span>" : "") + "</h1>" +
      '<p class="plan-farm">' + esc(farm) + "</p>" +
      '<dl class="plan-cover-meta">' + meta.map(([k, v]) => "<div><dt>" + k + "</dt><dd>" + esc(v) + "</dd></div>").join("") + "</dl>" +
      (parts.length ? '<nav class="plan-contents" aria-labelledby="plan-contents"><h2 id="plan-contents">Contents</h2><ol>' +
        parts.map((p, i) => '<li><span class="plan-num">' + (i + 1) + "</span> " + esc(p.title) + "</li>").join("") + "</ol></nav>" : "") +
      '<p class="plan-brand-lines">' + esc([b.footer, b.contact].filter(Boolean).join(" · ")) + "</p></header>";
    // A part whose first section is landscape: the part heading goes on that landscape page with it, rather than
    // alone on a portrait page before it (the switch of page orientation forces a break).
    const body = parts.map((p, i) => {
      const nodes = (p.nodes || []).filter(shown), h2 = '<h2><span class="plan-num">' + (i + 1) + "</span> " + esc(p.title) + "</h2>";
      const landscapeFirst = nodes.length && print(nodes[0]).orientation === "landscape" && print(p).orientation !== "landscape";
      const html = nodes.map((n, k) => nodeHtml(n, 3, null, k === 0)).join("");
      return '<section class="plan-part" id="' + id(p.key) + '" data-part="' + esc(p.key) + '"' + attrs(p) + (landscapeFirst ? ' data-heading="with-first"' : "") + ">" +
        (landscapeFirst ? html.replace(/^(<section [^>]*>)/, "$1" + h2) : h2 + html) + "</section>";
    }).join("");
    return '<article class="plan-doc" data-family="' + esc(definition.family) + '" data-version="' + esc(definition.version) + '" style="--plan-accent:' + b.accent + '" lang="en-NZ">' +
      running + cover + body + "</article>";
  }

  return { render, checkBrand, contrast, valuesFromPlanDocument, formatDate, formatNumber, BrandError, TO_COMPLETE, AA };
});
