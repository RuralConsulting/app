// Public settings. The publishable key is designed to be public: the database's row-level security decides
// what anyone signed in can see (only their own farms). NEVER put a secret (sb_secret_...) key here.
window.FP_CONFIG = {
  supabaseUrl: "https://swbpymacxycbmdbexnuw.supabase.co",
  supabaseKey: "sb_publishable_ezMJPCuTFBl3wQAVeOJPXg_BoXxVY8A",
  // A LINZ Basemaps API key (basemaps.linz.govt.nz) switches the backgrounds to LINZ aerial imagery and topo
  // maps. Browser keys are public. Without one, the app falls back to Esri's imagery and topo maps.
  linzKey: "",
  photoLinkSeconds: 3600,
};
