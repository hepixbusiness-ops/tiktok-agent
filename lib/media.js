/**
 * Voix off (edge-tts, gratuit), photos (Pexels, gratuit, optionnel) et montage (ffmpeg).
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const exec = promisify(execFile);
const FPS = 30;

// Binaires ffmpeg/ffprobe fournis par npm (pas d'apt-get, lent sur GitHub Actions) ;
// à défaut, ceux installés sur la machine.
function binaire(pkg, prop, defaut) {
  try {
    const m = require(pkg);
    return (prop ? m[prop] : m) || defaut;
  } catch {
    return defaut;
  }
}
const FFMPEG = process.env.FFMPEG_PATH || binaire('ffmpeg-static', null, 'ffmpeg');
const FFPROBE = process.env.FFPROBE_PATH || binaire('ffprobe-static', 'path', 'ffprobe');

async function dureeAudio(fichier) {
  const { stdout } = await exec(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier]);
  return parseFloat(stdout.trim());
}

/** Génère la voix d'une slide. Renvoie null si edge-tts est indisponible. */
async function voixOff(texte, voix, sortie) {
  try {
    await exec('edge-tts', ['--voice', voix, '--rate=+8%', '--text', texte, '--write-media', sortie], { timeout: 60000 });
    if (!fs.existsSync(sortie) || fs.statSync(sortie).size < 1000) return null;
    return sortie;
  } catch {
    return null;
  }
}

/** Durée de lecture estimée quand il n'y a pas de voix. */
function dureeLecture(slide) {
  const mots = `${slide.titre} ${slide.texte}`.split(/\s+/).length;
  return Math.min(6, Math.max(2.5, mots / 2.8 + 1));
}

const imagesUtilisees = new Set();

/** Photo verticale Pexels pour des mots-clés. Renvoie un Buffer ou null. */
async function photoPexels(motsCles) {
  const cle = process.env.PEXELS_API_KEY;
  if (!cle || !motsCles) return null;
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(motsCles)}&orientation=portrait&per_page=15`;
    const res = await fetch(url, { headers: { Authorization: cle } });
    if (!res.ok) return null;
    const { photos = [] } = await res.json();
    const libres = photos.filter((p) => !imagesUtilisees.has(p.id));
    if (!libres.length) return null;
    const photo = libres[Math.floor(Math.random() * Math.min(5, libres.length))];
    imagesUtilisees.add(photo.id);
    const img = await fetch(`${photo.src.original}?auto=compress&cs=tinysrgb&fit=crop&w=1080&h=1920`);
    if (!img.ok) return null;
    return Buffer.from(await img.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Assemble les slides et leurs voix en MP4 vertical.
 * pistes : [{ image: 'slide.png', audio: 'voix.mp3' | null, duree: secondes }]
 */
async function monter(pistes, dossier, sortie) {
  // 1. Une piste audio par slide, calée exactement sur la durée de la slide.
  const listeAudio = [];
  for (const [i, p] of pistes.entries()) {
    const wav = path.join(dossier, `a${i}.wav`);
    const entree = p.audio ? ['-i', p.audio] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'];
    await exec(FFMPEG, ['-y', '-v', 'error', ...entree, '-af', 'apad', '-t', p.duree.toFixed(3), '-ar', '44100', '-ac', '2', wav]);
    listeAudio.push(`file '${wav}'`);
  }
  const concat = path.join(dossier, 'audio.txt');
  fs.writeFileSync(concat, listeAudio.join('\n'));
  const audio = path.join(dossier, 'audio.wav');
  await exec(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', audio]);

  // 2. Vidéo : léger zoom continu sur chaque slide, puis concaténation.
  const entrees = pistes.flatMap((p) => ['-i', p.image]);
  const filtres = pistes.map((p, i) => {
    const images = Math.round(p.duree * FPS);
    return `[${i}:v]scale=1188:2112,zoompan=z='min(zoom+0.0005,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${images}:s=1080x1920:fps=${FPS},setsar=1[v${i}]`;
  });
  const chaine = pistes.map((_, i) => `[v${i}]`).join('') + `concat=n=${pistes.length}:v=1:a=0[v]`;

  await exec(FFMPEG, [
    '-y', '-v', 'error',
    ...entrees,
    '-i', audio,
    '-filter_complex', [...filtres, chaine].join(';'),
    '-map', '[v]', '-map', `${pistes.length}:a`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-shortest',
    sortie,
  ], { maxBuffer: 1024 * 1024 * 20, timeout: 10 * 60 * 1000 });

  return sortie;
}

module.exports = { voixOff, dureeAudio, dureeLecture, photoPexels, monter, FFMPEG };
