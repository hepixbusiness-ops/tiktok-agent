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
const TYPES = ['accroche', 'telephone', 'carrousel', 'navigateur', 'mur', 'notification', 'metiers', 'points', 'etapes', 'grand', 'cta'];
const AVEC_TITRE = ['telephone', 'carrousel', 'navigateur', 'mur', 'notification', 'metiers', 'points', 'etapes', 'cta'];

// ---------- Script ----------

const DESCRIPTION = {
  accroche: '{ "titre": "phrase choc" } fond sombre, arrête le scroll',
  telephone: '{ "titre": "...", "puces": [2 avantages de 3 mots max] } l\'application sur un téléphone',
  carrousel: '{ "titre": "..." } trois téléphones avec trois vraies pages',
  navigateur: '{ "titre": "...", "puces": [2 avantages de 3 mots max] } le site sur un ordinateur',
  mur: '{ "titre": "..." } un mur de pages qui défile (« partout », « déjà en ligne »)',
  notification: '{ "titre": "...", "notifications": [3 x { "titre": "Nouvelle réservation", "texte": "Coupe homme · demain 10h" }] } réservations qui arrivent (exemples génériques, aucun nom)',
  metiers: '{ "titre": "..." } bandeaux des métiers concernés',
  points: '{ "titre": "...", "puces": [3 éléments de 4 mots max] }',
  etapes: '{ "titre": "...", "etapes": [3 étapes de 4 mots max] }',
  grand: '{ "valeur": "6 caractères max issus des faits, ex. 24h/24 ou 3 min", "label": "courte légende avec un *mot* en valeur" } fond sombre',
  cta: '{ "titre": "..." } appel à l\'action',
};
const VISUELS = ['telephone', 'carrousel', 'navigateur', 'mur', 'notification', 'metiers'];
const TEXTES = ['points', 'etapes', 'grand'];
const melange = (l) => l.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

/** Enchaînement varié choisi par le code : accroche, 4 visuels, 1 scène texte, appel à l'action. */
function planScenes() {
  const vis = melange(VISUELS).slice(0, 4);
  const txt = melange(TEXTES)[0];
  const milieu = [...vis];
  milieu.splice(1 + Math.floor(Math.random() * 3), 0, txt);
  return ['accroche', ...milieu, 'cta'];
}

