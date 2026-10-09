/**
 * Dessine les slides 1080x1920 en PNG.
 * Zones sûres TikTok : rien d'important dans les 200 px du haut,
 * les 420 px du bas (légende) ni les 150 px de droite (boutons).
 */
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const L = 1080;
const H = 1920;
const MARGE_G = 80;
const LARGEUR_TEXTE = L - MARGE_G - 170;
const HAUT = 250;
const BAS = H - 440;

let policesChargees = false;
function chargerPolices() {
  if (policesChargees) return;
  const fs = (pkg, fichier) => path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files', fichier);
  // Sous-ensemble latin seulement (accents français et œ inclus) : enregistrer
  // aussi latin-ext sous le même nom fait perdre les glyphes.
  GlobalFonts.registerFromPath(fs('anton', 'anton-latin-400-normal.woff2'), 'Anton');
  for (const poids of [500, 700]) {
    GlobalFonts.registerFromPath(fs('archivo', `archivo-latin-${poids}-normal.woff2`), 'Archivo');
  }
  policesChargees = true;
}

function rgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function decouper(ctx, texte, largeur) {
  const lignes = [];
  let ligne = '';
  for (const mot of texte.split(/\s+/)) {
    const essai = ligne ? ligne + ' ' + mot : mot;
    if (ctx.measureText(essai).width <= largeur || !ligne) ligne = essai;
    else { lignes.push(ligne); ligne = mot; }
  }
  if (ligne) lignes.push(ligne);
  return lignes;
}

/** Plus grande taille de police où le texte tient dans la boîte. */
function ajuster(ctx, texte, { police, max, min, largeur, maxLignes, interligne }) {
  for (let taille = max; taille >= min; taille -= 4) {
    ctx.font = police(taille);
    const lignes = decouper(ctx, texte, largeur);
    const tropLarge = lignes.some((l) => ctx.measureText(l).width > largeur);
    if (lignes.length <= maxLignes && !tropLarge) return { taille, lignes, hauteur: lignes.length * taille * interligne };
  }
  ctx.font = police(min);
  const lignes = decouper(ctx, texte, largeur);
  return { taille: min, lignes, hauteur: lignes.length * min * interligne };
}

function grain(ctx, theme) {
  const clair = luminance(theme.bg) > 0.5;
  ctx.fillStyle = clair ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 9000; i++) {
    ctx.fillRect(Math.random() * L, Math.random() * H, 2, 2);
  }
}

function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

async function fond(ctx, theme, image) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, L, H);
  if (image) {
    try {
      const img = await loadImage(image);
      const echelle = Math.max(L / img.width, H / img.height);
      const w = img.width * echelle;
      const h = img.height * echelle;
      ctx.drawImage(img, (L - w) / 2, (H - h) / 2, w, h);
      // Voile pour garder le texte lisible, plus dense là où est le texte.
      const voile = ctx.createLinearGradient(0, 0, 0, H);
      voile.addColorStop(0, rgba(theme.bg, 0.55));
      voile.addColorStop(0.45, rgba(theme.bg, 0.78));
      voile.addColorStop(1, rgba(theme.bg, 0.95));
      ctx.fillStyle = voile;
      ctx.fillRect(0, 0, L, H);
    } catch {
      // Image illisible : on garde le fond uni.
    }
  } else {
    // Halo discret de la couleur d'accent en haut à droite.
    const halo = ctx.createRadialGradient(L * 0.85, H * 0.12, 0, L * 0.85, H * 0.12, 900);
    halo.addColorStop(0, rgba(theme.accent, 0.22));
    halo.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, L, H);
  }
  grain(ctx, theme);
}

function entete(ctx, compte, index, total) {
  const { theme } = compte;
  // Barre de progression segmentée, façon story.
  const y = 200;
  const espace = 10;
  const seg = (L - MARGE_G * 2 - espace * (total - 1)) / total;
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i <= index ? theme.accent : rgba(theme.text, 0.18);
    ctx.fillRect(MARGE_G + i * (seg + espace), y, seg, 6);
  }
  ctx.font = '700 30px Archivo';
  ctx.fillStyle = theme.muted;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(compte.handle.toUpperCase(), MARGE_G, y - 28);
}

function dessinerLignes(ctx, lignes, x, y, taille, interligne) {
  lignes.forEach((l, i) => ctx.fillText(l, x, y + taille + i * taille * interligne));
}

async function dessinerSlide({ compte, slide, index, total, image }) {
  chargerPolices();
  const canvas = createCanvas(L, H);
  const ctx = canvas.getContext('2d');
  const { theme } = compte;
  const estHook = index === 0;
  const estCTA = index === total - 1;

  await fond(ctx, theme, image);
  entete(ctx, compte, index, total);

  const titre = slide.titre.toUpperCase();
  const blocTitre = ajuster(ctx, titre, {
    police: (t) => `${t}px Anton`,
    max: estHook ? 190 : 130,
    min: 64,
    largeur: LARGEUR_TEXTE,
    maxLignes: estHook ? 5 : 4,
    interligne: 1.02,
  });
  let blocTexte = null;
  if (slide.texte) {
    blocTexte = ajuster(ctx, slide.texte, {
      police: (t) => `500 ${t}px Archivo`,
      max: 54,
      min: 36,
      largeur: LARGEUR_TEXTE,
      maxLignes: 5,
      interligne: 1.32,
    });
  }

  const numeroH = !estHook && !estCTA ? 230 : 0;
  const ecart = 48;
  const hauteurTotale = numeroH + blocTitre.hauteur + (blocTexte ? ecart + 24 + blocTexte.hauteur : 0) + (estCTA ? 190 : 0);
  // Hook : bloc centré verticalement. Autres : ancré en haut de la zone sûre, un peu plus bas.
  let y = estHook ? HAUT + (BAS - HAUT - hauteurTotale) / 2 : Math.max(HAUT + 120, HAUT + (BAS - HAUT - hauteurTotale) * 0.45);

  if (numeroH) {
    ctx.font = '260px Anton';
    ctx.fillStyle = theme.accent;
    ctx.fillText(String(index).padStart(2, '0'), MARGE_G - 6, y + 220);
    y += numeroH;
  }

  ctx.fillStyle = theme.text;
  ctx.font = `${blocTitre.taille}px Anton`;
  dessinerLignes(ctx, blocTitre.lignes, MARGE_G, y, blocTitre.taille, 1.02);
  y += blocTitre.hauteur;

  if (blocTexte) {
    y += ecart;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(MARGE_G, y - 4, 96, 8);
    y += 24;
    ctx.fillStyle = rgba(theme.text, 0.86);
    ctx.font = `500 ${blocTexte.taille}px Archivo`;
    dessinerLignes(ctx, blocTexte.lignes, MARGE_G, y, blocTexte.taille, 1.32);
    y += blocTexte.hauteur;
  }

  if (estCTA) {
    // Pastille avec le lien, seule zone pleine couleur de la vidéo.
    y += 70;
    ctx.font = '700 48px Archivo';
    const lien = compte.lien;
    const w = ctx.measureText(lien).width + 96;
    ctx.fillStyle = theme.accent;
    rondRect(ctx, MARGE_G, y, w, 104, 52);
    ctx.fill();
    ctx.fillStyle = luminance(theme.accent) > 0.55 ? '#111111' : '#FFFFFF';
    ctx.fillText(lien, MARGE_G + 48, y + 68);
  }

  return canvas.toBuffer('image/png');
}

function rondRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

module.exports = { dessinerSlide, LARGEUR: L, HAUTEUR: H };
