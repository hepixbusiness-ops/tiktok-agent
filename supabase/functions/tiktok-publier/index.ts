// Validation en 1 tap des vidéos de l'agent TikTok (page pharel.cloud/publier.html).
// Actions (POST JSON, protégées par la clé PUBLIER_CLE) :
//   liste    -> vidéos en attente + aperçu signé + infos du créateur TikTok (exigées par TikTok)
//   publier  -> publication directe sur TikTok avec légende, confidentialité choisie, label IA
//   ecarter  -> retire la vidéo de la file
//   statut   -> état TikTok d'une vidéo envoyée
import { createClient } from "jsr:@supabase/supabase-js@2";

const API = "https://open.tiktokapis.com/v2";
const BUCKET = "tiktok-videos";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const rep = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function egal(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function jeton(compte: string): Promise<string> {
  const { data: l } = await db.from("tiktok_tokens").select("*").eq("account_id", compte).maybeSingle();
  if (!l) throw new Error(`compte ${compte} non connecté`);
  if (l.access_token && l.expires_at && new Date(l.expires_at) > new Date()) return l.access_token;
  const r = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: (Deno.env.get("TIKTOK_CLIENT_KEY") || "").trim(),
      client_secret: (Deno.env.get("TIKTOK_CLIENT_SECRET") || "").trim(),
      grant_type: "refresh_token",
      refresh_token: l.refresh_token,
    }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`OAuth TikTok : ${j.error || r.status} ${j.error_description || ""}`);
  await db.from("tiktok_tokens").upsert({
    account_id: compte, open_id: j.open_id, access_token: j.access_token, refresh_token: j.refresh_token, scope: j.scope,
    expires_at: new Date(Date.now() + (j.expires_in - 120) * 1000).toISOString(), updated_at: new Date().toISOString(),
  });
  return j.access_token;
}

async function tiktok(chemin: string, jt: string, corps: unknown = {}) {
  const r = await fetch(`${API}${chemin}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + jt, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(corps),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.error && j.error.code !== "ok")) throw new Error(`${j.error?.code || r.status} ${j.error?.message || ""}`.trim());
  return j.data;
}

async function liste() {
  const { data, error } = await db.from("tiktok_file").select("*").in("statut", ["en_attente", "envoyee", "echec"])
    .order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  const createurs: Record<string, unknown> = {};
  for (const c of [...new Set(data.map((v) => v.account_id))]) {
    try { createurs[c] = await tiktok("/post/publish/creator_info/query/", await jeton(c)); }
    catch (e) { createurs[c] = { erreur: (e as Error).message }; }
  }
  const videos = await Promise.all(data.map(async (v) => {
    const { data: s } = await db.storage.from(BUCKET).createSignedUrl(v.video_path, 3600);
    return { ...v, url: s?.signedUrl };
  }));
  return { videos, createurs };
}

async function publier(p: Record<string, unknown>) {
  const { data: v } = await db.from("tiktok_file").select("*").eq("id", p.id).maybeSingle();
  if (!v) throw new Error("vidéo introuvable");
  if (v.statut === "publiee") throw new Error("déjà publiée");
  if (!p.confidentialite) throw new Error("choisis qui peut voir la vidéo");
  const jt = await jeton(v.account_id);
  const createur = await tiktok("/post/publish/creator_info/query/", jt);
  if (!(createur.privacy_level_options || []).includes(p.confidentialite)) {
    throw new Error(`confidentialité non autorisée pour ce compte : ${p.confidentialite}`);
  }
  const { data: fichier, error } = await db.storage.from(BUCKET).download(v.video_path);
  if (error || !fichier) throw new Error("vidéo illisible dans le stockage");
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const legende = String(p.legende ?? v.legende).slice(0, 2200);
  const init = await tiktok("/post/publish/video/init/", jt, {
    post_info: {
      title: legende,
      privacy_level: p.confidentialite,
      disable_comment: !p.commentaires,
      disable_duet: !p.duo,
      disable_stitch: !p.stitch,
      video_cover_timestamp_ms: 500,
      is_aigc: true,
      brand_content_toggle: !!p.contenuMarque,
      brand_organic_toggle: !!p.marquePropre,
    },
    source_info: { source: "FILE_UPLOAD", video_size: octets.length, chunk_size: octets.length, total_chunk_count: 1 },
  });
  const up = await fetch(init.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Range": `bytes 0-${octets.length - 1}/${octets.length}` },
    body: octets,
  });
  if (!up.ok) throw new Error(`envoi de la vidéo refusé (${up.status})`);
  await db.from("tiktok_file").update({ statut: "envoyee", publish_id: init.publish_id, legende, detail: null, updated_at: new Date().toISOString() }).eq("id", v.id);
  return { publish_id: init.publish_id };
}

async function statut(id: string) {
  const { data: v } = await db.from("tiktok_file").select("*").eq("id", id).maybeSingle();
  if (!v?.publish_id) throw new Error("pas encore envoyée");
  const s = await tiktok("/post/publish/status/fetch/", await jeton(v.account_id), { publish_id: v.publish_id });
  const nouveau = s.status === "PUBLISH_COMPLETE" ? "publiee" : s.status === "FAILED" ? "echec" : v.statut;
  await db.from("tiktok_file").update({ statut: nouveau, detail: s.fail_reason || null, updated_at: new Date().toISOString() }).eq("id", id);
  return { statut: nouveau, tiktok: s.status, raison: s.fail_reason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return rep({ erreur: "méthode non autorisée" }, 405);
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return rep({ erreur: "JSON invalide" }, 400); }
  if (!egal(String(p.cle || ""), Deno.env.get("PUBLIER_CLE") || "")) return rep({ erreur: "clé d'accès invalide" }, 401);
  try {
    if (p.action === "liste") return rep(await liste());
    if (p.action === "publier") return rep(await publier(p));
    if (p.action === "statut") return rep(await statut(String(p.id)));
    if (p.action === "ecarter") {
      await db.from("tiktok_file").update({ statut: "refusee", updated_at: new Date().toISOString() }).eq("id", p.id);
      return rep({ ok: true });
    }
    return rep({ erreur: "action inconnue" }, 400);
  } catch (e) {
    if (p.action === "publier" && p.id) {
      await db.from("tiktok_file").update({ statut: "echec", detail: (e as Error).message, updated_at: new Date().toISOString() }).eq("id", p.id);
    }
    return rep({ erreur: (e as Error).message }, 400);
  }
});
