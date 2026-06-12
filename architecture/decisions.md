# Architecture Decision Records — BiDash
_Toute décision technique doit être enregistrée ici avec date et justification_

---

## ADR-001 — Architecture HTML standalone pour v1

**Date** : 01/06/2026
**Statut** : Accepté (V1)

### Contexte
Besoin d'un outil de BI léger, rapidement opérationnel, sans infrastructure à gérer.

### Décision
BiDash v1 est un fichier HTML unique, exécuté entièrement dans le navigateur. Aucun serveur, aucune base de données.

### Raison
- Déploiement immédiat (double-clic sur le fichier)
- Données sensibles (CA, clients) qui ne quittent jamais le poste
- Pas de maintenance serveur
- Compatible avec le niveau technique de l'utilisateur

### Conséquences
- Pas de persistance des données entre sessions
- Mono-poste, pas de partage entre équipes
- Dépendance CDN pour SheetJS et Chart.js

---

## ADR-002 — SheetJS pour le parsing CSV et XLSX

**Date** : 01/06/2026
**Statut** : Accepté

### Décision
Utilisation de SheetJS (xlsx.js) v0.18.5 depuis CDN Cloudflare.

### Raison
- Seule librairie JS mature capable de parser XLSX côté client
- Gère aussi les CSV (détection de séparateur)

---

## ADR-003 — Chart.js pour la visualisation

**Date** : 01/06/2026
**Statut** : Accepté

### Décision
Utilisation de Chart.js v4.4.1 pour les graphiques.

### Raison
- Léger, sans dépendances, supporte line/bar/doughnut

---

## ADR-004 — Architecture v2 (à définir)

**Date** : 01/06/2026
**Statut** : Remplacé par ADR-005 (03/06/2026)

La v2 devra se connecter directement aux systèmes. Questions ouvertes tranchées dans l'ADR-005.

---

## ADR-005 — Architecture V2 : application web hébergée, multi-utilisateurs, données persistées

**Date** : 03/06/2026
**Statut** : Accepté

### Contexte
La V1 (`bidash.html`) est mono-poste, sans persistance ni partage. Le besoin a évolué :
application accessible **aux équipes** via une URL, **données hébergées et persistées** (pour
éviter de re-déposer les fichiers à chaque consultation), **reportings** quotidien / hebdomadaire /
mensuel / analyse de saison, et à terme des **connecteurs** (GA4 API, API e-commerce).

### Décisions

1. **Hébergement : Render (free tier) pour démarrer.**
   - Démarrage à coût nul. Montée en gamme possible (plan payant) si besoin.
   - Caveats free tier assumés : mise en veille du service après inactivité (cold start ~30 s),
     PostgreSQL gratuit limité dans le temps → prévoir une sauvegarde/migration avant échéance.

2. **Backend : Node.js + Express.**
   - Raison déterminante : **réutilisation directe de la logique de calcul JS de la V1**
     (`calcOMS`, `calcMarketplace`, `calcGA`, parsers CSV/XLSX, règles Full/Off price, marketplace…).
   - Les fonctions de calcul V1 seront extraites en modules « purs » testables, partagés client/serveur.

3. **Persistance : PostgreSQL.**
   - Stocke les jeux de données importés (par source et par période N / N-1) → les équipes
     consultent sans re-déposer. Le dépôt manuel **met à jour** la base.

