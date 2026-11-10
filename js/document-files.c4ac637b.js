// V5 (files that work): the reads and writes behind the Documents block, shared by the two hosts that show it: the farm space and the
// group space. The block itself calls nothing (blocks/documents.js stays pure); each host's store hands these to it. Every call is as
// the signed-in person: row-level security, the storage policies and the document guards decide what is allowed.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./blocks/documents.js") : root.FP.documentsBlock, node ? require("./farm-model.js") : root.FP.farmModel);
  if (node) module.exports = api; else root.FP.documentFiles = api;
})(typeof window === "undefined" ? globalThis : window, function (D, M) {
  const MAX_LISTED = 1000, RELATIONS_PER_READ = 200;   // the most documents one list reads (PostgREST's own ceiling), and ids per relations read
  const list = (v) => Array.isArray(v) ? v : [];

  // A signed link to the file, carrying its original name as the download parameter.
  async function downloadLink(sb, doc) {
    const { data, error } = await sb.storage.from("documents").createSignedUrl(doc.storage_path, 3600);
    if (error || !data?.signedUrl) throw Error("Couldn't get the file");
    const name = D.downloadName(doc);
    return { url: D.downloadHref(data.signedUrl, name), name };
  }
  // owner: { farm_id } or { org_id }. Bytes to the content address (a group's files under org/<id>), then one documents insert with the choices made.
  async function addFile(sb, owner, { file, title, doc_type, tier, relates_to, visibility, date_prepared }, known) {
    const bytes = await file.arrayBuffer(), sha = await D.sha256Hex(bytes);
    const same = list(known).find((d) => d.sha256 === sha);
    if (same) throw Error("already here as " + M.docTitle(same));
    const path = D.storagePath(owner.org_id ? "org/" + owner.org_id : owner.farm_id, sha, file.name), mime = file.type || "application/octet-stream";
    const up = await sb.storage.from("documents").upload(path, file, { contentType: mime, upsert: false });
    // The same bytes uploaded before but never described: describe them now (the database checks they are yours).
    if (up.error && !/exist|duplicate|409/i.test(String(up.error.message || "") + (up.error.statusCode || ""))) throw up.error;
    const { data, error } = await sb.from("documents").insert({ ...owner, title, doc_type, original_name: file.name, mime_type: mime, sha256: sha, size_bytes: file.size, storage_path: path, tier,
      relates_to: relates_to || null, tiered_at: new Date().toISOString(), date_prepared: date_prepared || null, ...(visibility === "private" ? { visibility } : {}) }).select("id").single();
    if (error) throw error;
    return data.id;
  }
  async function moveFile(sb, id, change) {
    const { data, error } = await sb.from("documents").update({ ...change, tiered_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw Error("That change wasn't allowed.");
  }
  // Marking or clearing "superseded". The database allows it for RCL staff only; nothing is deleted.
  async function supersedeFile(sb, id, by) {
    const { data, error } = await sb.from("documents").update({ status: by ? "superseded" : "final", superseded_by: by || null }).eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw Error("That change wasn't allowed.");
  }
  // Bounded: count first, then fetch at most that many (and never above MAX_LISTED). match: { farm_id } or { org_id }.
  async function countRows(sb, match) {
    const key = Object.keys(match)[0];
    const { count, error } = await sb.from("documents").select("id", { count: "exact", head: true }).eq(key, match[key]);
    return !error && Number.isInteger(count) ? Math.min(count, MAX_LISTED) : MAX_LISTED;
  }
  async function readRows(sb, match, columns) {
    const key = Object.keys(match)[0], n = await countRows(sb, match);
    const { data, error } = await sb.from("documents").select(columns).eq(key, match[key]).order("title").limit(n);
    if (error) throw error;
    return data || [];
  }
  // relates_to and superseded_by come from document_relations, which leaves out a relationship whose other end the reader can't see. The ids go a
  // few at a time, so a long list never overruns a URL; a part that can't be read reads as no relationships.
  async function withRelations(sb, rows) {
    const ids = list(rows).map((d) => d.id), parts = [];
    for (let i = 0; i < ids.length; i += RELATIONS_PER_READ) parts.push(ids.slice(i, i + RELATIONS_PER_READ));
    const reads = await Promise.all(parts.map((part) => Promise.resolve(sb.from("document_relations").select("id,relates_to,superseded_by").in("id", part)).then((r) => r, () => ({ data: [] }))));
    const known = new Map(reads.flatMap((r) => (r.error ? [] : r.data || [])).map((r) => [r.id, r]));
    return list(rows).map((d) => ({ ...d, relates_to: known.get(d.id)?.relates_to ?? null, superseded_by: known.get(d.id)?.superseded_by ?? null }));
  }

  return { downloadLink, addFile, moveFile, supersedeFile, countRows, readRows, withRelations, MAX_LISTED };
});
