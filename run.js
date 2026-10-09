#!/usr/bin/env node
/**
 * AGENT TIKTOK : génère et publie des vidéos slideshow pour chaque compte.
 *
 *   node run.js                       1 vidéo par compte, publication selon accounts.json
 *   node run.js --comptes happi-web   un seul compte
 *   node run.js --nombre 2            2 vidéos par compte
 *   node run.js --sans-publier        génère sans envoyer à TikTok
 *   node run.js --mock                script de test, sans clé IA
 *
 * Variable TIKTOK_PUBLICATION=off|inbox|direct : force le mode pour tous les comptes.
 */
const fs = require('fs');
const path = require('path');
const config = require('./accounts.json');
const { ecrireScript, scriptDeTest } = require('./lib/script');
const { dessinerSlide } = require('./lib/render');
const { voixOff, dureeAudio, dureeLecture, photoPexels, monter } = require('./lib/media');
const { publier } = require('./lib/tiktok');
const { produireMotion } = require('./lib/motion');

const RACINE = __dirname;
const HISTORIQUE = path.join(RACINE, 'history.json');
const SORTIE = path.join(RACINE, 'out');
const MAX_HISTORIQUE = 200;

function lireArgs() {
  const args = process.argv.slice(2);
  const valeur = (nom) => {
    const i = args.indexOf(nom);
    return i === -1 ? null : args[i + 1];
  };
  return {
    comptes: (valeur('--comptes') || process.env.TIKTOK_COMPTES || '').split(',').map((s) => s.trim()).filter(Boolean),
    nombre: Math.max(1, parseInt(valeur('--nombre') || process.env.TIKTOK_NOMBRE || '1', 10)),
    sansPublier: args.includes('--sans-publier'),
    mock: args.includes('--mock'),
  };
}

function lireHistorique() {
  try {
    return JSON.parse(fs.readFileSync(HISTORIQUE, 'utf8'));
  } catch {
    return {};
  }
}

function ecrireHistorique(historique) {
  fs.writeFileSync(HISTORIQUE, JSON.stringify(historique, null, 2) + '\n');
}

/** Format le moins utilisé récemment, pour varier sans hasard pur. */
function choisirFormat(entrees) {
  const recents = entrees.slice(-config.formats.length).map((e) => e.format);
  const libres = config.formats.filter((f) => !recents.includes(f.id));
  const pool = libres.length ? libres : config.formats;
  return pool[Math.floor(Math.random() * pool.length)];
}

function horodatage() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function produireVideo(compte, format, sujetsRecents, opts) {
  if (compte.style === 'motion') return produireVideoMotion(compte, format, sujetsRecents, opts);
  const script = opts.mock ? scriptDeTest(compte, format) : await ecrireScript(compte, format, sujetsRecents);
  const nom = `${compte.id}_${horodatage()}`;
  const dossier = path.join(SORTIE, nom);
  fs.mkdirSync(dossier, { recursive: true });

  const pistes = [];
  let avecVoix = 0;
  for (const [i, slide] of script.slides.entries()) {
    const image = compte.images && !opts.mock ? await photoPexels(slide.image) : null;
    const png = path.join(dossier, `s${i}.png`);
    fs.writeFileSync(png, await dessinerSlide({ compte, slide, index: i, total: script.slides.length, image }));

    const audio = opts.mock ? null : await voixOff(slide.voix, compte.voix, path.join(dossier, `v${i}.mp3`));
    let duree = dureeLecture(slide);
    if (audio) {
      avecVoix++;
      duree = (await dureeAudio(audio)) + 0.35;
    }
    pistes.push({ image: png, audio, duree: Math.max(duree, i === 0 ? 2 : 2.2) });
  }

  const video = path.join(SORTIE, `${nom}.mp4`);
  await monter(pistes, dossier, video);

  const legende = `${script.legende}\n\n${script.hashtags.map((h) => '#' + h).join(' ')}`.trim();
  fs.writeFileSync(path.join(SORTIE, `${nom}.txt`), legende + '\n');
  fs.rmSync(dossier, { recursive: true, force: true });

  const duree = pistes.reduce((s, p) => s + p.duree, 0);
  return { script, video, legende, duree, avecVoix, nom };
}

