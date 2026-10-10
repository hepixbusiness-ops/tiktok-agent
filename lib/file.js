/**
 * Mode « validation » : la vidéo est déposée dans Supabase (bucket privé tiktok-videos +
 * table tiktok_file) et attend ton tap « Publier » sur pharel.cloud/publier.html.
 */
const fs = require('fs');
const path = require('path');

function supabase() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const cle = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !cle) return null;
  return { url, headers: { apikey: cle, Authorization: 'Bearer ' + cle } };
}

async function mettreEnFile({ compteId, fichier, legende, sujet }) {
  const sb = supabase();
  if (!sb) return { statut: 'ignore', raison: 'SUPABASE_URL / SUPABASE_SERVICE_KEY absents' };
  const chemin = `${compteId}/${path.basename(fichier)}`;
  const up = await fetch(`${sb.url}/storage/v1/object/tiktok-videos/${chemin}`, {
    method: 'POST',
    headers: { ...sb.headers, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
    body: fs.readFileSync(fichier),
  });
  if (!up.ok) throw new Error(`Stockage Supabase ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const ins = await fetch(`${sb.url}/rest/v1/tiktok_file`, {
    method: 'POST',
    headers: { ...sb.headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: compteId, video_path: chemin, legende, sujet }),
  });
  if (!ins.ok) throw new Error(`Table tiktok_file ${ins.status}: ${(await ins.text()).slice(0, 200)}`);
  const [ligne] = await ins.json();
  return { statut: 'en-attente-validation', detail: 'à publier sur pharel.cloud/publier.html', publish_id: ligne?.id };
}

module.exports = { mettreEnFile };
