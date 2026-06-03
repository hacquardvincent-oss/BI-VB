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