/** Coupe une phrase en lignes de ~16 caractères sans casser les passages *en valeur* ni les élisions. */
function couper(phrase, max = 16, maxLignes = 3) {
  const brut = court(phrase, 60).replace(/\*\s*\*/g, ' ');
  const jetons = [];
  brut.split(/(\*[^*]+\*)/).filter(Boolean).forEach((p) => {
    if (p.startsWith('*')) jetons.push(p);
    else p.trim().split(/\s+/).filter(Boolean).forEach((w) => jetons.push(w));
  });
  // colle les élisions (d', l', qu'…) au mot suivant
  for (let i = jetons.length - 2; i >= 0; i--) if (/[’']$/.test(jetons[i])) jetons.splice(i, 2, jetons[i] + jetons[i + 1]);
  const lignes = [];
  let cour = '';
  const lg = (x) => x.replace(/\*/g, '').length;
  for (const j of jetons) {
    if (cour && lg(cour + ' ' + j) > max && lignes.length < maxLignes - 1) { lignes.push(cour); cour = j; }
    else cour = cour ? cour + ' ' + j : j;
  }
  if (cour) lignes.push(cour);
  if (!lignes.some((l) => l.includes('*'))) {
    const d = lignes[lignes.length - 1].split(' ');
    const n = d.length > 2 ? 2 : 1;
    lignes[lignes.length - 1] = [...d.slice(0, d.length - n), `*${d.slice(d.length - n).join(' ')}*`].join(' ');
  }
  return lignes;
}

function prompt(compte, format, sujetsRecents, plan) {
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
Plan imposé : remplis EXACTEMENT ces ${plan.length} scènes, dans cet ordre :
${plan.map((t, k) => `${k + 1}. ${t} : ${DESCRIPTION[t]}`).join('\n')}

Pour chaque titre, écris UNE phrase complète (12 à 40 caractères), avec les mots à mettre en valeur entre astérisques à la fin. Exemple : "Votre agenda se remplit *pendant la nuit.*"

Produis ce JSON :
{
  "sujet": "le sujet en une phrase",
  "scenes": [ { "type": "...", ...champs du type..., "voix": "ce que dit la voix off pendant la scène, 1 à 2 phrases, 28 mots max" } ],
  "legende": "légende TikTok : 1 à 2 phrases + une question, 150 caractères max",
  "hashtags": ["5 à 8 hashtags sans #"]
}`;
  return { system, user };
}

const court = (s, n) => String(s || '').replace(/\s*—\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);
const lignes = (v, n = 3) => {
  const ls = (Array.isArray(v) ? v : [v]).map((l) => court(l, 40)).filter(Boolean).slice(0, n);
  if (ls.length && !ls.some((l) => l.includes('*'))) ls[ls.length - 1] = `*${ls[ls.length - 1].replace(/\*/g, '')}*`;
  return ls;
};

function valider(brut, compte, max = 8) {
  let scenes = (brut.scenes || []).filter((s) => TYPES.includes(s.type)).map((s) => {
    const o = { type: s.type, voix: court(s.voix, 240) };
    const t = s.titre || s.lignes;
    const phrase = Array.isArray(t) ? t.join(' ') : t;
    if (s.type === 'accroche') o.lignes = couper(phrase, 14, 3);
    if (AVEC_TITRE.includes(s.type)) o.titre = couper(phrase, 16, 3);
    if (s.type === 'telephone' || s.type === 'navigateur') o.puces = (s.puces || []).map((p) => court(p, 26)).slice(0, 2);
    if (s.type === 'notification') {
      o.notifications = (s.notifications || []).slice(0, 3).map((n) => ({ titre: court(n.titre || 'Nouvelle réservation', 30), texte: court(n.texte, 40) }));
      if (!o.notifications.length) o.notifications = [{ titre: 'Nouvelle réservation', texte: 'Demain · 10h00' }];
    }
    if (s.type === 'points') o.puces = (s.puces || []).map((p) => court(p, 32)).slice(0, 4);
    if (s.type === 'etapes') o.etapes = (s.etapes || []).map((p) => court(p, 30)).slice(0, 4);
    if (s.type === 'grand') { o.valeur = court(s.valeur, 8); o.label = court(s.label, 30); }
    return o;
  }).filter((s) => s.voix && (s.lignes?.length || s.titre?.length || s.valeur));

  if (!scenes.length || scenes[0].type !== 'accroche') throw new Error('Script motion : la première scène doit être une accroche');
  if (scenes[scenes.length - 1].type !== 'cta') {
    scenes.push({ type: 'cta', titre: ['Lancez-vous', '*aujourd\'hui.*'], voix: compte.cta });
  }
  scenes = scenes.length > max ? scenes.slice(0, max - 1).concat([scenes[scenes.length - 1]]) : scenes;
  if (scenes.length < 4) throw new Error(`Script motion trop court (${scenes.length} scènes)`);

  const tags = [...new Set([...(brut.hashtags || []), ...compte.hashtags]
    .map((h) => String(h).replace(/[#\s]/g, '').toLowerCase()).filter(Boolean))].slice(0, 10);
  const legende = court(brut.legende, 300) || `${court(brut.sujet, 150)}. Et vous, vous gérez comment vos réservations ?`;
  return { sujet: court(brut.sujet, 200), scenes, legende, hashtags: tags };
}

function scriptDeTest(compte) {
  return valider({
    sujet: 'Test motion',
    scenes: [
      { type: 'accroche', lignes: ['Vos clients', 'réservent', '*ailleurs.*'], voix: 'Vos clients veulent réserver tout de suite. Si ce n\'est pas possible chez vous, ils vont ailleurs.' },
      { type: 'telephone', titre: ['Votre page', '*à votre nom.*'], puces: ['Réservation 24h/24', 'Rappels auto'], voix: 'Avec ProRDV, votre établissement a sa propre page de réservation, ouverte jour et nuit.' },
      { type: 'grand', valeur: '3 min', label: 'pour *démarrer*', voix: 'Votre page est prête en trois minutes.' },
      { type: 'notification', titre: ['Les réservations', '*arrivent seules.*'], notifications: [{ titre: 'Nouvelle réservation', texte: 'Tresses · demain 10h' }, { titre: 'Paiement reçu', texte: 'MoMo · acompte confirmé' }, { titre: 'Nouvelle réservation', texte: 'Massage · samedi 15h' }], voix: 'Les réservations arrivent toutes seules, même pendant que vous dormez.' },
      { type: 'carrousel', titre: ['Une page', '*qui vous ressemble.*'], voix: 'Chaque établissement a sa page, avec ses photos, ses prix et ses avis.' },
      { type: 'navigateur', titre: ['Aussi sur', '*ordinateur.*'], puces: ['Agenda en ligne', 'Paiement MoMo'], voix: 'Et vous gérez tout depuis votre téléphone ou votre ordinateur.' },
      { type: 'mur', titre: ['Ils sont déjà', '*sur ProRDV.*'], voix: 'Des établissements de toute l Afrique francophone utilisent déjà ProRDV.' },
      { type: 'metiers', titre: ['Pour tous', '*les métiers.*'], voix: 'Salons, spas, hôtels, restaurants, cliniques : ProRDV s adapte à votre métier.' },
      { type: 'etapes', titre: ['Comment', '*ça marche ?*'], etapes: ['Créez votre page', 'Partagez le lien', 'Recevez les réservations'], voix: 'Créez votre page, partagez le lien sur WhatsApp, et recevez les réservations.' },
      { type: 'cta', titre: ['Commencez', '*gratuitement.*'], voix: 'Créez votre page de réservation sur prordv point app.' },
    ],
    legende: 'Et si vos clients réservaient pendant que vous dormez ?',
    hashtags: [],
  }, compte, 12);
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

/** Bruitages synthétisés (aucun fichier sous licence) : whoosh, ding, nappe d'accords. */
async function sons(dossier, duree) {
  const f = (n) => path.join(dossier, n);
  await exec(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=0.55:c=pink:a=0.6',
    '-af', 'highpass=f=350,lowpass=f=4200,afade=t=in:d=0.22,afade=t=out:st=0.25:d=0.3,volume=0.9', '-ar', '44100', '-ac', '2', f('whoosh.wav')]);
  await exec(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=1318.5:d=0.5', '-f', 'lavfi', '-i', 'sine=f=1975.5:d=0.5',
    '-filter_complex', '[0][1]amix=inputs=2,afade=t=out:st=0.04:d=0.45,volume=0.8', '-ar', '44100', '-ac', '2', f('ding.wav')]);
  // nappe : la mineur, fa, do, sol (4 s chacun), très douce, filtrée
  const accords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [130.8, 196, 261.6], [196, 246.9, 293.7]];
  const liste = [];
  for (const [i, acc] of accords.entries()) {
    const fic = f(`acc${i}.wav`);
    await exec(FFMPEG, ['-y', '-v', 'error', ...acc.flatMap((hz) => ['-f', 'lavfi', '-i', `sine=f=${hz}:d=4`]),
      '-filter_complex', `amix=inputs=${acc.length},tremolo=f=0.4:d=0.25,lowpass=f=1200,afade=t=in:d=0.6,afade=t=out:st=3.3:d=0.7`, '-ar', '44100', '-ac', '2', fic]);
    liste.push(`file '${fic}'`);
  }
  fs.writeFileSync(f('nappe.txt'), Array.from({ length: Math.ceil(duree / 16) + 1 }, () => liste.join('\n')).join('\n'));
  await exec(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', f('nappe.txt'), '-t', duree.toFixed(2), f('nappe.wav')]);
  return { whoosh: f('whoosh.wav'), ding: f('ding.wav'), nappe: f('nappe.wav') };
}

/** Moments des bruitages, calés sur les animations du modèle. */
function evenementsSonores(scenes) {
  const ev = [];
  scenes.forEach((s, i) => {
    if (i > 0) ev.push(['whoosh', Math.max(0, s.t0 - 0.2)]);
    const dur = s.t1 - s.t0;
    if (s.type === 'notification') {
      const n = (s.notifications || []).length, pas = Math.max(0.6, (dur - 1.2) / Math.max(1, n));
      for (let j = 0; j < n; j++) ev.push(['ding', s.t0 + 0.8 + j * pas]);
    }
    if (s.type === 'cta') ev.push(['ding', s.t0 + 0.8]);
  });
  return ev;
}

/** Voix + nappe (baissée sous la voix) + bruitages. */
async function mixer(voix, scenes, duree, dossier, sortie) {
  const s = await sons(dossier, duree);
  const ev = evenementsSonores(scenes);
  const entrees = ['-i', voix, '-i', s.nappe, ...ev.flatMap(([n]) => ['-i', s[n]])];
  const filtres = ['[1:a]volume=0.18[nap]', '[0:a]asplit=2[v1][vsc]', '[nap][vsc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[napd]'];
  const sfx = ev.map(([n, t], k) => {
    const ms = Math.round(t * 1000);
    filtres.push(`[${k + 2}:a]volume=${n === 'ding' ? 0.4 : 0.35},adelay=${ms}|${ms}[e${k}]`);
    return `[e${k}]`;
  });
  filtres.push(`[v1][napd]${sfx.join('')}amix=inputs=${2 + sfx.length}:normalize=0:duration=first,alimiter=limit=0.95[out]`);
  await exec(FFMPEG, ['-y', '-v', 'error', ...entrees, '-filter_complex', filtres.join(';'), '-map', '[out]', '-ar', '44100', sortie]);
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

// ---------- Ressources ----------

/** Captures en direct (captures.js) si présentes, sinon les images fixes de accounts.json. */
function ressources(m) {
  const fixesM = (m.images || []).map((i) => i.fichier);
  const fixesD = m.desktops || [];
  try {
    const dossier = 'img/prordv/live';
    const idx = JSON.parse(fs.readFileSync(path.join(RACINE_MOTION, dossier, 'index.json'), 'utf8'));
    const mobiles = idx.captures.filter((c) => c.mobile).map((c) => `${dossier}/${c.mobile}`);
    const desktops = idx.captures.filter((c) => c.desktop).map((c) => `${dossier}/${c.desktop}`);
    return { mobiles: [...mobiles, ...fixesM], desktops: desktops.length ? desktops : fixesD };
  } catch {
    return { mobiles: fixesM, desktops: fixesD };
  }
}

// ---------- Production ----------

async function produireMotion(compte, format, sujetsRecents, opts, dossier, video) {
  let script;
  if (opts.mock) script = { ...scriptDeTest(compte), fournisseur: 'mock' };
  else {
    const { json, fournisseur } = await genererJSON(prompt(compte, format, sujetsRecents, planScenes()));
    script = { ...valider(json, compte), fournisseur };
  }
  const m = compte.motion;
  const { mobiles, desktops } = ressources(m);
  const images = mobiles.map((f) => ({ fichier: f, statusBg: '#ffffff' }));
  const tourne = (liste, n, depart) => Array.from({ length: n }, (_, k) => liste[(depart + k) % liste.length]);
  let nImg = Math.floor(Math.random() * Math.max(1, mobiles.length));
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
      const im = images[nImg++ % images.length];
      sc.image = im.fichier;
      sc.statusBg = im.statusBg;
    }
    if (s.type === 'carrousel') { sc.images = tourne(mobiles, 3, nImg); nImg += 3; }
    if (s.type === 'mur') sc.images = tourne(mobiles, Math.min(12, mobiles.length), nImg);
    if (s.type === 'navigateur') sc.image = desktops[nTel++ % desktops.length];
    if (s.type === 'metiers') sc.metiers = m.metiers;
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
    marqueTexte: compte.marque,
    logo: fs.readFileSync(path.join(RACINE_MOTION, m.logo), 'utf8'),
    scenes: scenes.map(({ audio, ...s }) => s),
    mots,
  };
  const muette = path.join(dossier, 'muette.mp4');
  const audio = path.join(dossier, 'audio.wav');
  await rendre(data, muette);
  await assemblerAudio(scenes, dossier, audio);
  const mix = path.join(dossier, 'mix.wav');
  try {
    await mixer(audio, scenes, t, dossier, mix);
  } catch (e) {
    console.warn('  ⚠ bruitages ignorés :', e.message.split('\n')[0]);
    fs.copyFileSync(audio, mix);
  }
  await exec(FFMPEG, ['-y', '-v', 'error', '-i', muette, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
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

module.exports = { produireMotion, couper, planScenes };
