/**
 * Écrit le script d'une vidéo : slides (texte à l'écran), voix off, légende, hashtags.
 */
const { genererJSON } = require('./llm');

const MIN_SLIDES = 5;
const MAX_SLIDES = 7;

function construirePrompt(compte, format, sujetsRecents) {
  const system = `Tu es le scénariste TikTok du compte ${compte.handle} (${compte.marque}).
Persona qui parle : ${compte.persona}
Audience : ${compte.audience}

Tu écris des vidéos courtes en format "slideshow" : chaque slide affiche un titre très court en gros et parfois une phrase en dessous, pendant qu'une voix off lit un texte naturel.

Règles absolues :
- Français simple et oral, adapté à l'Afrique francophone (FCFA, MTN MoMo, Orange Money, WhatsApp quand c'est pertinent).
- N'invente JAMAIS de chiffres, de statistiques, d'études, de témoignages, de clients ou de résultats. Si tu donnes un exemple, présente-le clairement comme un exemple.
- Aucune promesse de gains, aucune garantie de résultat, aucun conseil médical.
- Pas de tiret long (—). Pas d'emoji dans les titres de slides.
- La slide 1 est un HOOK qui arrête le scroll en moins de 2 secondes : une affirmation forte, une question qui pique ou une promesse concrète. Jamais "Dans cette vidéo".
- Ne numérote pas les titres des slides (pas de « 1. », « 2. ») : le numéro est affiché automatiquement.
- La dernière slide est l'appel à l'action : "${compte.cta}".
- Réponds uniquement avec du JSON valide.`;

  const user = `Pilier de contenu (choisis un angle précis et concret dans ce thème) :
${compte.piliers.map((p) => '- ' + p).join('\n')}

Format imposé : ${format.id}. ${format.consigne}

${sujetsRecents.length ? `Sujets déjà publiés, à NE PAS refaire ni paraphraser :\n${sujetsRecents.map((s) => '- ' + s).join('\n')}\n` : ''}
Produis ce JSON :
{
  "sujet": "résumé du sujet en une phrase (sert à éviter les doublons)",
  "slides": [
    {
      "titre": "3 à 7 mots, percutant",
      "texte": "0 à 20 mots en complément, ou chaîne vide",
      "voix": "ce que dit la voix off pendant cette slide, 1 à 2 phrases naturelles, 30 mots max",
      "image": "2 à 4 mots-clés en anglais pour une photo d'illustration"
    }
  ],
  "legende": "légende TikTok : 1 à 2 phrases + une question qui pousse à commenter, 150 caractères max",
  "hashtags": ["5 à 8 hashtags sans #, pertinents et un ou deux larges"]
}
Entre ${MIN_SLIDES} et ${MAX_SLIDES} slides au total, la vidéo complète doit durer 20 à 45 secondes à l'oral.`;

  return { system, user };
}

function nettoyer(texte, max) {
  const t = String(texte || '').replace(/\s*—\s*/g, ', ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
}

function valider(brut, compte) {
  const slides = (Array.isArray(brut.slides) ? brut.slides : [])
    .map((s) => ({
      // Le numéro est déjà dessiné en grand : on retire « 1. », « 2) », « #3 - » du titre.
      titre: nettoyer(String(s.titre || '').replace(/^\s*(?:#|n°\s*)?\d+\s*[.):\-–]\s*/i, ''), 70),
      texte: nettoyer(s.texte, 160),
      voix: nettoyer(s.voix || [s.titre, s.texte].filter(Boolean).join('. '), 260),
      image: nettoyer(s.image, 60),
    }))
    .filter((s) => s.titre);

  if (slides.length < MIN_SLIDES - 1) throw new Error(`Script trop court (${slides.length} slides)`);
  const final = slides.slice(0, MAX_SLIDES);

  const tags = [...new Set([...(brut.hashtags || []), ...compte.hashtags]
    .map((h) => String(h).replace(/[#\s]/g, '').toLowerCase())
    .filter(Boolean))].slice(0, 10);

  return {
    sujet: nettoyer(brut.sujet || final[0].titre, 200),
    slides: final,
    legende: nettoyer(brut.legende, 300),
    hashtags: tags,
  };
}

async function ecrireScript(compte, format, sujetsRecents) {
  const { json, fournisseur } = await genererJSON(construirePrompt(compte, format, sujetsRecents));
  return { ...valider(json, compte), fournisseur };
}

/** Script fixe pour tester le pipeline sans clé IA (--mock). */
function scriptDeTest(compte, format) {
  return {
    ...valider({
      sujet: `Test ${format.id} pour ${compte.id}`,
      slides: [
        { titre: '3 erreurs qui te coûtent des clients', texte: '', voix: 'Trois erreurs qui te coûtent des clients chaque semaine. La deuxième est la plus fréquente.', image: 'african business owner phone' },
        { titre: 'Personne ne te trouve sur Google', texte: 'Ton client cherche, il tombe sur ton concurrent.', voix: 'Un client cherche ton activité sur Google. Il ne te trouve pas, il appelle ton concurrent.', image: 'smartphone google search' },
        { titre: 'Tu réponds trop tard sur WhatsApp', texte: 'Un message sans réponse pendant 3 heures, c\'est un client parti.', voix: 'Tu réponds trop tard sur WhatsApp. Pendant ce temps, le client est déjà parti ailleurs.', image: 'whatsapp chat phone' },
        { titre: 'Pas de prix affichés', texte: 'Les gens n\'osent pas demander.', voix: 'Et tu n\'affiches pas tes prix. Beaucoup de gens n\'osent pas demander et passent leur chemin.', image: 'price list shop' },
        { titre: 'La bonne nouvelle', texte: 'Ces trois erreurs se corrigent en une semaine.', voix: 'La bonne nouvelle, ces trois erreurs se corrigent en une semaine.', image: 'happy entrepreneur africa' },
        { titre: 'Passe à l\'action', texte: compte.cta, voix: compte.cta, image: 'laptop office' },
      ],
      legende: 'Laquelle de ces erreurs tu fais encore ? Dis-le en commentaire.',
      hashtags: [],
    }, compte),
    fournisseur: 'mock',
  };
}

module.exports = { ecrireScript, scriptDeTest, construirePrompt };
