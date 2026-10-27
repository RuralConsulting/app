// PDM -> HTML only. No DOM, clock, network, or independent choice of facts.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./provenance.js") : root.FP.plan.provenance,
    node ? require("./value.js") : root.FP.plan.value, node ? require("./markdown.js") : root.FP.plan.markdown,
    node ? require("./templates/fep_canterbury.js") : root.FP.plan.template);
  if (node) module.exports = api; else Object.assign(root.FP.plan, api);
})(typeof window === "undefined" ? globalThis : window, function (P, V, M, defaultTemplate) {
  const { esc, date, person, source } = P;
  const arr = (a) => a || [];
  const table = (heads, rows) => '<div class="table-scroll"><table><thead><tr>' + heads.map((h) => "<th scope='col'>" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
  const list = (items) => items.length ? "<ul>" + items.map((s) => "<li>" + s + "</li>").join("") + "</ul>" : "";
  const display = (s) => esc(s == null ? "" : typeof s === "object" ? JSON.stringify(s) : s);
  function renderPlan(pdm, template = defaultTemplate) {
    if (!pdm || pdm.pdm_schema_version !== 1) throw new Error("Plan document unavailable or unsupported");
    if (pdm.template !== template.key || Number(pdm.template_version) !== Number(template.version)) throw new Error("Plan template version is not supported");
    const plan = pdm.plan, sections = pdm.sections || {}, units = arr(pdm.land_units), risks = arr(pdm.risks), activities = arr(pdm.activities);
    const programme = arr(pdm.actions?.programme).filter((a) => !["possible", "not_doing"].includes(a.status));
    const possible = arr(pdm.actions?.possible), checks = arr(pdm.checks).filter((c) => !c.superseded_at), auths = arr(pdm.authorisations);
    const frozen = ["signed_off", "superseded"].includes(plan.status);
    const usedCodes = new Set(programme.map((a) => a.map_code).filter(Boolean)); let nextCode = 1;
    // Normally assigned by plan_document. The fallback is deterministic for older fixture PDMs.
    const actions = programme.map((a) => {
      if (a.map_code) return a;
      while (usedCodes.has("A" + nextCode)) nextCode++;
      const code = "A" + nextCode++; usedCodes.add(code); return { ...a, map_code: code };
    });
    const audit = [], issues = [], missing = (ctx, label) => V.render(null, ctx, label);
    const value = (ctx, v, label, required) => { audit.push({ label, state: v?.state || "not_recorded" }); return V.render(v, ctx, label, required); };
    const fact = (ctx, key, item) => value(ctx, V.fact(pdm, key, item), key.replaceAll("_", " "));
    const record = (ctx, text, label, origin = {}) => value(ctx, text == null || text === "" ? null : { state: "recorded", text: String(text), ...origin }, label);
    const calculated = (ctx, n, unit, formula, inputs, label) => value(ctx, V.calculated(n, unit, formula, inputs), label);
    function prose(ctx, key, required = true) {
      const s = sections[key] || {};
      let html;
      if (s.state === "not_applicable") {
        html = value(ctx, { state: "not_applicable", na_reason: s.na_reason, assessed_by: person(s.written_by), assessed_on: s.updated_at, source: s.source }, key);
        if (!s.na_reason) issues.push(key + ": reason not recorded");
      } else if (!s.body) {
        if (!required) return "";
        html = missing(ctx, key);
      } else {
        html = M.render(s.body, ctx);
        html += '<p class="prose-credit">' + esc(s.state === "draft" ? "Draft text · " : "") +
          esc((s.author_kind || "author not recorded") + ": " + person(s.written_by)) + ", " + esc(date(s.updated_at)) +
          ctx.marker({ source: s.source, method: s.ai_model ? "AI draft: " + s.ai_model + " " + s.ai_model_version : "authored prose" }) + "</p>";
        if (s.state !== "written") issues.push(key + ": text needs a person to save it as written");
      }
      if (/^(cccv\.|mahinga_kai$)/.test(key) && !s.sources?.length) { issues.push(key + ": Source not recorded"); if (ctx.advisor) html += '<p class="value-box">Source not recorded</p>'; }
      html += list(arr(s.sources).map(source));
      if (ctx.advisor) {
        const literals = M.lint(s.body); if (literals.length) html += '<aside class="number-lint advisor-only">Check numbers in prose: ' + literals.map(esc).join(", ") + "</aside>";
      }
      if (!frozen) html += '<button type="button" class="edit-prose screen-only" data-edit-section="' + esc(key) + '">Edit text</button>';
      return '<div class="plan-prose" data-section-key="' + esc(key) + '">' + html + "</div>";
    }
    function check(ctx, c) {
      if (!c || c.superseded_at) return "";
      const words = { met: "Met", on_track: "On track", worth_checking: "Worth checking", gap: "Gap", not_applicable: "Not applicable", cant_tell_yet: "We can't tell yet" };
      // Defence in depth for imported/old snapshots; system never asserts a gap.
      const status = c.status === "gap" && c.author_kind !== "advisor" ? "worth_checking" : c.status;
      let author = c.author_kind === "system" ? "system check, " + (c.rule_module || "module not recorded") + " v" + (c.rule_version || "?") +
        (c.confirmed_by ? ", confirmed by " + person(c.confirmation) + ", " + date(c.confirmation?.at || c.confirmed_at) : ", not yet confirmed by an advisor") :
        (c.author_kind || "author not recorded") + ": " + person(c.author) + ", " + date(c.created_at);
      if (c.author_kind !== "advisor" && !(c.author_kind === "system" && c.confirmed_by)) issues.push("Check " + c.id + ": advisor confirmation needed");
      if (c.inputs?.threshold_to_confirm) issues.push("Check " + c.id + ": threshold to be confirmed");
      return '<div class="plan-check"><b>' + esc(words[status] || "We can't tell yet") + "</b> — " + esc(author) +
        (c.inputs?.threshold_to_confirm ? ' <strong>threshold to be confirmed</strong>' : "") +
        '<p>' + esc(c.explanation || "Explanation not recorded") + "</p>" +
        (c.inputs ? '<details class="screen-only"><summary>Inputs used by this check</summary>' + record(ctx, JSON.stringify(c.inputs), "Check inputs", { method: author, source: c.source }) + "</details>" : "") +
        (c.action_ids?.length ? "<p>Linked actions: " + c.action_ids.map((id) => { const a = actions.find((x) => x.id === id); return esc(a ? a.map_code + " " + a.title : id); }).join("; ") + "</p>" : "") + ctx.marker({ source: c.source, method: author }) + "</div>";
    }
    function risk(ctx, r) {
      return record(ctx, (r.rating || "not assessed").replaceAll("_", " "), "Risk rating", {
        class: "assessment", assessed_by: r.assessed_by || person(r.author), assessed_on: r.assessed_on, source: r.source });
    }
    function map(ctx, key, label, present = true) {
      return '<figure class="map-placeholder" data-map-key="' + esc(key) + '"><figcaption>' + esc(label) + '</figcaption>' +
        (present ? '<p>Map preview — <a href="#/farm/' + esc(pdm.farm.id) + '">Open the interactive farm map</a>. Static image follows in PR 4.</p>' : missing(ctx, label)) +
        "<p>LINZ Basemaps CC BY 4.0 · As at " + esc(date(pdm.as_at)) + "</p></figure>";
    }
    function authLabel(a) { return [a.consent_no || a.rule_ref, a.title].filter(Boolean).join(" — "); }
    function actionTable(ctx, rows) {
      return table(["Ref", "Management area", "Farming activity", "Risks", "Land units", "Specific action", "Category", "New or existing", "Implementation timeframe", "Status"], rows.map((a) => {
        const linked = risks.filter((r) => arr(a.risk_ids).includes(r.id));
        const ids = new Set([a.activity_id, ...linked.map((r) => r.activity_id)]);
        const places = arr(a.places), all = units.length && units.every((u) => places.some((p) => p.id === u.id));
        return [esc(a.map_code), esc(template.managementAreas.find((m) => m.key === a.management_area)?.label || a.management_area || "Not yet recorded"),
          activities.filter((b) => ids.has(b.id)).map((b) => esc(b.name)).join(", ") || missing(ctx, "Farming activity"),
          linked.map((r) => esc(r.description)).join("; ") || esc(a.description || ""),
          all ? "All" : places.map((p) => esc(p.code || p.name)).join(", ") || missing(ctx, "Action location"),
          record(ctx, a.title, "Action", { source: a.source }) + "<p>" + esc(a.description) + "</p>",
          esc(template.boilerplate.categories[a.category] || "Not yet recorded"),
          a.is_existing == null ? missing(ctx, "New or existing") : a.is_existing ? "Existing" : "New",
          record(ctx, a.due_date ? date(a.due_date) : a.timeframe_text, "Implementation timeframe", { source: a.source }),
          esc(a.status.replaceAll("_", " ")) + (a.completed_on ? " · " + esc(date(a.completed_on)) : "") + " · " + record(ctx, a.evidence_count ?? 0, "Evidence count", { method: "count(linked evidence)" }) + " evidence"];
      }));
    }
    const renderers = {
      front(ctx) {
        const forAuth = auths.find((a) => a.id === plan.for_authorisation_id);
        return '<h1>Farm Environment Plan</h1><p class="cover-farm">' + esc(pdm.farm.name) + "</p>" +
          table(["Plan detail", "Recorded value"], [
            ["Developer", record(ctx, plan.prepared_by_name, "Plan developer")],
            ["Role / organisation", esc([plan.prepared_by_role, plan.prepared_by_org].filter(Boolean).join(", "))],
            ["Date", record(ctx, plan.plan_date && date(plan.plan_date), "Plan date")],
            ["Version", record(ctx, plan.version_label, "Version")],
            ["Supersedes", esc(plan.supersedes_plan_id || "No earlier version recorded")],
            ["Prepared for", forAuth ? esc(authLabel(forAuth)) : missing(ctx, "Prepared for")],
            ["Signed off", plan.signed_off_at ? esc(person(plan.signer || { user_id: plan.signed_off_by }) + ", " + date(plan.signed_off_at)) : "Not signed off"],
          ]) + "<p>" + esc(template.boilerplate.copyright.text) + " <small>" + esc(template.boilerplate.copyright.citation) + "</small></p>";
      },
      summary(ctx) {
        const next = [...actions].sort((a, b) => Number(!!(b.meets_condition && b.reduces_risk)) - Number(!!(a.meets_condition && a.reduces_risk)) || (a.due_date || "9999").localeCompare(b.due_date || "9999") || a.id.localeCompare(b.id)).slice(0, 3);
        let html = prose(ctx, "summary") + "<h3>Generational vision</h3>" + prose(ctx, "vision") + "<h3>At a glance</h3>" +
          "<p>" + value(ctx, pdm.land_unit_count, "Land unit count") + " land units · Overall risk significance: " + fact(ctx, "overall_risk_significance") + "</p>";
        const counted = (key, existing) => actions.filter((a) => a.category === key && a.is_existing === existing).map((a) => ({ state: "recorded", text: a.map_code + " " + a.title, source: a.source }));
        html += table(["Action category", "New", "Existing"], Object.entries(template.boilerplate.categories).map(([key, label]) => [esc(label),
          calculated(ctx, counted(key, false).length, null, "count(new programme actions in category)", counted(key, false), "New actions"),
          calculated(ctx, counted(key, true).length, null, "count(existing programme actions in category)", counted(key, true), "Existing actions")]));
        html += "<h3>Next actions</h3>" + list(next.map((a) => esc(a.map_code + " " + a.title) + " · " + esc(a.due_date ? date(a.due_date) : a.timeframe_text || "Not yet recorded")));
        for (const a of auths.filter((a) => a.period_state === "current")) {
          const cs = checks.filter((c) => c.authorisation_id === a.id); html += "<h3>" + esc(authLabel(a)) + "</h3>" + (cs.map((c) => check(ctx, c)).join("") || missing(ctx, "Current authorisation check"));
        }
        if (checks.length && !checks.some((c) => ["worth_checking", "gap", "cant_tell_yet"].includes(c.status))) html += "<p>The recorded checks identify no further checking: " + esc(checks.map((c) => person(c.author) + ", " + date(c.created_at)).join("; ")) + ".</p>";
        return html;
      },
      story(ctx) { return prose(ctx, "farm_story") + (sections.location_map?.body ? map(ctx, "location", "Property location") : ""); },
      property(ctx) {
        const d = pdm.farm.details || {}, current = auths.filter((a) => a.kind === "consent" && a.period_state === "current");
        return table(["Property detail", "Recorded value"], [
          ["Property name", esc(pdm.farm.name)], ["Property address", record(ctx, d.address, "Property address")],
          ["Owner / farm operator", record(ctx, d.operator_names, "Owner / farm operator", { note: arr(pdm.titles).map((t) => display(t.owners)).join("; ") })],
          ["Contact details", d.contacts?.length ? list(d.contacts.map((c) => esc([c.name, c.role, c.phone, c.email].filter(Boolean).join(" · ")))) : missing(ctx, "Contact details")],
          ...(d.nzbn ? [["NZBN", record(ctx, d.nzbn, "NZBN")]] : []),
          ["Legal description: owned", list(arr(pdm.titles).map((t) => record(ctx, [t.title_no, t.estate_description].filter(Boolean).join(" — "), "Title", { class: "designation", shown_as: "under LINZ records of title", source: { provider: t.source, title_no: t.title_no, valid_from: t.valid_from } }))) || missing(ctx, "Owned titles")],
          ["Legal description: leased", list(arr(pdm.leases).map((l) => record(ctx, [l.name, l.description].filter(Boolean).join(" — "), "Lease", { source: l.source }))) || missing(ctx, "Lease details")],
          ["Total farm (ha), titles", fact(ctx, "farm_area")], ["Area covered by this plan (ha)", value(ctx, pdm.extent_ha, "Plan coverage")],
          ["Effective area (ha)", fact(ctx, "effective_area")],
          ["Leased area (ha)", V.fact(pdm, "leased_area").state !== "not_recorded" ? fact(ctx, "leased_area") : value(ctx, V.calculated(arr(pdm.extent_ha?.calc?.inputs).some((i) => i.kind === "lease") ? pdm.extent_ha.calc.inputs.filter((i) => i.kind === "lease").reduce((n, i) => n + Number(i.v), 0) : null, "ha", "sum(current lease geometry areas)", arr(pdm.extent_ha?.calc?.inputs).filter((i) => i.kind === "lease")), "Leased area")],
          ["Current resource consents", current.length ? list(current.filter((a) => a.holder_is_farm).map((a) => esc(authLabel(a) + " · " + (a.status || "")))) +
            (current.some((a) => !a.holder_is_farm) ? "<p>Held by others for this farm</p>" + list(current.filter((a) => !a.holder_is_farm).map((a) => esc(authLabel(a)))) : "") : prose(ctx, "consents_none")],
        ]);
      },
      stock(ctx) {
        const stocks = arr(pdm.values).filter((v) => v.fact_type === "stock_units" && !v.place_id && v.item);
        const owned = stocks.filter((v) => !template.notOwned.includes(v.item));
        const valid = owned.length && owned.every((v) => v.state === "recorded" && v.v != null && v.class === "observation");
        const total = valid ? owned.reduce((sum, v) => sum + Number(v.v), 0) : null;
        const effective = V.fact(pdm, "effective_area"), sheep = V.fact(pdm, "stock_units", "sheep"), cattle = V.fact(pdm, "stock_units", "cattle");
        const rows = [["Land use", fact(ctx, "land_use")], ["Grazable ha", fact(ctx, "effective_area")], ["Winter cropping", fact(ctx, "winter_grazing_area")],
          ...stocks.map((v) => [esc(v.item), value(ctx, v, v.item) + (v.note ? "<p>" + esc(v.note) + "</p>" : "")]),
          ["Total owned stock units", calculated(ctx, total, "SU", "sum(owned enterprise stock units; excludes dairy grazing)", owned, "Total owned stock units")],
          ["Sheep:cattle ratio", sheep.state === "recorded" && cattle.state === "recorded" && total > 0 ? calculated(ctx, Number(sheep.v) / (Number(sheep.v) + Number(cattle.v)) * 100, "% sheep", "sheep SU / (sheep SU + cattle SU) × 100; cattle = 100 − sheep", [sheep, cattle], "Sheep:cattle ratio") : missing(ctx, "Sheep:cattle ratio")],
          ["Stock units / grazable ha", calculated(ctx, total != null && effective.state === "recorded" && Number(effective.v) > 0 ? total / Number(effective.v) : null, "SU/ha", "owned SU / effective ha", [...owned, effective], "Stock units / grazable ha")]];
        if (!stocks.length) rows.push(["Stock units by enterprise", missing(ctx, "Stock units")]);
        const stated = V.fact(pdm, "stock_units");
        if (ctx.advisor && stated.state === "recorded" && total != null && Number(stated.v) !== total) rows.push(["Stated total differs (advisor)", value(ctx, stated, "Stated total")]);
        return table(["Land use / stock", "Recorded value"], rows);
      },
      units(ctx) {
        let html = prose(ctx, "land_unit_definitions", false) || missing(ctx, "Cited land-unit definitions (Cairnvale FEP p7)");
        html += "<p>" + value(ctx, pdm.land_unit_count, "Land unit count") + " land units were identified.</p>";
        if (!units.length) return html + missing(ctx, "Land units");
        html += table(["Land unit", "Area (ha)", "Description", "Inherent vulnerabilities", "Soils"], units.map((u) => [
          esc(u.code + " " + u.name), value(ctx, u.area_ha, "Mapped area") + '<details class="screen-only"><summary>Area stated in source plan</summary>' + value(ctx, u.stated_area, "Stated area", false) + "</details>",
          esc(u.description), list(template.vulnerabilities.map(([key, label]) => esc(label) + ": " + (u.vulnerabilities?.[key]?.state === "not_recorded" ? '<span class="value-box">Not yet assessed</span>' + value(ctx, u.vulnerabilities[key], label) : value(ctx, u.vulnerabilities?.[key], label)))),
          list(arr(pdm.soils).filter((s) => s.place_id === u.id).map((s) => esc(s.sibling) + " " + value(ctx, s.area, "Soil area") + " " + arr(s.fact_sheets).map(source).join("; "))) || "No soil facts recorded for this unit",
        ]));
        html += list(units.map((u) => esc(u.code + ": " + [u.method, u.shown_as, u.layer].filter(Boolean).join(" · ")) + ctx.marker({ source: u.source, method: u.method, shown_as: u.shown_as })));
        return html + "<h3>2.1 Land unit map</h3>" + map(ctx, "land-units", "Land units", !!pdm.extent);
      },
      actions(ctx) {
        return "<h3>3.1 Overview</h3>" + (prose(ctx, "action_method", false) || missing(ctx, "Cited action-plan overview (Cairnvale FEP p11)")) +
          prose(ctx, "action_overview", false) + "<h3>3.2 Five-year action programme</h3>" +
          (actions.length ? actionTable(ctx, actions) : '<p class="value-box">No actions recorded</p>') +
          (prose(ctx, "action_categories", false) || missing(ctx, "Cited category definitions (Cairnvale FEP p12)")) +
          (ctx.advisor && pdm.actions?.not_doing?.length ? '<aside class="advisor-only"><h3>Not doing</h3>' + list(pdm.actions.not_doing.map((a) => esc(a.title))) + "</aside>" : "") +
          "<h3>3.3 Action plan map</h3>" + map(ctx, "actions", "Action plan", !!pdm.extent) +
          "<p>Not mapped: " + esc(actions.filter((a) => !a.geom && !arr(a.places).some((p) => p.geom)).map((a) => a.map_code).join(", ") || "None") + "</p>" +
          list(actions.map((a) => esc(a.map_code + " — " + a.title)));
      },
      areas(ctx) {
        let html = "<h3>4.1 Introduction</h3>" + (prose(ctx, "management_introduction", false) || missing(ctx, "Cited management introduction (Cairnvale FEP p16)"));
        template.managementAreas.forEach((area, index) => {
          const rs = risks.filter((r) => r.management_area === area.key), as = actions.filter((a) => a.management_area === area.key), ps = possible.filter((a) => a.management_area === area.key);
          const ids = new Set([...rs.map((r) => r.activity_id), ...as.map((a) => a.activity_id), ...ps.map((a) => a.activity_id)]);
          const acts = activities.filter((a) => ids.has(a.id) || area.kinds.includes(a.kind));
          const irrigation = area.key === "irrigation" && (acts.length || auths.some((a) => a.consent_type === "water_permit" || /water permit/i.test(a.consent_type || "")));
          const present = area.core || irrigation || rs.length || as.length || ps.length || sections["area." + area.key + ".description"]?.body || sections["area." + area.key + ".description"]?.state === "not_applicable";
          if (!present) { issues.push("Optional area not recorded: " + area.label); return; }
          const label = area.key === "nutrients" && arr(pdm.values).some((v) => v.fact_type?.startsWith("ghg_") && v.state !== "not_recorded") ? "Nutrient and emissions management" : area.label;
          html += '<section class="management-area"><h3>4.' + (index + 2) + " " + esc(label) + "</h3>" + list(acts.map((a) => esc(a.name))) +
            prose(ctx, "area." + area.key + ".description", !!area.core || !!irrigation) + list(acts.map((a) => esc(a.description))) +
            "<h4>Significance of risks to freshwater</h4><p>" + esc(template.boilerplate.riskMethod.text) + " <small>" + esc(template.boilerplate.riskMethod.citation) + "</small></p>";
          const labels = [...new Set(rs.map((r) => r.description))];
          html += labels.length ? table(["Risk", ...units.map((u) => u.code)], labels.map((label) => [esc(label), ...units.map((u) => {
            const matches = rs.filter((r) => r.description === label && r.place_id === u.id);
            return matches.length ? matches.map((r) => risk(ctx, r)).join("<br>") : '<span class="value-box">not assessed</span>';
          })])) : missing(ctx, "Attributed risk assessments");
          html += "<h4>Actions included in this plan, and justification</h4>" + table(["Action", "Justification"], as.map((a) => [esc(a.map_code + " " + a.title), record(ctx, a.rationale, "Action rationale", { source: a.source })]));
          if (ps.length) html += "<h4>Possible future actions</h4>" + list(ps.map((a) => record(ctx, a.title, "Possible action", { source: a.source }) + " " + esc(a.description)));
          // Require a complete unit grid as well as minor/N/A ratings; absence is not a decision.
          if (labels.length && labels.every((label) => units.length && units.every((u) => rs.some((r) => r.description === label && r.place_id === u.id))) &&
              rs.every((r) => ["minor", "not_applicable"].includes(r.rating) && r.assessed_by && r.assessed_on) && !as.some((a) => !a.is_existing) && !ps.length) {
            html += "<p>All risks in this area are assessed minor or not applicable (" + esc([...new Set(rs.map((r) => r.assessed_by + ", " + date(r.assessed_on)))].join("; ")) + ") and no new actions are proposed: keep the existing practices above.</p>";
          }
          if (area.key === "nutrients") html += nutrients(ctx);
          if (area.key === "irrigation") html += "<h4>Irrigated area</h4>" + fact(ctx, "irrigated_area") + list(auths.filter((a) => /water/i.test(a.consent_type || "")).map((a) => esc(authLabel(a)) + list(arr(a.obligations).map((o) => esc(o.summary) + " " + source(o.source)))));
          if (["irrigation", "waterways_wetlands"].includes(area.key)) {
            const themes = area.key === "irrigation" ? ["wells"] : ["wetlands", "waterways"];
            const refs = arr(pdm.maps?.reference).filter((r) => themes.includes(r.theme));
            html += list(refs.map((r) => esc(r.name) + " · " + esc(r.attribution) + list(arr(r.features?.features).map((f) =>
              record(ctx, f.properties?.external_id || f.properties?.name || r.name, "Farm reference feature", { shown_as: r.shown_as, source: { title: r.name, provider: r.attribution } }) +
              list(arr(f.properties?.authorisations).map((a) => esc(a.consent_no || a.title)))))));
          }
          html += "</section>";
        });
        return html;
      },
      register(ctx) {
        if (!auths.length) return missing(ctx, "Authorisations register");
        const groups = new Map();
        for (const a of auths) {
          const kinds = [...new Set(activities.filter((b) => arr(a.activity_ids).includes(b.id)).map((b) => b.kind))].sort();
          const key = kinds.join(", ") || "Activity not recorded"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(a);
        }
        let html = "";
        for (const [key, group] of groups) {
          html += "<h3>" + esc(key.replaceAll("_", " ")) + "</h3>";
          for (const a of [...group].sort((a, b) => ["current", "future", "history"].indexOf(a.period_state) - ["current", "future", "history"].indexOf(b.period_state) || (a.valid_from || "").localeCompare(b.valid_from || "") || a.id.localeCompare(b.id))) {
            html += '<article class="authorisation ' + esc(a.period_state) + '"><h4>' + esc(authLabel(a)) + "</h4><p>" +
              esc(({ permitted_rule: "Permitted activity rule", consent: "Resource consent", national_regulation: "National regulation" })[a.kind] || a.kind) + " · " +
              esc(a.holder || "Holder not recorded") + (a.holder_is_farm === false ? " (held by others for this farm)" : "") + "</p><p>" +
              (a.period_state === "history" ? "History · Until " + esc(date(a.valid_to)) : a.period_state === "future" ? "Future · From " + esc(date(a.valid_from)) :
                (a.valid_from ? esc(date(a.valid_from)) : "start date not yet recorded") + " – " + (a.valid_to ? esc(date(a.valid_to)) : "current")) +
              "</p><p>Status as published: " + esc(a.status || "Not yet recorded") + "</p>" + source(a.source);
            for (const o of arr(a.obligations)) {
              html += "<div class='obligation'><h5>" + esc([o.code, o.summary].filter(Boolean).join(" — ")) + "</h5><p>" + esc(o.kind) + " · " + esc(o.due_date ? date(o.due_date) : o.recurrence) + "</p>";
              html += o.parameters ? record(ctx, JSON.stringify(o.parameters), "Obligation parameters", { class: "designation", shown_as: "under " + authLabel(a), source: o.source }) : "";
              html += source(o.source);
              if (o.full_text) html += '<details class="obligation-text ' + (template.printFullText.includes(o.kind) ? "print-expanded" : "screen-only") + '"><summary>Full condition text</summary><blockquote>' + esc(o.full_text) + "</blockquote></details>";
              html += arr(o.checks).filter((c) => !c.superseded_at).map((c) => check(ctx, c)).join("") || missing(ctx, "Obligation check");
              html += "</div>";
            }
            html += arr(a.checks).filter((c) => !c.superseded_at).map((c) => check(ctx, c)).join("") + "</article>";
          }
        }
        return html;
      },
      cccv(ctx) {
        return ["fmu", "zone", "objectives", "tangata_whenua", "contaminants"].map((key) => "<h3>" + esc(key.replaceAll("_", " ")) + "</h3>" +
          (["objectives", "tangata_whenua"].includes(key) ? "<blockquote>" + prose(ctx, "cccv." + key) + "</blockquote>" : prose(ctx, "cccv." + key))).join("") +
          "<h3>Receptors reached through the farm's risks</h3>" + (arr(pdm.receptors).length ? table(["Receptor", "State", "Contaminants / values", "Source / date"], pdm.receptors.map((r) => [
            esc(r.name), record(ctx, r.state, "Receptor state", { source: typeof r.source === "object" ? r.source : { title: r.source }, as_at: r.as_at }),
            display(r.contaminants_of_concern) + " / " + display(r.receptor_values), display(r.source) + " · " + esc(date(r.as_at)),
          ])) : missing(ctx, "Receptor information"));
      },
      "risk-grid"(ctx) {
        const labels = [...new Set(risks.map((r) => r.description))];
        return (prose(ctx, "risk_method", false) || missing(ctx, "Cited risk method and vulnerability × intensity matrix (Cairnvale FEP pp28–29)")) +
          table(["Management area / risk", ...units.map((u) => u.code)], template.managementAreas.flatMap((area) =>
            labels.filter((label) => risks.some((r) => r.management_area === area.key && r.description === label)).map((label) => [esc(area.label + " / " + label), ...units.map((u) => {
              const rs = risks.filter((r) => r.management_area === area.key && r.description === label && r.place_id === u.id);
              return rs.length ? rs.map((r) => '<span class="rating rating-' + esc(r.rating) + '">' + risk(ctx, r) + "</span>" +
                (arr(pdm.receptors).some((x) => x.id === r.receptor_id && Number(x.significance) >= 4) ? " · drains to a degraded receptor" : "")).join("<br>") : '<span class="value-box">not assessed</span>';
            })])));
      },
      maps(ctx) {
        const smap = arr(pdm.reference_sources).find((s) => s.key === "smap");
        const layers = arr(pdm.maps?.layers).filter((l) => l.theme !== "soils" && l.key !== "smap");
        return map(ctx, "features", "Farm features", !!pdm.extent) + "<h3>Soils</h3>" + table(["Sibling", "Area", "Fact sheets"], arr(pdm.soils).map((s) => [esc(s.sibling), value(ctx, s.area, "Soil area"), arr(s.fact_sheets).map(source).join("; ")])) +
          (smap?.serve_to_customers ? '<p>Soil fact sheets shown; polygon preview follows in PR 4.</p>' : '<p>Soil polygons not shown: S-map licence check pending</p>') +
          ["slope", "regulatory_low_slope", "elevation", ...(layers.some((l) => l.theme === "aspect") ? ["aspect"] : [])].map((key) => {
            const layer = layers.find((l) => l.theme === key);
            return map(ctx, key, key.replaceAll("_", " "), !!layer) + (layer ? record(ctx, layer.name, "Map layer", { shown_as: layer.shown_as, method: layer.method,
              source: arr(pdm.map_sources).find((s) => s.layer_id === layer.id)?.source }) : "");
          }).join("") +
          list(arr(pdm.reference_sources).map((s) => esc([s.name, s.attribution, s.licence_status, s.refreshed_at && date(s.refreshed_at)].filter(Boolean).join(" · ")))) +
          list(arr(pdm.maps?.layers).map((l) => esc([l.name, l.shown_as].filter(Boolean).join(" · "))));
      },
      mahinga(ctx) { return prose(ctx, "mahinga_kai") + (sections["mahinga_kai.actions"] ? prose(ctx, "mahinga_kai.actions", false) : ""); },
      sources(ctx) {
        return table(["Document", "Details", "Pages"], arr(pdm.documents).map((d) => [source({ ...d, document_id: d.id }), esc([d.doc_type, d.author, d.author_org, d.period_start, d.period_end, d.model, d.model_version, d.status].filter(Boolean).join(" · ")), record(ctx, arr(d.pages).join(", "), "Cited pages", { source: d })])) +
          "<h3>Evidence</h3>" + table(["Kind / date", "Linked action / check", "Source"], arr(pdm.evidence).map((e) => [
            esc(e.kind + " · " + date(e.taken_at)), esc([actions.find((a) => a.id === e.action_id)?.map_code || e.action_id, e.check_id].filter(Boolean).join(" · ")),
            source(e.source) + (e.kind === "photo" && e.source?.storage_path ? '<img class="evidence-photo screen-only" data-photo-path="' + esc(e.source.storage_path) + '" alt="Evidence photo">' : ""),
          ])) + "<h3>AI use</h3><p>" + record(ctx, pdm.ai_use?.checked_fact_count ?? 0, "Checked AI fact count", { method: "count(checked AI facts used in PDM)" }) +
          " AI-extracted facts used, checked by an advisor.</p>" + list(arr(pdm.ai_use?.models).map((m) => esc(m.model + " " + m.model_version + " · checked by " + person(m.checked) + ", " + date(m.checked?.at))));
      },
    };
    function nutrients(ctx) {
      let html = "<h4>Synthetic nitrogen</h4>" + fact(ctx, "synthetic_n_pasture") + checks.filter((c) => c.rule_module === "nesf-n-cap").map((c) => check(ctx, c)).join("");
      for (const g of arr(pdm.nutrient_history)) {
        html += "<h4>" + esc([g.fact_type, g.model, g.model_version].join(" · ")) + "</h4>" +
          table(["Season", "Recorded value"], arr(g.values).map((v) => [esc(v.season), value(ctx, v, g.fact_type)]));
        const vs = arr(g.values).filter((v) => v.state === "recorded" && v.v != null);
        if (vs.some((v) => v.model !== g.model || v.model_version !== g.model_version)) throw new Error("Nutrient comparison across model versions refused");
        if (new Set(vs.map((v) => v.unit)).size > 1) throw new Error("Nutrient comparison across units refused");
        if (vs.length > 1) {
          const a = vs[0], b = vs[vs.length - 1];
          html += "<p>Change within this model version: " + calculated(ctx, Number(b.v) - Number(a.v), b.unit, "latest − earliest (same model and version)", [a, b], "Nutrient change");
          if (Number(a.v) !== 0) html += " · " + calculated(ctx, (Number(b.v) - Number(a.v)) / Number(a.v) * 100, "%", "(latest − earliest) / earliest × 100 (same model and version)", [a, b], "Nutrient percentage change");
          html += "</p>";
        }
      }
      const ghg = arr(pdm.values).filter((v) => (v.fact_type?.startsWith("ghg_") || v.fact_type === "tree_scrub_area") && v.state !== "not_recorded");
      if (ghg.length || actions.some((a) => /ghg/i.test(a.title))) html += "<h4>Greenhouse gases</h4>" + table(["Recorded measure", "Value"], ghg.map((v) => [esc(v.fact_type), value(ctx, v, v.fact_type)]));
      const total = ghg.find((v) => v.fact_type === "ghg_total"), components = ["ghg_methane", "ghg_n2o", "ghg_co2"].map((k) => ghg.find((v) => v.fact_type === k));
      if (ctx.advisor && total?.state === "recorded" && components.every((v) => v?.state === "recorded" && v.unit === total.unit && v.model === total.model && v.model_version === total.model_version && v.season === total.season) &&
          Math.abs(components.reduce((n, v) => n + Number(v.v), 0) - Number(total.v)) > 0.01) html += '<p class="advisor-only flag">Recorded GHG components differ from the total. Check the cited source.</p>';
      return html;
    }
    const parts = template.sections.map(([key, label]) => {
      const ctx = P.context(pdm, key);
      return '<section class="plan-section" id="plan-' + key + '"><h2>' + esc(label) + "</h2>" + renderers[key](ctx) + ctx.sources() + "</section>";
    });
    const completeness = [];
    for (const k of template.requiredProse) if (!["written", "not_applicable"].includes(sections[k]?.state) || (sections[k]?.state === "not_applicable" && !sections[k]?.na_reason)) completeness.push(k + ": required text not ready");
    for (const e of template.requiredElements) if (!["recorded", "not_applicable", "calculated"].includes(V.fact(pdm, e.key).state)) completeness.push(e.label + ": not recorded");
    if (!units.length) completeness.push("Land units not recorded");
    if (!actions.length) completeness.push("Five-year action programme not recorded");
    for (const a of audit) if (["not_recorded", "awaiting_check"].includes(a.state)) completeness.push(a.label + ": " + a.state.replaceAll("_", " "));
    for (const a of auths.filter((a) => a.period_state === "current")) for (const o of arr(a.obligations).filter((o) => o.kind === "plan_content")) completeness.push("Required by " + (a.consent_no || a.title) + " condition " + (o.code || "?") + ": " + o.summary + " — advisor review needed");
    for (const v of arr(pdm.values)) if (v.flagged) completeness.push((v.fact_type || v.fact_id) + ": recorded disagreement needs acknowledgement");
    const panel = pdm.viewer?.is_advisor && !frozen ? '<aside class="completeness screen-only"><h2>Completeness — review list</h2><p>' + esc(template.verification) + '</p><p>Static map images follow in PR 4. This panel is read-only.</p>' +
      list([...new Set([...completeness, ...issues])].map(esc)) + "</aside>" : "";
    return '<article class="farm-plan" data-template="' + esc(template.key) + '"><div class="plan-status">' +
      esc(frozen ? "Signed off " + date(plan.signed_off_at) : plan.status === "in_review" ? "In review – not signed off" : "Draft – not signed off") +
      '</div><nav class="plan-contents" aria-label="Contents"><h2>Contents</h2>' + list(template.sections.map(([key, label]) => '<a href="#plan-' + key + '" data-plan-anchor="plan-' + key + '">' + esc(label) + "</a>")) +
      "</nav>" + panel + parts.join("") + "</article>";
  }
  return { renderPlan };
});
