#!/usr/bin/env node
/** Affiche l'état TikTok d'un envoi : node status.js <compte> <publish_id> */
const { verifierEnvoi } = require('./lib/tiktok');

const [compteId, publishId] = process.argv.slice(2);
if (!compteId || !publishId) {
  console.log('Usage : node status.js <compte> <publish_id>');
  process.exit(1);
}
verifierEnvoi(compteId, publishId)
  .then((d) => console.log(JSON.stringify(d, null, 2)))
  .catch((e) => {
    console.error('✗', e.message);
    process.exit(1);
  });
