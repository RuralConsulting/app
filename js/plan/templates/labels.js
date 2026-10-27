(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else (root.FP.plan = root.FP.plan || {}).labels = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  // APP-STRUCTURE §4.2 "Labels, not keys": the plan reader shows these words, never the database keys.
  // Plain New Zealand farm-advisor English. Data only, so a different template (FWFP) can supply its own tables
  // through create(). A new fact type, enum value or section key needs a row here; tests/app/labels.test.cjs
  // reads the migrations and fails if one is missing. Unknown keys still get a humanised fallback, never a throw.

  const factTypes = {
    // physical / area
    farm_area: "Total farm area", effective_area: "Effective area", irrigated_area: "Irrigated area",
    leased_area: "Leased area", tree_scrub_area: "Tree and scrub area", winter_grazing_area: "Intensive winter grazing area",
    crop_area: "Crop area", stated_area: "Land unit area stated in the plan", soil_area: "Area by soil",
    land_unit_count: "Number of land units",
    // season inputs and stock
    synthetic_n_pasture: "Synthetic nitrogen on pasture", synthetic_n_crop: "Synthetic nitrogen on crops",
    synthetic_p_pasture: "Synthetic phosphorus on pasture", synthetic_p_crop: "Synthetic phosphorus on crops",
    stock_units: "Stock units", stock_numbers: "Stock numbers",
    // modelled nutrient results
    n_loss_total: "Nitrogen loss to water (total)", n_loss_per_ha: "Nitrogen loss to water per hectare",
    n_surplus: "Nitrogen surplus", nce: "Nitrogen conversion efficiency",
    p_loss_total: "Phosphorus loss to water (total)", p_loss_per_ha: "Phosphorus loss to water per hectare",
    p_surplus: "Phosphorus surplus", drainage: "Drainage", n_concentration: "Nitrogen concentration in drainage",
    // greenhouse gases
    ghg_methane: "Biogenic methane", ghg_n2o: "Nitrous oxide", ghg_co2: "Carbon dioxide", ghg_total: "Total greenhouse gas emissions",
    // land and soil
    luc_class: "Land use capability class", soil_type: "Soil type", land_use: "Land use",
    // assessments
    inherent_vulnerability: "Inherent vulnerability", overall_risk_significance: "Overall risk significance",
    // water
    well_count: "Number of wells", water_take_rate: "Water take rate", mapped_wetland_count: "Mapped wetlands",
  };

  // items[factType][item]
  const items = {
    stock_units: {
      sheep: "Sheep stock units", cattle: "Cattle stock units", beef: "Beef stock units", dairy: "Dairy stock units",
      deer: "Deer stock units", dairy_grazing: "Dairy grazing stock units (not owned)", total_owned: "Total owned stock units",
    },
    inherent_vulnerability: {
      waterlogging: "Waterlogging", p_sediment_runoff: "P and sediment runoff", n_leaching: "N leaching", structural: "Structural vulnerability",
    },
    stock_numbers: { dairy_cows_wintering: "Dairy cows wintering" },
    crop_area: { lucerne: "Lucerne", kale: "Kale" },
  };

  const managementAreas = {
    land_soil: "Land and soil management", waterways_wetlands: "Waterways and wetland management",
    nutrients: "Nutrient management", point_sources: "Point source management", irrigation: "Irrigation management",
    effluent: "Effluent management", water_use: "Water use management", biodiversity: "Biodiversity management",
    cultural_heritage: "Cultural heritage management", biosecurity: "Biosecurity management",
  };

  const sections = {
    // the reader's contents (same words as fep_canterbury.js, without the numbering)
    front: "Plan details", summary: "Plan summary", story: "Farm story", property: "Property details",
    stock: "Land use and stock details", units: "Land units and inherent vulnerabilities", actions: "Action plan",
    areas: "Farming activities, risks and actions", register: "Authorisations and how this plan meets them",
    cccv: "Catchment context, challenges and values", "risk-grid": "Assessing the significance of risks to freshwater",
    maps: "Maps in support of the risk assessment", mahinga: "Mahinga kai", sources: "Sources and evidence",
    // prose section keys (plan_sections.section_key)
    vision: "Vision", farm_story: "Farm story", consents_none: "No consents held", action_overview: "Action plan overview",
    location_map: "Location map", "cccv.fmu": "Freshwater management unit", "cccv.zone": "Zone committee outcomes",
    "cccv.objectives": "Regional plan objectives", "cccv.tangata_whenua": "Tangata whenua values",
    "cccv.contaminants": "Contaminants of concern", mahinga_kai: "Mahinga kai", "mahinga_kai.actions": "Mahinga kai actions",
  };
  for (const k of Object.keys(managementAreas)) sections["area." + k + ".description"] = managementAreas[k] + " description";

  const enums = {
    author_kind: { system: "Written by the system", advisor: "Advisor", farmer: "Farmer" },
    risk_rating: { minor: "Minor", moderate: "Moderate", major: "Major", not_applicable: "Not applicable" },
    action_category: { regulated: "Regulatory", catchment: "Catchment", supplementary: "Supplementary" },
    action_status: { planned: "Planned", in_progress: "In progress", done: "Done", not_doing: "Not doing", possible: "Possible" },
    obligation_kind: { limit: "Limit", date: "Date", reporting: "Reporting", practice: "Practice", plan_content: "Plan content" },
    pathway: { runoff: "Runoff", leaching: "Leaching", critical_source_area: "Critical source area", drain: "Drain", direct: "Direct to water", other: "Other" },
    epistemic_class: { observation: "Observation", interpretation: "Interpretation", designation: "Designation", assessment: "Assessment" },
    fact_method: {
      authoritative_source: "Authoritative source", document: "Read from a document", ai_extraction: "AI extraction",
      calculated: "Calculated", entered: "Entered by hand",
    },
    plan_status: { draft: "Draft", in_review: "In review", signed_off: "Signed off", superseded: "Superseded" },
    plan_kind: { fep: "Farm Environment Plan", fwfp: "Freshwater Farm Plan", nzfap: "NZ Farm Assurance Programme (NZFAP+)", audit_pack: "Audit pack" },
    authorisation_kind: { permitted_rule: "Permitted activity rule", consent: "Resource consent", national_regulation: "National regulation" },
    check_status: {
      met: "Met", on_track: "On track", worth_checking: "Worth checking", gap: "Gap", not_applicable: "Not applicable", cant_tell_yet: "We can't tell yet",
    },
  };

  // Units as printed after a number. Most are already readable; the table makes each one a deliberate choice.
  const units = {
    ha: "ha", "kg N/ha/yr": "kg N/ha/yr", "kg N/yr": "kg N/yr", "kg P/ha/yr": "kg P/ha/yr", "kg P/yr": "kg P/yr",
    RSU: "RSU", SU: "SU", "%": "%", "mm/yr": "mm/yr", ppm: "ppm", "t CO2e/yr": "t CO2e/yr",
    head: "head", wells: "wells", "L/s": "L/s", count: "",
  };

  function humanise(key) {
    if (key == null) return "";
    const s = String(key).replace(/_+/g, " ").trim();
    return s ? s[0].toUpperCase() + s.slice(1) : "";
  }
  const has = (o, k) => o != null && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

  function create(overrides) {
    const o = overrides || {};
    const nested = (base, over) => ({ ...base, ...Object.fromEntries(Object.entries(over || {}).map(([k, v]) => [k, { ...base[k], ...v }])) });
    const t = {
      factTypes: { ...factTypes, ...o.factTypes },
      items: nested(items, o.items),
      managementAreas: { ...managementAreas, ...o.managementAreas },
      sections: { ...sections, ...o.sections },
      enums: nested(enums, o.enums),
      units: { ...units, ...o.units },
    };
    return {
      ...t,
      factType: (key) => (has(t.factTypes, key) ? t.factTypes[key] : humanise(key)),
      item: (factType, item) => (has(t.items, factType) && has(t.items[factType], item) ? t.items[factType][item] : humanise(item)),
      section(key) {
        if (has(t.sections, key)) return t.sections[key];
        const m = typeof key === "string" && /^area\.([^.]+)\.description$/.exec(key);
        return m ? (has(t.managementAreas, m[1]) ? t.managementAreas[m[1]] : humanise(m[1])) + " description" : humanise(key);
      },
      managementArea: (key) => (has(t.managementAreas, key) ? t.managementAreas[key] : humanise(key)),
      enumLabel: (name, value) => (has(t.enums, name) && has(t.enums[name], value) ? t.enums[name][value] : humanise(value)),
      unit: (u) => (has(t.units, u) ? t.units[u] : u == null ? "" : String(u).includes("_") ? humanise(u) : String(u)),
    };
  }
  return { ...create(), create, humanise };
});
