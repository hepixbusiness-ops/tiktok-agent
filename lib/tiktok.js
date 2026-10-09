/**
 * TikTok Content Posting API (officielle).
 * - inbox  : la vidéo arrive dans les notifications TikTok du compte, tu publies d'un tap (scope video.upload).
 * - direct : publication directe (scope video.publish ; en public seulement si l'app TikTok est auditée).
 *
 * Les jetons sont stockés dans Supabase (table tiktok_tokens) car TikTok peut
 * renouveler le refresh_token à chaque rafraîchissement.
 */
const fs = require('fs');

const API = 'https://open.tiktokapis.com/v2';

// ---------- Stockage des jetons ----------

function supabase() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const cle = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !cle) return null;
  return {
    url: `${url}/rest/v1/tiktok_tokens`,
    headers: { apikey: cle, Authorization: 'Bearer ' + cle, 'Content-Type': 'application/json' },
  };
}

function nomVariable(compteId) {
  return 'TIKTOK_REFRESH_TOKEN_' + compteId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

async function lireJetons(compteId) {
  const sb = supabase();
  if (sb) {
    const res = await fetch(`${sb.url}?account_id=eq.${encodeURIComponent(compteId)}&select=*`, { headers: sb.headers });
    if (res.ok) {
      const [ligne] = await res.json();
      if (ligne) return ligne;
    }
  }
  const refresh = process.env[nomVariable(compteId)];
  return refresh ? { account_id: compteId, refresh_token: refresh } : null;
}

async function enregistrerJetons(compteId, jetons) {
  const sb = supabase();
  if (!sb) return false;
  const ligne = {
    account_id: compteId,
    open_id: jetons.open_id,
    access_token: jetons.access_token,
    refresh_token: jetons.refresh_token,
    scope: jetons.scope,
    expires_at: new Date(Date.now() + (jetons.expires_in - 120) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(sb.url, {
    method: 'POST',
    headers: { ...sb.headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(ligne),
  });
  if (!res.ok) throw new Error(`Supabase tiktok_tokens ${res.status}: ${await res.text()}`);
  return true;
}

// ---------- OAuth ----------

function identifiantsApp() {
  // trim : un secret collé avec un retour à la ligne casse l'OAuth.
  const client_key = (process.env.TIKTOK_CLIENT_KEY || '').trim();
  const client_secret = (process.env.TIKTOK_CLIENT_SECRET || '').trim();
  if (!client_key || !client_secret) return null;
  return { client_key, client_secret };
}

async function demanderJeton(params) {
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...identifiantsApp(), ...params }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`OAuth TikTok : ${data.error || res.status} ${data.error_description || ''}`);
  return data;
}

async function echangerCode(compteId, code, redirectUri) {
  const jetons = await demanderJeton({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const stocke = await enregistrerJetons(compteId, jetons);
  return { jetons, stocke };
}

async function jetonAcces(compteId) {
  const stocke = await lireJetons(compteId);
  if (!stocke) return null;
  if (stocke.access_token && stocke.expires_at && new Date(stocke.expires_at) > new Date()) {
    return stocke.access_token;
  }
  const jetons = await demanderJeton({ grant_type: 'refresh_token', refresh_token: stocke.refresh_token });
  await enregistrerJetons(compteId, jetons);
  return jetons.access_token;
}

// ---------- Publication ----------

async function appel(chemin, jeton, corps) {
  const res = await fetch(`${API}${chemin}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(corps || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.error && data.error.code !== 'ok')) {
    throw new Error(`TikTok ${chemin} : ${data.error?.code || res.status} ${data.error?.message || ''}`);
  }
  return data.data;
}

async function envoyerFichier(uploadUrl, fichier) {
  const taille = fs.statSync(fichier).size;
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(taille),
      'Content-Range': `bytes 0-${taille - 1}/${taille}`,
    },
    body: fs.readFileSync(fichier),
  });
  if (!res.ok) throw new Error(`Envoi vidéo TikTok ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function sourceFichier(fichier) {
  const taille = fs.statSync(fichier).size;
  // Un seul morceau : nos vidéos font quelques Mo, sous la limite de 64 Mo par morceau.
  if (taille > 64 * 1024 * 1024) throw new Error('Vidéo trop lourde pour un envoi en un morceau');
  return { source: 'FILE_UPLOAD', video_size: taille, chunk_size: taille, total_chunk_count: 1 };
}

async function publier({ compteId, fichier, legende, mode }) {
  if (!identifiantsApp()) return { statut: 'ignore', raison: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET absents' };
  const jeton = await jetonAcces(compteId);
  if (!jeton) return { statut: 'ignore', raison: `compte non connecté (lance node auth.js pour ${compteId})` };

  if (mode === 'direct') {
    const createur = await appel('/post/publish/creator_info/query/', jeton);
    const options = createur.privacy_level_options || [];
    const confidentialite = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0] || 'SELF_ONLY';
    const { publish_id, upload_url } = await appel('/post/publish/video/init/', jeton, {
      post_info: {
        title: legende.slice(0, 2200),
        privacy_level: confidentialite,
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 500,
        is_aigc: true,
      },
      source_info: sourceFichier(fichier),
    });
    await envoyerFichier(upload_url, fichier);
    return { statut: 'publie', mode, publish_id, confidentialite };
  }

  const { publish_id, upload_url } = await appel('/post/publish/inbox/video/init/', jeton, {
    source_info: sourceFichier(fichier),
  });
  await envoyerFichier(upload_url, fichier);
  return { statut: 'envoye-inbox', mode: 'inbox', publish_id };
}

module.exports = { publier, echangerCode, identifiantsApp, nomVariable };
