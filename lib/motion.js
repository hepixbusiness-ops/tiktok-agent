/**
 * Vidéos « motion design » (style de la vidéo Présentation Happi Digital) :
 * script IA en scènes -> voix off avec le minutage de chaque mot -> rendu image par image
 * de motion/template.html dans Chromium -> MP4 avec la voix.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { genererJSON } = require('./llm');
const { FFMPEG, dureeAudio } = require('./media');

const exec = promisify(execFile);
const RACINE_MOTION = path.join(__dirname, '..', 'motion');
const FPS = 30;
const TYPES = ['accroche', 'telephone', 'points', 'etapes', 'grand', 'cta'];

// ---------- Script ----------

function prompt(compte, format, sujetsRecents) {
  const m = compte.motion;
  const system = `Tu es le scénariste des vidéos TikTok du compte ${compte.handle} (${compte.marque}).
Persona : ${compte.persona}
Audience : ${compte.audience}

La vidéo est un motion design élégant de 25 à 40 secondes, découpé en scènes. Chaque scène affiche peu de texte, très gros, pendant qu'une voix off parle.

Faits vérifiés sur ${compte.marque} (les SEULS chiffres, prix et promesses que tu as le droit d'utiliser) :
${(compte.faits || []).map((f) => '- ' + f).join('\n')}

Règles absolues :
- N'invente jamais de chiffre, de statistique, de témoignage, de client, de prix ou de résultat. Pour une scène « grand », utilise un fait de la liste ou un mot fort sans chiffre.
- Français oral, simple, ${/Vouvoie/i.test(compte.persona) ? 'en vouvoyant' : 'en tutoyant'}.
- Chaque titre est UNE vraie phrase française correcte, élégante et complète (sujet + verbe), coupée en 2 ou 3 lignes. Jamais de style télégraphique (« Agenda remplit », « Gestion rapide ») ni d'anglicisme (« booker »).
- Dans chaque titre, mets entre astérisques le ou les deux derniers mots à mettre en valeur, ils s'afficheront en italique de couleur. Exemples du ton attendu :
  ["Votre agenda", "se remplit", "*pendant la nuit.*"]
  ["Vos clients", "réservent", "*en un clic.*"]
  ["Fini les rendez-vous", "*oubliés.*"]
  ["Votre activité", "mérite *mieux.*"]
- Lignes de 16 caractères maximum.
- Pas de tiret long (—), pas d'emoji.
- Réponds uniquement avec du JSON valide.`;

  const user = `Thèmes possibles (choisis un angle précis) :
${compte.piliers.map((p) => '- ' + p).join('\n')}

Format imposé : ${format.id}. ${format.consigne}
${sujetsRecents.length ? `\nSujets déjà traités, à ne pas refaire :\n${sujetsRecents.map((s) => '- ' + s).join('\n')}\n` : ''}
Types de scènes disponibles :
- "accroche" : { "lignes": [..] } fond sombre, phrase choc. TOUJOURS la première scène.
- "telephone" : { "titre": [..], "puces": [2 avantages de 3 mots max] } montre l'application sur un téléphone.
- "points" : { "titre": [..], "puces": [3 ou 4 éléments de 4 mots max] }
- "etapes" : { "titre": [..], "etapes": [3 ou 4 étapes de 4 mots max] }
- "grand" : { "valeur": "6 caractères max, ex. 24h/24 ou 3 min", "label": "courte légende avec un *mot* en valeur" } fond sombre.
- "cta" : { "titre": [..] } appel à l'action vers ${m.lien}. TOUJOURS la dernière scène.

Produis ce JSON :
{
  "sujet": "le sujet en une phrase",
  "scenes": [ { "type": "...", ...champs du type..., "voix": "ce que dit la voix off pendant la scène, 1 à 2 phrases, 28 mots max" } ],
  "legende": "légende TikTok : 1 à 2 phrases + une question, 150 caractères max",
  "hashtags": ["5 à 8 hashtags sans #"]
}
Entre 5 et 7 scènes. Au moins une scène "telephone".`;
  return { system, user };
}

const court = (s, n) => String(s || '').replace(/\s*—\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);
const lignes = (v, n = 3) => {
  const ls = (Array.isArray(v) ? v : [v]).map((l) => court(l, 40)).filter(Boolean).slice(0, n);
  if (ls.length && !ls.some((l) => l.includes('*'))) ls[ls.length - 1] = `*${ls[ls.length - 1].replace(/\*/g, '')}*`;
  return ls;
};

function valider(brut, compte) {
  let scenes = (brut.scenes || []).filter((s) => TYPES.includes(s.type)).map((s) => {
    const o = { type: s.type, voix: court(s.voix, 240) };
    if (s.type === 'accroche') o.lignes = lignes(s.lignes || s.titre);
    if (['telephone', 'points', 'etapes', 'cta'].includes(s.type)) o.titre = lignes(s.titre, 2);
    if (s.type === 'telephone') o.puces = (s.puces || []).map((p) => court(p, 26)).slice(0, 2);
    if (s.type === 'points') o.puces = (s.puces || []).map((p) => court(p, 32)).slice(0, 4);
    if (s.type === 'etapes') o.etapes = (s.etapes || []).map((p) => court(p, 30)).slice(0, 4);
    if (s.type === 'grand') { o.valeur = court(s.valeur, 8); o.label = court(s.label, 30); }
    return o;
  }).filter((s) => s.voix && (s.lignes?.length || s.titre?.length || s.valeur));

  if (!scenes.length || scenes[0].type !== 'accroche') throw new Error('Script motion : la première scène doit être une accroche');
  if (scenes[scenes.length - 1].type !== 'cta') {
    scenes.push({ type: 'cta', titre: ['Lancez-vous', '*aujourd\'hui.*'], voix: compte.cta });
  }
  scenes = scenes.slice(0, 6).concat(scenes.length > 7 ? [scenes[scenes.length - 1]] : scenes.slice(6, 7));
  if (scenes.length < 4) throw new Error(`Script motion trop court (${scenes.length} scènes)`);

  const tags = [...new Set([...(brut.hashtags || []), ...compte.hashtags]
    .map((h) => String(h).replace(/[#\s]/g, '').toLowerCase()).filter(Boolean))].slice(0, 10);
  return { sujet: court(brut.sujet, 200), scenes, legende: court(brut.legende, 300), hashtags: tags };
}

function scriptDeTest(compte) {
  return valider({
    sujet: 'Test motion',
    scenes: [
      { type: 'accroche', lignes: ['Vos clients', 'réservent', '*ailleurs.*'], voix: 'Vos clients veulent réserver tout de suite. Si ce n\'est pas possible chez vous, ils vont ailleurs.' },
      { type: 'telephone', titre: ['Votre page', '*à votre nom.*'], puces: ['Réservation 24h/24', 'Rappels auto'], voix: 'Avec ProRDV, votre établissement a sa propre page de réservation, ouverte jour et nuit.' },
      { type: 'grand', valeur: '3 min', label: 'pour *démarrer*', voix: 'Votre page est prête en trois minutes.' },
      { type: 'etapes', titre: ['Comment', '*ça marche ?*'], etapes: ['Créez votre page', 'Partagez le lien', 'Recevez les réservations'], voix: 'Créez votre page, partagez le lien sur WhatsApp, et recevez les réservations.' },
      { type: 'cta', titre: ['Commencez', '*gratuitement.*'], voix: 'Créez votre page de réservation sur prordv point app.' },
    ],
    legende: 'Et si vos clients réservaient pendant que vous dormez ?',
    hashtags: [],
  }, compte);
}

// ---------- Voix ----------

async function voixScene(texte, voix, dossier, i) {
  const mp3 = path.join(dossier, `v${i}.mp3`);
  const json = path.join(dossier, `v${i}.json`);
  try {
    await exec(process.env.PYTHON || 'python3', [path.join(__dirname, 'tts_mots.py'), voix, '+6%', texte, mp3, json], { timeout: 90000 });
    const mots = JSON.parse(fs.readFileSync(json, 'utf8'));
    if (fs.statSync(mp3).size > 1000 && mots.length) return { audio: mp3, mots, duree: await dureeAudio(mp3) };
  } catch {
    // edge-tts indisponible : minutage estimé, vidéo muette
  }
  const ws = texte.split(/\s+/).filter(Boolean);
  const mots = ws.map((w, k) => [0.15 + k * 0.34, 0.15 + k * 0.34 + 0.3, w]);
  return { audio: null, mots, duree: 0.3 + ws.length * 0.34 };
}

// ---------- Rendu ----------

function lanceurChromium() {
  const { chromium } = require('playwright');
  const opts = {};
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

async function rendre(data, sortieMuette) {
  const navigateur = await lanceurChromium();
  try {
    const page = await navigateur.newPage({ viewport: { width: 1080, height: 1920 } });
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    await page.addInitScript((d) => { window.DATA = d; }, data);
    await page.goto('file://' + path.join(RACINE_MOTION, 'template.html'));
    await page.evaluate(() => document.fonts.ready);
    if (erreurs.length) throw new Error('Modèle motion : ' + erreurs[0]);

    const n = Math.round(data.duree * FPS);
    const ff = spawn(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), sortieMuette]);
    let errFF = '';
    ff.stderr.on('data', (d) => { errFF += d; });
    for (let f = 0; f < n; f++) {
      await page.evaluate((t) => window.seek(t), f / FPS);
      const img = await page.screenshot({ type: 'jpeg', quality: 90 });
      if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    const code = await new Promise((r) => ff.on('close', r));
    if (code !== 0) throw new Error('ffmpeg (rendu motion) : ' + errFF.slice(0, 300));
    if (erreurs.length) throw new Error('Modèle motion : ' + erreurs[0]);
  } finally {
    await navigateur.close();
  }
}

async function assemblerAudio(scenes, dossier, sortie) {
  const liste = [];
  for (const [i, s] of scenes.entries()) {
    const wav = path.join(dossier, `a${i}.wav`);
    const entree = s.audio ? ['-i', s.audio] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
    await exec(FFMPEG, ['-y', '-v', 'error', ...entree, '-af', 'apad', '-t', (s.t1 - s.t0).toFixed(3), '-ar', '44100', '-ac', '2', wav]);
    liste.push(`file '${wav}'`);
  }
  fs.writeFileSync(path.join(dossier, 'audio.txt'), liste.join('\n'));
  await exec(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dossier, 'audio.txt'), '-c', 'copy', sortie]);
}

// ---------- Production ----------

async function produireMotion(compte, format, sujetsRecents, opts, dossier, video) {
  let script;
  if (opts.mock) script = { ...scriptDeTest(compte), fournisseur: 'mock' };
  else {
    const { json, fournisseur } = await genererJSON(prompt(compte, format, sujetsRecents));
    script = { ...valider(json, compte), fournisseur };
  }
  const m = compte.motion;
  const images = m.images || [];
  let t = 0;
  let avecVoix = 0;
  let nTel = 0;
  const mots = [];
  const scenes = [];
  for (const [i, s] of script.scenes.entries()) {
    const v = opts.mock ? voixEstimee(s.voix) : await voixScene(s.voix, compte.voix, dossier, i);
    if (v.audio) avecVoix++;
    const min = s.type === 'cta' ? 4 : 2.4;
    const duree = Math.max(min, v.duree + (s.type === 'cta' ? 1.6 : 0.45));
    const sc = { ...s, t0: t, t1: t + duree, audio: v.audio, sombre: s.type === 'accroche' || s.type === 'grand' };
    if (s.type === 'telephone' && images.length) {
      const im = images[nTel++ % images.length];
      sc.image = im.fichier;
      sc.statusBg = im.statusBg;
    }
    if (s.type === 'cta') {
      sc.mention = m.mention;
      if (images.length) { sc.image = images[images.length - 1].fichier; sc.statusBg = images[images.length - 1].statusBg; }
    }
    v.mots.forEach(([a, b, w]) => mots.push([+(t + a + 0.05).toFixed(3), +(t + b + 0.05).toFixed(3), w, i]));
    scenes.push(sc);
    t += duree;
  }

  const data = {
    duree: +t.toFixed(3),
    theme: m.theme,
    lien: m.lien,
    marqueHtml: m.marqueHtml,
    logo: fs.readFileSync(path.join(RACINE_MOTION, m.logo), 'utf8'),
    scenes: scenes.map(({ audio, ...s }) => s),
    mots,
  };
  const muette = path.join(dossier, 'muette.mp4');
  const audio = path.join(dossier, 'audio.wav');
  await rendre(data, muette);
  await assemblerAudio(scenes, dossier, audio);
  await exec(FFMPEG, ['-y', '-v', 'error', '-i', muette, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart', '-shortest', video]);

  return {
    script: { sujet: script.sujet, slides: script.scenes, legende: script.legende, hashtags: script.hashtags, fournisseur: script.fournisseur },
    duree: t,
    avecVoix,
    nScenes: scenes.length,
  };
}

function voixEstimee(texte) {
  const ws = texte.split(/\s+/).filter(Boolean);
  return { audio: null, mots: ws.map((w, k) => [0.15 + k * 0.34, 0.45 + k * 0.34, w]), duree: 0.3 + ws.length * 0.34 };
}

module.exports = { produireMotion };