async function produireVideoMotion(compte, format, sujetsRecents, opts) {
  const nom = `${compte.id}_${horodatage()}`;
  const dossier = path.join(SORTIE, nom);
  fs.mkdirSync(dossier, { recursive: true });
  const video = path.join(SORTIE, `${nom}.mp4`);
  const r = await produireMotion(compte, format, sujetsRecents, opts, dossier, video);
  const legende = `${r.script.legende}\n\n${r.script.hashtags.map((h) => '#' + h).join(' ')}`.trim();
  fs.writeFileSync(path.join(SORTIE, `${nom}.txt`), legende + '\n');
  fs.rmSync(dossier, { recursive: true, force: true });
  return { script: r.script, video, legende, duree: r.duree, avecVoix: r.avecVoix, nom };
}

async function main() {
  const opts = lireArgs();
  const comptes = config.comptes.filter((c) => !opts.comptes.length || opts.comptes.includes(c.id));
  if (!comptes.length) throw new Error(`Aucun compte ne correspond à : ${opts.comptes.join(', ')}`);

  fs.mkdirSync(SORTIE, { recursive: true });
  const historique = lireHistorique();
  const resume = [];
  let echecs = 0;

  for (const compte of comptes) {
    for (let n = 0; n < opts.nombre; n++) {
      const entrees = historique[compte.id] || [];
      const format = choisirFormat(entrees);
      const sujetsRecents = entrees.slice(-40).map((e) => e.sujet);
      const ligne = { compte: compte.id, format: format.id };
      try {
        console.log(`▸ ${compte.id} · format ${format.id}`);
        const v = await produireVideo(compte, format, sujetsRecents, opts);
        Object.assign(ligne, { sujet: v.script.sujet, duree: v.duree.toFixed(1), fichier: path.basename(v.video), legende: v.legende });
        console.log(`  ✓ ${path.basename(v.video)} (${v.duree.toFixed(1)} s, voix ${v.avecVoix}/${v.script.slides.length}, IA ${v.script.fournisseur})`);
        if (!v.avecVoix && !opts.mock) console.warn('  ⚠ aucune voix off générée (edge-tts indisponible ?)');

        const mode = process.env.TIKTOK_PUBLICATION || compte.publication;
        if (opts.sansPublier || opts.mock || mode === 'off') {
          ligne.publication = 'non publiée (fichier seulement)';
        } else {
          const r = await publier({ compteId: compte.id, fichier: v.video, legende: v.legende, mode });
          ligne.publication = r.statut === 'ignore'
            ? `non publiée : ${r.raison}`
            : `${r.statut}${r.confidentialite ? ' (' + r.confidentialite + ')' : ''}${r.detail ? ' : ' + r.detail : ''}`;
          ligne.publish_id = r.publish_id;
          console.log(`  → ${ligne.publication}`);
        }

        if (!opts.mock) {
          historique[compte.id] = [...entrees, {
            date: new Date().toISOString(),
            format: format.id,
            sujet: v.script.sujet,
            publication: ligne.publication,
            publish_id: ligne.publish_id,
          }].slice(-MAX_HISTORIQUE);
          ecrireHistorique(historique);
        }
      } catch (e) {
        echecs++;
        ligne.erreur = e.message;
        console.error(`  ✗ ${compte.id} : ${e.message}`);
      }
      resume.push(ligne);
    }
  }

  ecrireResume(resume);
  if (echecs === resume.length) process.exit(1);
}

/** Résumé lisible dans GitHub Actions (aussi depuis l'app mobile GitHub). */
function ecrireResume(resume) {
  const lignes = ['## Vidéos TikTok du ' + new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' }), ''];
  for (const r of resume) {
    lignes.push(`### ${r.erreur ? '✗' : '✓'} ${r.compte} · ${r.format}`);
    if (r.erreur) {
      lignes.push('Erreur : ' + r.erreur, '');
      continue;
    }
    lignes.push(`**Sujet :** ${r.sujet}  `, `**Durée :** ${r.duree} s · **Publication :** ${r.publication}`, '', 'Légende à copier :', '```', r.legende, '```', '');
  }
  const texte = lignes.join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texte + '\n');
  fs.writeFileSync(path.join(SORTIE, 'LEGENDES.md'), texte + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
