# BI-VB — BiDash

Outil de BI e-commerce pour piloter l'activité (CA, marketplaces, trafic) à partir d'exports
wshop (OMS), Y2 et Google Analytics.

Le projet est en **transition V1 → V2** (voir `CONTEXT.md`, `architecture/decisions.md`).

---

## V1 — `bidash.html` (prototype mono-poste)
Application 100 % navigateur, sans serveur. Ouvrir `bidash.html` dans un navigateur, déposer
les fichiers (OMS/Y2/GA + référentiel) dans les emplacements N / N-1. Aucune donnée ne quitte le poste.

## V2 — application web hébergée (Node + Express + PostgreSQL)
Application multi-utilisateurs, données persistées, reportings (quotidien / hebdo / mensuel),
export PDF, déployable sur Render. Voir `specs/cahier-des-charges-v2.md`.

### Lancer en local
```bash
npm install
cp .env.example .env          # renseigner DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET
# PostgreSQL local requis (ou DATABASE_URL d'une base managée)
npm start                     # http://localhost:3000
npm test                      # tests des calculs
```

Au premier démarrage, le compte admin (`ADMIN_USERNAME`, par défaut `Vincent`) est créé avec
`ADMIN_PASSWORD`. **Changer ce mot de passe rapidement.**

### Déployer sur Render
1. Pousser ce dépôt sur GitHub.
2. Sur Render : **New + → Blueprint**, sélectionner le repo (utilise `render.yaml`).
3. Render crée le service web + la base PostgreSQL gratuite.
4. Définir **`ADMIN_PASSWORD`** dans les variables d'environnement du service (non versionné).
5. Ouvrir l'URL fournie, se connecter, déposer les fichiers.

> Free tier Render : le service se met en veille après inactivité (démarrage à froid ~30 s) et la
> base PostgreSQL gratuite a une durée de vie limitée — prévoir une montée en gamme / sauvegarde.

### Confidentialité
À l'ingestion d'un fichier OMS, les colonnes contenant des **données personnelles** (nom, prénom,
email, adresse, téléphone, etc.) sont **écartées** et ne sont jamais stockées en base
(privacy by design, cf. ADR-005).

### Structure
```
bidash.html                 # V1 (référence)
server/                     # backend Node/Express
  index.js  db.js  auth.js  users.js  ingest.js  reports.js  pdf.js
  calc.js                   # logique métier portée de la V1 (fonctions pures)
  calc.test.js
web/                        # UI V2 (login, app, admin)
architecture/decisions.md   # ADR
specs/                      # besoins, cahiers des charges, user stories
CONTEXT.md  STATUS.md       # cadrage et suivi de session
render.yaml                 # blueprint de déploiement Render
```
