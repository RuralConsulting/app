// Public settings. The publishable key is designed to be public: the database's row-level security decides
// what anyone signed in can see (only their own farms). NEVER put a secret (sb_secret_...) key here.
window.FP_CONFIG = {
  supabaseUrl: "https://swbpymacxycbmdbexnuw.supabase.co",
  supabaseKey: "sb_publishable_ezMJPCuTFBl3wQAVeOJPXg_BoXxVY8A",

  // LINZ Basemaps API key (basemaps.linz.govt.nz): the aerial background. Browser keys are public by design.
  // A standard key expires after 90 days; a developer key (free, from LINZ) doesn't and can be limited to the
  // app's domain (brand.json): moving domain means updating the key's allowed site at LINZ. With no key the map has a plain background. No other tile provider is used.
  linzKey: "d01m5g152dsk2a73kfxb6a9xf1k",

  // What the farm view shows when it opens (LK4): a view of the layer kind registry (app/layer-kinds.json, docs/LAYER-KINDS.md),
  // "quiet" (E5, Josh 31 Oct): the farm boundary, and Photos, whose pins show only once the map is zoomed in past the farm's
  // frame (FP.photoModel.pinsShown). Every kind whose default rule is on (quiet, or zoom:<z> once zoomed in that far) is on
  // too; everything else comes up by context (farm-space.js sceneFor: the registry's views) or a switch in Layers. The
  // registry, not this file, says what each view holds, the draw order and the defaults.
  farmView: {
    view: "quiet",
    // PERF1b: the reference rows read ahead, one at a time, once the farm is drawn and the map is idle: what the standing
    // answers most often bring up (Rivers, bores, consents, water-quality sites). Every other source is read when
    // something switches it on; the region-wide zone polygons are never read ahead.
    prefetch: ["rivers", "ecan-wells", "ecan-consents", "ecan-wq-sites"],
  },
  // What a catchment group's map opens with (LK4, group-layers.js defaultShow; Josh's ruling): its member blocks and Rivers
  // only, whatever was deferred: every kind on by its default rule (the group's area, the member blocks and member farms) and
  // the kinds named here (`open`: waterways, i.e. Rivers). The rest of the catchment view (zones, monitoring sites) comes up
  // by context or by hand. A large layer (PERF3b, group_map's `deferred`) is read for the map in view when switched on.
  // maxFeatures: more than this in view and the layer asks the person to zoom in. prefetch: the reference sources read ahead
  // once the group is drawn and the map is idle (never a zone polygon).
  groupView: {
    open: ["waterways"],
    maxFeatures: 4000,
    prefetch: ["ecan-wq-sites"],
  },

  photoLinkSeconds: 3600,
};
