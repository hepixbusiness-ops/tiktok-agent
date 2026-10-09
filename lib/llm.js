/**
 * Appel LLM avec repli : Gemini (gratuit) -> Groq (gratuit) -> OpenAI.
 * Le premier fournisseur dont la clé est présente et qui répond gagne.
 */

const FOURNISSEURS = [
  {
    nom: 'gemini',
    cle: 'GEMINI_API_KEY',
    async appeler({ system, user }, cle) {
      // Google retire ses modèles (404) et les surcharge parfois (429/5xx) :
      // on réessaie avec une pause, puis on passe au modèle suivant.
      const modeles = [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest'].filter(Boolean);
      let derniere;
      for (const modele of modeles) {
        for (const pause of [0, 8000, 20000]) {
          if (pause) await new Promise((r) => setTimeout(r, pause));
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${cle}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ role: 'user', parts: [{ text: user }] }],
                generationConfig: { responseMimeType: 'application/json', temperature: 1 },
              }),
            }
          );
          if (res.ok) {
            const data = await res.json();
            return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
          }
          derniere = new Error(`Gemini ${modele} ${res.status}: ${(await res.text()).slice(0, 200)}`);
          if (res.status !== 429 && res.status < 500) break;
        }
      }
      throw derniere;
    },
  },
  {
    nom: 'groq',
    cle: 'GROQ_API_KEY',
    async appeler(prompt, cle) {
      return chatCompatibleOpenAI('https://api.groq.com/openai/v1/chat/completions',
        process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', prompt, cle);
    },
  },
  {
    nom: 'openai',
    cle: 'OPENAI_API_KEY',
    async appeler(prompt, cle) {
      return chatCompatibleOpenAI('https://api.openai.com/v1/chat/completions',
        process.env.OPENAI_MODEL || 'gpt-4o-mini', prompt, cle);
    },
  },
];

async function chatCompatibleOpenAI(url, modele, { system, user }, cle) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cle },
    body: JSON.stringify({
      model: modele,
      temperature: 1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function extraireJSON(texte) {
  const brut = texte.replace(/```(?:json)?/g, '').trim();
  const debut = brut.indexOf('{');
  const fin = brut.lastIndexOf('}');
  if (debut === -1 || fin === -1) throw new Error('Réponse sans JSON');
  return JSON.parse(brut.slice(debut, fin + 1));
}

function fournisseursDisponibles() {
  return FOURNISSEURS.filter((f) => (process.env[f.cle] || '').trim()).map((f) => f.nom);
}

async function genererJSON(prompt) {
  const erreurs = [];
  for (const f of FOURNISSEURS) {
    const cle = (process.env[f.cle] || '').trim();
    if (!cle) continue;
    try {
      const json = extraireJSON(await f.appeler(prompt, cle));
      return { json, fournisseur: f.nom };
    } catch (e) {
      erreurs.push(`${f.nom}: ${e.message}`);
    }
  }
  if (!erreurs.length) {
    throw new Error('Aucune clé IA configurée (GEMINI_API_KEY, GROQ_API_KEY ou OPENAI_API_KEY)');
  }
  throw new Error('Tous les fournisseurs IA ont échoué. ' + erreurs.join(' | '));
}

module.exports = { genererJSON, fournisseursDisponibles };
