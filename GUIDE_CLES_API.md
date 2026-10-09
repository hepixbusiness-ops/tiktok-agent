# Guide des clés API de l'agent TikTok

Toutes les clés se rangent au même endroit : **GitHub → dépôt `tiktok-agent` → Settings → Secrets and variables → Actions → New repository secret**. Le nom du secret doit être écrit exactement comme indiqué (majuscules comprises).

| Secret | Obligatoire ? | Prix | Sert à |
|---|---|---|---|
| `GEMINI_API_KEY` | Oui (ou une des 2 suivantes) | Gratuit | Écrire les scripts |
| `GROQ_API_KEY` | Secours | Gratuit | Écrire les scripts si Gemini échoue |
| `OPENAI_API_KEY` | Secours | Payant | Dernier secours |
| `PEXELS_API_KEY` | Non | Gratuit | Photos des comptes beauté et barber |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Oui pour publier | Gratuit | Garder les jetons TikTok |
| `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` | Oui pour publier | Gratuit | Envoyer les vidéos sur TikTok |

Les interfaces de ces sites changent souvent : si un bouton n'a pas exactement le nom indiqué, cherche le libellé le plus proche.

---

## 1. Gemini (gratuit, recommandé)

1. Va sur https://aistudio.google.com/apikey et connecte-toi avec `hepixbusiness@gmail.com`.
2. Accepte les conditions si c'est la première fois.
3. Clique **Create API key**, puis choisis un projet Google Cloud (ou laisse-le en créer un).
4. Copie la clé (elle commence par `AIza`).
5. Secret GitHub : `GEMINI_API_KEY`.

Sur l'offre gratuite, 25 vidéos par jour restent largement sous les quotas. Google peut utiliser les échanges de l'offre gratuite pour améliorer ses produits : ici ce sont des scripts publics, ce n'est pas gênant.

## 2. Groq (gratuit, secours)

1. Va sur https://console.groq.com et crée un compte (Google ou email).
2. Menu **API Keys** → **Create API Key**, donne un nom (`tiktok-agent`).
3. Copie la clé tout de suite (commence par `gsk_`, elle ne sera plus affichée).
4. Secret GitHub : `GROQ_API_KEY`.

## 3. OpenAI (payant, facultatif)

Le secret `OPENAI_API_KEY` du dépôt `happi-digital-agent` ne peut pas être relu ni copié : GitHub ne montre jamais la valeur d'un secret.
1. Va sur https://platform.openai.com/api-keys.
2. **Create new secret key**, nom `tiktok-agent`, puis copie la clé (`sk-…`).
3. Vérifie qu'il reste du crédit dans **Billing**.
4. Secret GitHub : `OPENAI_API_KEY`.

## 4. Pexels (gratuit, facultatif)

1. Crée un compte sur https://www.pexels.com.
2. Va sur https://www.pexels.com/api/ → **Your API Key** (ou « Demander l'accès à l'API »).
3. Remplis le petit formulaire (description : « Génération de vidéos TikTok pour mes comptes »).
4. Copie la clé affichée.
5. Secret GitHub : `PEXELS_API_KEY`.

Sans cette clé, les comptes beauté et barber utilisent des fonds de couleur unie.

## 5. Supabase (gratuit)

Les jetons TikTok sont rangés dans le projet Supabase **`salonpro`** (`xtnroafkontdxzctehzg`), dans la table `tiktok_tokens`. Cette table est déjà créée et totalement séparée de l'app ProRDV : seule la clé service_role peut la lire.

