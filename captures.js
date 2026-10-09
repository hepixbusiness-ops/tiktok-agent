#!/usr/bin/env node
/**
 * Filme le vrai site prordv.app pour nourrir les vidéos motion :
 * captures mobiles pleine page (affichées dans les téléphones, avec défilement)
 * et captures desktop (navigateur). Résultat : motion/img/prordv/live/ + index.json.
 *
 *   node captures.js            (lancé chaque semaine par .github/workflows/tiktok-captures.yml)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SITE = process.env.PRORDV_URL || 'https://prordv.app';
const SORTIE = path.join(__dirname, 'motion', 'img', 'prordv', 'live');
const PAGES = [
  { nom: 'pro', chemin: '/pro', titre: 'Page pro' },
  { nom: 'accueil', chemin: '/', titre: 'Marketplace' },
  { nom: 'salons', chemin: '/salons', titre: 'Établissements' },
  { nom: 'recherche', chemin: '/recherche', titre: 'Recherche' },
];
const HAUTEUR_MAX = 5200;

async function capturer(navigateur, url, fichierBase) {
  const sorties = {};
  // Mobile : pleine page, pour défiler dans le téléphone
  const mobile = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' });
  const pm = await mobile.newPage();
  await pm.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await pm.waitForTimeout(1500);
  // fait défiler pour déclencher le chargement des images paresseuses, puis revient en haut
  await pm.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await pm.waitForTimeout(800);
  const h = Math.min(HAUTEUR_MAX, await pm.evaluate(() => document.documentElement.scrollHeight));
  sorties.mobile = `${fichierBase}-mobile.jpg`;
  await pm.screenshot({ path: path.join(SORTIE, sorties.mobile), type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: 390, height: h }, fullPage: true });
  const liens = await pm.evaluate(() => [...document.querySelectorAll('a[href^="/etablissement/"]')].map((a) => a.getAttribute('href')));
  await mobile.close();
  // Desktop : premier écran, pour le navigateur
  const desk = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' });
  const pd = await desk.newPage();
  await pd.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await pd.waitForTimeout(1500);
  sorties.desktop = `${fichierBase}-desktop.jpg`;
  await pd.screenshot({ path: path.join(SORTIE, sorties.desktop), type: 'jpeg', quality: 82 });
  await desk.close();
  return { sorties, liens };
}

async function main() {
  fs.mkdirSync(SORTIE, { recursive: true });
  const navigateur = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const index = [];
  const etablissements = new Set();
  try {
    for (const p of PAGES) {
      try {
        const { sorties, liens } = await capturer(navigateur, SITE + p.chemin, p.nom);
        index.push({ nom: p.nom, titre: p.titre, ...sorties });
        liens.forEach((l) => etablissements.add(l));
        console.log('✓', p.chemin);
      } catch (e) {
        console.warn('✗', p.chemin, e.message.split('\n')[0]);
      }
    }
    // jusqu'à 4 pages d'établissements réels, pour montrer des exemples concrets
    for (const [k, lien] of [...etablissements].slice(0, 4).entries()) {
      try {
        const { sorties } = await capturer(navigateur, SITE + lien, `etablissement-${k + 1}`);
        index.push({ nom: `etablissement-${k + 1}`, titre: 'Page établissement', lien, ...sorties });
        console.log('✓', lien);
      } catch (e) {
        console.warn('✗', lien, e.message.split('\n')[0]);
      }
    }
  } finally {
    await navigateur.close();
  }
  if (!index.length) throw new Error(`Aucune capture réussie sur ${SITE}`);
  fs.writeFileSync(path.join(SORTIE, 'index.json'), JSON.stringify({ date: new Date().toISOString(), site: SITE, captures: index }, null, 2) + '\n');
  console.log(`${index.length} pages capturées`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