4. **Sources de données (V2 phase 1) : dépôt de fichiers uniquement.**
   - OMS/wshop (CSV/XLSX), Y2 (XLSX), GA (CSV) — comme les fichiers exemples.
   - **API wshop : hors périmètre immédiat** (autorisation requise, non disponible).
   - **GA4 API : phase ultérieure** (commencer par le dépôt de l'export GA4).

5. **Authentification : comptes utilisateurs avec administration.**
   - Pour l'instant **tout le monde voit tout** (pas de cloisonnement des données).
   - Fonctionnalité de **création / modération d'utilisateurs** par un rôle **admin**
     (créer, activer/désactiver, supprimer un compte ; réinitialiser un mot de passe).
   - Mots de passe **hachés** (bcrypt/argon2). Sessions sécurisées.
   - Rôles fins (direction / e-commerce / magasins) = évolution future, non requise maintenant.

6. **Confidentialité : anonymisation à l'ingestion (privacy by design).**
   - Les exports OMS contiennent du PII client (nom, prénom, email, adresse, téléphone).
   - Aucun de ces champs n'est nécessaire aux reportings.
   - **Règle : à l'import, seules les colonnes utiles aux KPIs sont conservées** ; les colonnes
     PII sont écartées et **ne sont jamais écrites en base**. Réduit fortement le risque RGPD
     lié à l'hébergement cloud.

### Conséquences
- Les données quittent désormais le poste (cloud Render) → revient sur la contrainte « tout côté
  client » de l'ADR-001 ; tradeoff assumé et compensé par l'anonymisation + le contrôle d'accès.
- Nécessite une CI/déploiement Render, des variables d'environnement (DB, secret de session),
  et une gestion des migrations de schéma.
- Reporting déplacé côté serveur (calculs sur données persistées, pas seulement sur fichier courant).

### Périmètre par phases
- **Phase 1** : app Render + Postgres + auth (avec admin/modération) + ingestion fichiers + persistance + portage des calculs V1 + reportings J/S/M/saison.
- **Phase 2** : connecteur GA4 API (import planifié).
- **Phase 3** : connecteur API wshop (dès autorisation).
- **Phase 4** : rôles/permissions fins, alertes, exports.

### Alternatives écartées
- **Python/Flask + Pandas** : obligerait à réécrire la logique métier V1 (perte de réutilisation).
- **Supabase/Firebase (BaaS)** : moins de contrôle sur la logique de calcul serveur ; à reconsidérer si l'auth maison devient lourde.
- **VPS / serveur interne** : plus souple sur la confidentialité mais coût et administration immédiats — reporté (Render d'abord).

---

## ADR-006 — Démarrage SANS base de données (mode mémoire + archivage PDF)

**Date** : 03/06/2026
**Statut** : Accepté (intérimaire — remplace partiellement ADR-005 tant qu'aucune base n'est branchée)

### Contexte
Au déploiement Render, la création de la base PostgreSQL gratuite a échoué :
**« cannot have more than one active free tier database »** (le compte Render a déjà une base
gratuite active ; le free tier en autorise une seule). Décision de l'utilisateur : démarrer
**sans base**, et utiliser **l'export PDF pour archiver** les reportings.

### Décision
- **Pas de PostgreSQL** pour l'instant. Les jeux de données déposés sont stockés **en mémoire**
  (`server/store.js`), partagés pour l'équipe, **perdus au redémarrage / à la mise en veille** du
  service Render free → re-déposer les fichiers en début de session.
- **Authentification partagée par variables d'environnement** (`ADMIN_USERNAME` / `ADMIN_PASSWORD`),
  sans table users. La **gestion de comptes multi-utilisateurs (ADR-005, point 5) est suspendue**
  jusqu'au retour d'une base.
- **Archivage** des reportings via **export PDF** (déjà en place).
- L'**anonymisation à l'ingestion** (ADR-005 point 6) reste appliquée (données en mémoire dans le cloud).

### Conséquences
- Aucune persistance des données entre sessions ni partage différé : modèle proche de la V1
  (fichiers (re)déposés à chaque session), mais en ligne et multi-postes.
- `render.yaml` ne crée plus de base ; `pg` et `bcryptjs` retirés des dépendances.
- Code structuré pour réactiver la persistance facilement : seules les couches `store` (mémoire) et
  `auth` (env) sont à remplacer par leurs équivalents base de données.

### Retour à la persistance (quand ?)
Dès que possible : libérer la base gratuite existante, OU passer à une base payante, OU réutiliser
une base existante. À ce moment : réintroduire `db.js` (schéma users + datasets), remplacer
`store.js` par des accès SQL, restaurer la gestion de comptes.

### Mise à jour (03/06/2026) — persistance Postgres OPTIONNELLE (Neon)
Persistance réintroduite **sans rendre la base obligatoire** :
- `server/db.js` : activé seulement si `DATABASE_URL` est définie (sinon, comportement mémoire ci-dessus).
  Cible privilégiée : **Neon** (Postgres serverless gratuit, indépendant du free tier Render).
- **`store.js` hybride** plutôt que remplacé : la RAM reste la source vive (interface synchrone
  conservée → calculs inchangés), avec **hydratation au démarrage** + **write-through** vers la base.
  Pas de refacto async des appelants → risque minimal.
- **Comptes** réactivés (table `users`, scrypt+sel, admin/user, actif/inactif) ; l'admin par variables
  d'env demeure comme **bootstrap/secours**. **Objectifs** partagés en base.
- L'anonymisation à l'ingestion reste appliquée avant toute écriture en base.

---

## ADR-007 — Connecteur GA4 via l'API Analytics Data (priorisé)

**Date** : 03/06/2026
**Statut** : Implémenté (`server/ga4.js`) — s'active dès que `GA4_PROPERTY_ID` + clé sont définis dans Render

> Property ID confirmé : **358326945**. Données récupérées : `date` × `sessionDefaultChannelGroup`
> (sessions, activeUsers, newUsers, keyEvents, totalRevenue, engagedSessions, engagementRate) →
> alimente le slot GA avec une colonne Date → **TT fiable par période**. Repli : dépôt de fichier GA.

### Contexte
L'export GA fourni est agrégé **par canal, sans date** → sessions non filtrables par période, TT non
calculable en sous-période. Décision : prioriser une **connexion directe à l'API GA4** pour obtenir
des données datées (jour) et dimensionnées (canal, device, pays).

### Décision
- Utiliser l'**API Google Analytics Data v1** (GA4) en **service account** (auth serveur-à-serveur,
  pas d'OAuth interactif).
- Module `server/ga4.js` : `runReport` avec dimensions `date`, `sessionDefaultChannelGroup`,
  `deviceCategory`, `country` et métriques `sessions`, `activeUsers`, `newUsers`, `keyEvents`,
  `totalRevenue`, `engagementRate`. Le résultat alimente le même `store` que le dépôt GA (slot `ga`).
- Déclenchement : à la demande (bouton « Rafraîchir GA4 ») et/ou planifié ultérieurement.
- Le dépôt de fichier GA reste disponible en repli.

### Configuration (variables d'environnement, jamais dans le repo)
- `GA4_PROPERTY_ID` : identifiant numérique de la propriété GA4
- `GA4_SA_KEY` : clé JSON du service account (en base64 de préférence)

### Prérequis à fournir (côté Vincent / Google)
1. **Property ID GA4** (numérique). _Indice : l'URL GA dans « Accès VB » contient `p358326945` → property `358326945` à confirmer._
2. Un **projet Google Cloud** avec l'**API Google Analytics Data activée**.
3. Un **service account** + sa **clé JSON**.
4. Ajouter l'**email du service account** comme **Lecteur** sur la propriété GA4 (Admin → Accès à la propriété).
5. Me transmettre `GA4_PROPERTY_ID` et la clé (je la configure en variable Render, jamais commitée).

### Conséquences
- Nouvelle dépendance (`@google-analytics/data` ou appel REST + `google-auth-library`).
- Implémentation **non testable sans ces prérequis** → livrée dès réception des accès.
- Secrets gérés via Render uniquement (cohérent avec ADR-005/006).

---

## ADR-008 — Cap produit : moat vertical retail/mode, déterministe (registre de métriques)

**Date** : 12/06/2026
**Statut** : Cadré (vision) — récolte **incrémentale sur la stack actuelle**, sans réécriture

> Clarification : « Solune » dans le doc de vision = la société **Vanessa Bruno** (placeholder erroné).
> Objectif : pousser l'outil ACTUEL au maximum, bien documenté, en vue d'un **test par les équipes VB**
> puis éventuel déploiement dans leur SI. Pas de nouveau produit, pas de réécriture.

### Contexte
Document stratégique reçu (« outil BI déterministe, vertical retail/mode »). Il décrit un moat (sémantique
métier pré-encodée), un registre de métriques central, une couche analytique sans IA, du monitoring, des
scripts RGPD et un scoring qualité. La cible « stack » du doc (React/Tailwind + entrepôt SQL + on-premise)
diverge de l'outil actuel (vanilla JS + Express + store RAM + Postgres optionnel + Render).

### Décision
- **Positionnement** : ne pas concurrencer Power BI sur la largeur, mais sur le *fit* vertical mode +
  déterminisme + possession. Concurrent réel = « Excel + exports manuels ».
- **Déterminisme** : calcul/scoring restent purs (JS/stats), **AUCUN LLM dans la boucle d'analyse**.
  L'IA (reco) reste opt-in = **génération de texte à partir de chiffres déjà calculés**, hors boucle
  numérique (re-cadrer le wording ; jamais « insights chiffrés par IA »).
- **Registre de métriques = pièce centrale** : le concepteur de tableaux compose depuis un catalogue
  **déclaré et versionné** (jamais de SQL libre / colonnes brutes). Évolution du catalogue `W_METRICS/W_DIMS`
  vers un registre formel (id, family, unit, grain, higher_is_better, baseline, test de signif).
- **Stack** : on **garde l'existant**. Réécriture React/Tailwind + entrepôt SQL = jalon « productisation »
  **différé**, déclenché seulement si déploiement dans le SI VB confirmé.

### Récolte incrémentale (sans réécriture, valeur immédiate)
- Couche déterministe : **test de significativité** (z-test de proportion → ne plus afficher le bruit comme
  signal), **décomposition de variance** (CA = trafic × TT × panier), décomposition de funnel, détection Simpson.
- **Scoring qualité de données** (complétude/validité/unicité/cohérence/fraîcheur) + drill-down lignes fautives.
- Élargir le moat §2 **au fil des données débloquées** (cf. backlog data `STATUS.md`).

### Conséquences
- Le concepteur de tableaux (palier 1 livré) deviendra un **consommateur du registre formel**.
- Métriques **cohorte/client bloquées par le design anti-PII** (ADR-005) tant qu'un **ID client pseudonymisé
  (hash stable, sans PII)** n'est pas introduit → décision RGPD à acter séparément.
- Métriques **marge/stock bloquées** par l'absence de fichiers coût/stock (backlog data).