1. https://supabase.com/dashboard/project/xtnroafkontdxzctehzg/settings/api (ou **Project Settings → API Keys**).
2. `SUPABASE_URL` = `https://xtnroafkontdxzctehzg.supabase.co`
3. `SUPABASE_SERVICE_KEY` = la clé **service_role** (onglet « Legacy API keys » s'il existe), longue et commençant par `eyJ`. Ne prends pas la clé `anon`.

La clé service_role donne tous les droits sur la base de ProRDV : elle ne doit jamais apparaître dans le site ni dans un message.

`supabase.sql` reste dans ce dépôt pour recréer la table dans un autre projet si besoin.

## 6. TikTok (gratuit)

### 6.1 Créer l'app
1. Va sur https://developers.tiktok.com, connecte-toi et crée un compte développeur si demandé.
2. **Manage apps** → **Connect an app** (ou **Create app**).
3. Remplis la fiche :
   - Nom : `Happi Digital Publisher` ; icône : ton logo (carré, 1024 px conseillé) ; catégorie : Business / Productivité.
   - Description : « Outil interne qui publie des vidéos sur les comptes TikTok de Happi Digital et ProRDV. »
   - Terms of Service URL : `https://pharel.cloud/conditions.html`
   - Privacy Policy URL : `https://pharel.cloud/confidentialite.html`
   - Plateforme : **Web**, URL du site : `https://pharel.cloud`.
4. **Add products** :
   - **Login Kit** → Redirect URI : `https://pharel.cloud/tiktok-callback.html` (exactement, sans `/` final).
   - **Content Posting API** → active aussi **Direct Post** si tu veux la publication 100 % automatique plus tard.
5. **Scopes** : coche `user.info.basic` et `video.upload`. `video.publish` (publication directe) se demande plus tard, dans une 2e soumission.
6. Dans la page de l'app, copie **Client key** et **Client secret**.
7. Secrets GitHub : `TIKTOK_CLIENT_KEY` et `TIKTOK_CLIENT_SECRET`.

Les 3 pages pharel.cloud doivent être en ligne avant cette étape : fusionne d'abord la branche de `happi-digital-agent`.

### 6.2 Tester tout de suite : le Sandbox
1. Dans l'app, bascule sur **Sandbox** → crée un sandbox.
2. **Target users** → ajoute tes 5 comptes TikTok (chaque compte doit accepter l'invitation).
3. Le Sandbox a ses propres Client key et Client secret : utilise ceux-là pendant les tests.

### 6.3 Passer en production
1. Bascule sur **Production** → **Submit for review**.
2. TikTok demande une vidéo de démonstration : filme l'écran pendant que tu lances `node auth.js lien …`, que tu acceptes sur TikTok, puis qu'une vidéo arrive dans la boîte de réception TikTok.
3. Explique l'usage : « Outil interne, publie uniquement sur nos propres comptes. »
4. Après acceptation, remplace les secrets par les clés de production et reconnecte les 5 comptes (6.4).
5. Pour la publication directe en public, il faut en plus l'audit Content Posting API (formulaire dans la même page). En attendant, les publications directes sortent en privé ; le mode `inbox` reste utilisable.

### 6.4 Connecter les 5 comptes (sur ton PC Windows, une fois par compte)

Installe Node.js (https://nodejs.org, version LTS) et Git, puis dans PowerShell :

```powershell
git clone https://github.com/hepixbusiness-ops/tiktok-agent
cd tiktok-agent
npm install

$env:TIKTOK_CLIENT_KEY="ta_client_key"
$env:TIKTOK_CLIENT_SECRET="ton_client_secret"
$env:SUPABASE_URL="https://xtnroafkontdxzctehzg.supabase.co"
$env:SUPABASE_SERVICE_KEY="ta_cle_service_role"

node auth.js lien happi-web
```

1. Dans ton navigateur, connecte-toi à TikTok avec le compte prévu pour `happi-web`.
2. Ouvre le lien affiché et accepte.
3. La page pharel.cloud affiche une commande : copie-la et lance-la dans PowerShell dans les 5 minutes.
4. Message attendu : `✓ Compte happi-web connecté`.
5. Déconnecte-toi de TikTok dans le navigateur, puis recommence avec `happi-ia`, `prordv-pro`, `prordv-beaute` et `prordv-barber`.

Les variables `$env:` disparaissent quand tu fermes PowerShell : c'est voulu, les clés ne restent pas sur ton PC.

---

## Vérifier que tout marche

1. GitHub → `tiktok-agent` → **Actions** → **Happi Digital — Agent TikTok** → **Run workflow**.
2. Premier essai : `publication` = `off`, `comptes` = `happi-web`. Télécharge l'artefact en bas du run et regarde la vidéo.
3. Deuxième essai : `publication` = `inbox`. La vidéo doit arriver dans les notifications TikTok du compte.
4. Le résumé du run indique pour chaque compte si la vidéo est générée, envoyée, ou pourquoi elle ne l'est pas.

| Message dans le résumé | Cause |
|---|---|
| `Aucune clé IA configurée` | Il manque `GEMINI_API_KEY` (ou Groq / OpenAI) |
| `TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET absents` | Secrets TikTok non ajoutés |
| `compte non connecté` | Étape 6.4 pas faite pour ce compte |
| `OAuth TikTok : invalid_grant` | Jeton expiré ou clés sandbox/production mélangées : refais 6.4 |
| `aucune voix off générée` | edge-tts indisponible ce jour-là, la vidéo sort sans voix |
