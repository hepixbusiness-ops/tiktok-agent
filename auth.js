#!/usr/bin/env node
/**
 * Connecte un compte TikTok à l'agent (une seule fois par compte).
 *
 * 1. node auth.js lien happi-web
 *    -> ouvre le lien affiché en étant connecté au bon compte TikTok, accepte.
 * 2. TikTok te renvoie sur pharel.cloud/tiktok-callback.html qui affiche une commande.
 * 3. node auth.js code happi-web <CODE>
 *    -> échange le code et enregistre les jetons dans Supabase.
 *
 * Variables requises : TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET,
 * SUPABASE_URL, SUPABASE_SERVICE_KEY (sinon le jeton est affiché pour être mis en secret GitHub).
 */
const crypto = require('crypto');
const config = require('./accounts.json');
const { echangerCode, identifiantsApp, nomVariable } = require('./lib/tiktok');

const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || 'https://pharel.cloud/tiktok-callback.html';
// video.publish (publication directe) seulement si l'app a ce scope : TIKTOK_SCOPES=user.info.basic,video.upload,video.publish
const SCOPES = process.env.TIKTOK_SCOPES || 'user.info.basic,video.upload';

function verifierCompte(id) {
  if (!config.comptes.some((c) => c.id === id)) {
    console.error(`Compte inconnu : ${id}. Comptes possibles : ${config.comptes.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  const [action, compteId, code] = process.argv.slice(2);
  if (!identifiantsApp()) {
    console.error('Définis TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET (voir README.md).');
    process.exit(1);
  }

  if (action === 'lien' && compteId) {
    verifierCompte(compteId);
    const params = new URLSearchParams({
      client_key: identifiantsApp().client_key,
      scope: SCOPES,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      state: `${compteId}.${crypto.randomBytes(6).toString('hex')}`,
    });
    console.log(`\nConnecte-toi d'abord à TikTok avec le compte prévu pour « ${compteId} », puis ouvre :\n`);
    console.log(`https://www.tiktok.com/v2/auth/authorize/?${params}\n`);
    return;
  }

  if (action === 'code' && compteId && code) {
    verifierCompte(compteId);
    const { jetons, stocke } = await echangerCode(compteId, decodeURIComponent(code), REDIRECT_URI);
    console.log(`\n✓ Compte ${compteId} connecté (open_id ${jetons.open_id}, scopes : ${jetons.scope}).`);
    if (stocke) {
      console.log('  Jetons enregistrés dans Supabase, l\'agent les renouvellera tout seul.');
    } else if (process.env.GITHUB_ACTIONS) {
      // Jamais de jeton dans des logs GitHub : sans Supabase, il faut passer par le PC.
      console.error('✗ Supabase non configuré : impossible de garder le jeton. Ajoute SUPABASE_URL et SUPABASE_SERVICE_KEY.');
      process.exit(1);
    } else {
      console.log(`  Supabase non configuré : ajoute ce secret GitHub (il expire dans environ 1 an) :\n`);
      console.log(`  ${nomVariable(compteId)} = ${jetons.refresh_token}\n`);
    }
    return;
  }

  console.log('Usage :\n  node auth.js lien <compte>\n  node auth.js code <compte> <code>');
  process.exit(1);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
