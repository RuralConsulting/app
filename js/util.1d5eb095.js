// Small shared helpers.
window.FP = window.FP || {};
FP.$ = (sel, root = document) => root.querySelector(sel);
FP.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
FP.el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
};
FP.show = (id) => {
  for (const s of FP.$$("body > main, #screen-map, #loading")) s.hidden = s.id !== id;
};
FP.ha = (n) => `${Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 1 })} ha`;
FP.href = (hash) => FP.demo?.active ? FP.demo.href(hash) : hash;
FP.sb = FP.demo?.active ? FP.demo.client : supabase.createClient(FP_CONFIG.supabaseUrl, FP_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

