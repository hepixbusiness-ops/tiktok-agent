# Agent TikTok · Happi Digital & ProRDV

Génère et publie des vidéos slideshow (texte animé + voix off) sur 5 comptes TikTok :
2 pour Happi Digital, 3 pour ProRDV. Réglages des comptes : `accounts.json`.

Les pages exigées par TikTok sont hébergées sur pharel.cloud (dépôt `happi-digital-agent`) :
`confidentialite.html`, `conditions.html` et `tiktok-callback.html`.

Obtenir chaque clé API pas à pas : [GUIDE_CLES_API.md](GUIDE_CLES_API.md).

## Ce qu'il fait, 5 fois par jour (`.github/workflows/tiktok.yml`)

1. Écrit un script par compte avec l'IA (Gemini gratuit, sinon Groq, sinon OpenAI), sans refaire un sujet déjà traité (`history.json`).
2. Dessine 5 à 7 slides 1080x1920 aux couleurs du compte (photos Pexels pour les comptes beauté et barber si `PEXELS_API_KEY` est défini).
3. Ajoute une voix off française gratuite (edge-tts).
4. Monte la vidéo avec ffmpeg.
5. L'envoie sur TikTok via l'API officielle, ou la laisse en téléchargement dans l'onglet Actions (7 jours).

La légende de chaque vidéo s'affiche dans le résumé du run GitHub Actions (lisible depuis l'app mobile GitHub).

## Démarrer sans TikTok (vidéos à télécharger)

1. Ajoute le secret `GEMINI_API_KEY` (gratuit sur https://aistudio.google.com/apikey). `OPENAI_API_KEY` ou `GROQ_API_KEY` servent de secours.
2. Onglet Actions > « Happi Digital — Agent TikTok » > Run workflow, mode `off`.
3. Télécharge le zip `videos-tiktok-…` en bas du run.

Optionnel : `PEXELS_API_KEY` (gratuit sur https://www.pexels.com/api/) pour les photos.

## Brancher TikTok

1. Supabase : la table `tiktok_tokens` existe déjà dans le projet `salonpro` (sinon, exécute `supabase.sql`).
2. https://developers.tiktok.com : crée une app avec :
   - Produits **Login Kit** et **Content Posting API** ;
   - Redirect URI : `https://pharel.cloud/tiktok-callback.html` ;
   - Conditions : `https://pharel.cloud/conditions.html`, confidentialité : `https://pharel.cloud/confidentialite.html` ;
   - Scopes : `user.info.basic`, `video.upload` (ajoute `video.publish` plus tard pour la publication directe, et lance alors `auth.js` avec `TIKTOK_SCOPES=user.info.basic,video.upload,video.publish`).
   - En **Sandbox**, ajoute tes 5 comptes TikTok comme utilisateurs de test pour essayer tout de suite.
3. Secrets GitHub de ce dépôt : `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
4. Pour chaque compte, sur ton PC (mêmes variables + `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) :
   ```
   node auth.js lien happi-web
   # ouvre le lien connecté au bon compte, accepte, puis copie la commande affichée :
   node auth.js code happi-web <CODE>
   ```

### Modes de publication (`publication` dans `accounts.json`)

- `inbox` (par défaut) : la vidéo arrive dans les notifications TikTok du compte ; tu ajoutes un son tendance, colles la légende et publies. TikTok limite le nombre de brouillons en attente : publie-les au fil de la journée.
- `direct` : publication 100 % automatique, signalée « contenu IA ». Tant que l'app n'a pas passé l'audit TikTok, les vidéos sortent en privé.
- `off` : vidéo générée seulement.

## Tester en local

```
npm install
node run.js --mock --comptes happi-web   # sans clé IA, sans voix
node run.js --sans-publier               # vrai script IA, pas d'envoi
```
Les fichiers sortent dans `out/`. Nécessite ffmpeg, et `pipx install edge-tts` pour la voix.

**À vérifier :** les handles (`@pharel.happi`, `@prordv`…) dans `accounts.json` sont des propositions ; mets les vrais noms de tes comptes.
