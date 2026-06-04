# STATUS.md — BiDash
_Mis à jour : 03/06/2026_

## Épisode « évolutions UX » (en cours, démarré 04/06)
Demandes : totaux+N-1 partout, Full par défaut + filtres de vue, **sélecteur de dates N/N-1** (calendrier)
à la place des presets, dimension Global/France/Inter (déjà OK), **PDF luxe**, KPI compact + détail CA,
suivi temporel N-1 + granularité (heure/jour/semaine) + courbes panier/trafic, manquants triés CA N-1,
saison via DROP (saisonnier P1/P2/P3 vs permanent PER), cross-canal famille-first + N-1, séparer
annulations(OMS)/retours(import). Lots : A Navigation&Cadence · B N-1&totaux · C Pilotage&Temporel ·
D Offre/Cross-canal/Qualité · E PDF luxe.
- ✅ **Camembert Entrepôt/SFS/Marketplace retiré** (f476bbf).
- ✅ **Lot B livré** (ac6b506) : N-1 + totaux + « meilleurs N-1 perdus » sur canaux, device, trafic,
  funnel GA, funnel produit, campagnes, campagne→landing, pages×source. ⚠ Nécessite un « Rafraîchir GA4 »
  (nouveaux champs sessions/revenu/pays/N1 ; `fetchPagesBySource` passe en landingPage+sessions).
- ✅ **Correctif imports** (1130d15) : la perte de fichiers vient de la **mémoire serveur perdue**
  (mode sans base : Render redéploie/veille → RAM vidée ; aucun code ne supprime le store). Ajout
  d'un **bandeau de mode** (persistance/mémoire) + **resync du statut** quand le rapport est vide
  (fin de la contradiction « statut chargé » vs « aucun fichier »). **Correction durable = `DATABASE_URL` (Neon).**
- ✅ **Lot A livré** (1130d15) : vue **Full par défaut** + en tête ; barre « Vue » (filtre) ;
  **sélecteur de dates N (début/fin) + N-1 (début/fin)** avec calendriers à la place de la cadence,
  bouton « Tout » ; `buildReport`/PDF acceptent une plage N-1 explicite (cfrom/cto) ; période
  découplée de la vue ; dimension Global/France/International déjà en place.
- ✅ **Lot C livré** (9f9ef99) : **Pilotage 360** = carte unique 2 colonnes (KPI compact + détail CA
  Global/EShop/FR/Inter) ; **Suivi temporel** = N-1 superposé + granularité **Heure/Jour/Semaine**
  (auto ; heure via colonne OMS « Heure ») + 2ᵉ courbe **Trafic (sessions N/N-1) & taux d'ajout panier**.
  Serveur : `gaDailyMetrics`, `dailySeries` enrichi (carts/addRate), `hourlySeries`, `rep.dailyN1`/`rep.hourly`.
- ✅ **Connecteur WSHOP finalisé** (11771d9) : auth (login→JWT 1h), `POST /api/v1/orders/get`
  (created_from/created_to, pagination page/limit), `orderToRows` (anonymisé) → dataset OMS standard.
  Vérifié sur l'exemple de la doc (KPI, dimension FR/Inter, annulations). Config :
  `WSHOP_INSTANCE/USER/PWD` (+ PREPROD/MONTHS). **À valider sur données réelles** : format exact
  `Ref. externe` (RC) + classification canal/marketplace (libellés magasin WSHOP).
- ✅ **Refresh API ciblé période** (aab64d9) : GA4 & WSHOP `refresh(opts)` n'appellent l'API que
  sur la fenêtre sélectionnée (N→oms-N, N-1→oms-N1) ; raccourcis Hier/7j/30j/Mois (remplissent N+N-1).
  Règle les timeouts WSHOP (plus de fetch 24 mois). + robustesse : retries 5xx, refresh GA4 résilient.
- ✅ **Sources auto + saison** (e4c5b14, c5049ff) : référentiel + implantation E26/E25 chargés au
  boot depuis specs/ ; retours via WSHOP (orderRefund) ; import manuel réduit à OMS+Y2.
  **Filtre Périmètre Collection** (scope=collection → produits implantation) ; saisonnier/permanent
  via **DROP** (P*/PER) ; manquants triés CA N-1 ; présélections **Saison Été/Hiver** (fenêtre longue éditable).
- ✅ **Lot D complet** (7aa1172) : cross-canal famille-first + famille Δ N-1 + « best par canal en N-1 » ;
  Qualité = annulations EShop (OMS) vs retours clients (WSHOP) clairement distingués.
- ⏭️ Restent : **Lot E (PDF luxe)**. + activer Neon. + dates de saison configurables/mémorisées (option).
  + endpoint WSHOP retours détaillés (raisons/produit) si dispo.

## Objectif de la prochaine session
Réorg modules + Neon + **P1→P5** livrés (épisode analytique complet). **Reste** :
- **Moteur de reco stratégique** C/M/L terme (API Claude), vitrine = module Direction.
- ⚠️ À valider en réel via **« Rafraîchir GA4 »** : P4 (campagnes UTM) + P5 (GA filtré par pays).
  Les fetchs GA portent désormais la dimension `country` ; non testés sans creds en dev.

Taxonomie thèmes (A→H) définie dans `web/app.js` (THEME_OF/THEME_META) : Pilotage, Temporel, Acquisition,
Conversion, Comportement, Offre, Omnicanal, International, Qualité.

⚙️ **Action à faire pour activer la persistance** : créer un projet gratuit sur **neon.tech**,
copier la *connection string*, la poser en variable `DATABASE_URL` dans Render. Tant qu'elle est
absente, l'app tourne en mémoire (aucune régression).

---

## Session du 04/06/2026 (suite) — P5 : International vs N-1 ✅
- ✅ Module **International** : bascule auto `dim=inter` (modules sans `dim` → retour global) ;
  layout enrichi (kpi/ca/daily/channels/campaigns/gafunnel/device/landing/pages/lostpages/pays/ttpays).
- ✅ `ga4.js` : dimension **`country`** ajoutée aux fetchs landing/pages/pagesrc/campaigns/campaignLanding.
- ✅ `reports.js` : tous les builders GA agrégés **après filtre pays** (`keepGeoRow`, selon dimension) ;
  repli pass-through si données anciennes sans pays → global/FR/international cohérents partout.
- ✅ Vérifié OMS réel : inter = 284 k€ (hors France, top Royaume-Uni) vs global 950 k€. Tests OK.
- ⚠️ Chemin GA géo à valider via « Rafraîchir GA4 » (non testable sans creds en dev).

---

## Session du 04/06/2026 (suite) — P4 : GA approfondi vs N-1 ✅
- ✅ `ga4.js` : `fetchCampaigns` (sessionCampaignName) + `fetchCampaignLanding` (campagne×landingPage)
  → datasets `gacampaigns` (N/N1) et `gacampaignland` (N).
- ✅ `reports.js` : `campaigns` (sessions/achats/conv/revenu vs N-1), `lostPages`/`newPages`
  (pages fortes N-1 disparues / nouvelles, via `gapages`), `campaignLanding` (landing principale + conv/campagne).
- ✅ Carte **landing enrichie** (conv N vs N-1 + Δ) ; nouvelles cartes **campaigns** (thème Acquisition),
  **lostpages** (Comportement), **campaignland** (Acquisition) + recos auto. Modules GA dédié + Full.
- ✅ Rendu gracieux sans GA (blocs null). Syntaxe + tests OK.
- ⚠️ Non testé en réel (pas de creds GA4 dans l'env de dev) : à valider via « Rafraîchir GA4 » en prod ;
  fetchs calqués sur les fetchs GA4 existants (dimensions/métriques valides : sessionCampaignName, landingPage…).

---

## Session du 04/06/2026 (suite) — P3 : Analyse cross-canal produit ✅
- ✅ **Règle Y2 réf unifiée** : `Code article`[0..13] + `-` + couleur (1er token `LIBDIM2`) → format RC
  (validé volume : `0PVE01-V4040900P` + `159 CAJUN` → `0PVE01-V40409-159`, matche l'OMS).
- ✅ `Y2_ALIASES` étendu (code/libdim2/qte) ; `calc.calcCrossChannel` + classifieurs canal :
  OMS magasin/type paiement → EShop/Boutiques/GL/Printemps ; Y2 établissement → PDT/Lulli/GL.
- ✅ Carte **`crosschannel`** (thème Omnicanal) : totaux/Δ N-1 par canal, **matrice produit × canal**,
  **famille × canal**, **recommandations** d'arbitrage (fort EShop/absent MP & inversement).
  Famille via référentiel + implantation. Modules Omnicanal + Full.
- ✅ Vérifié OMS+Y2 réels : 6 canaux (EShop 680k, Boutiques 202k, GL 176k, PDT 103k, Lulli 95k, Printemps 41k).
- ℹ️ Δ vs N-1 actif si OMS N-1 + Y2 N-1 chargés.

---

## Session du 04/06/2026 (suite) — P2 : Comparaison de saison (Implantation E26 vs E25) ✅
- ✅ Source **`impl`** (dépôt Implantation N=E26 / N-1=E25). Parsing xlsx **direct** (`sheet_to_json`,
  `raw:false`) → corrige la corruption des en-têtes multi-lignes (ex. `Suivi Visuels\nTrafic`) qui
  cassait l'ancien round-trip CSV (et fiabilise tous les xlsx oms/y2/ref au passage).
- ✅ `calc.calcSeasonCompare(implN, implN1, salesRef)` : largeur d'offre par famille (modèles +
  variantes), **nouveautés / permanents / manquants** par REFERENCE, **bests / slowers / non-vendus**
  via jointure ventes EShop (`Ref. externe` = RC). Noms produits : OMS désignation, repli E25.
- ✅ Carte **`saisoncompare`** (thème Offre) + reco auto ; module **Saison** recentré dessus ; ajout au Full.
- ✅ Vérifié sur fichiers réels : 449 modèles E26 vs 459 E25, 306 nouveautés, 143 permanents,
  316 sortis ; bests/manquants correctement nommés.
- ℹ️ Bests/slowers = ventes EShop (OMS, hors marketplace). N-1 ventes possible si OMS N-1 chargé (à étendre en P3).

---

## Session du 04/06/2026 — Réorg : module Full, dépôt sans GA, sections thématiques (P1) ✅
- ✅ Module **🔬 Full** (toutes analyses) ; **bloc GA retiré du dépôt** (GA = API uniquement)
- ✅ **Sections thématiques** dans le rapport : taxonomie A→H (THEME_OF/THEME_META/THEME_ORDER),
  bandeaux de section masqués si <2 sections ; ordre de thèmes global (récit cohérent inter-modules)
- ✅ Nouveaux modules **🏬 Omnicanal** (kpi/marketplace/ca/famille/produits) et **🌍 International** (kpi/pays/ttpays)
- ✅ CSS : `#report` flex+gap, `.section-head`
- 100 % front ; calculs serveur inchangés ; tests OK
- ➡️ Suite : P2→P5 (cf. objectif prochaine session) — fichiers Implantation/Y2 analysés et règles validées

---

## Session du 03/06/2026 (suite) — Persistance Postgres optionnelle (Neon) ✅
Objectif : tuer la corvée de re-dépôt des fichiers + objectifs partagés + comptes équipe.
- ✅ **`server/db.js`** : couche Postgres activée seulement si `DATABASE_URL` est définie (require `pg` paresseux,
  TLS par défaut Neon, `sslmode=disable` géré pour le local). Tables créées au boot (idempotent).
- ✅ **Store hybride** (`store.js`) : la RAM reste la source vive (interface synchrone inchangée) ;
  **hydratation au démarrage** depuis la base + **écriture en double** (write-through) à chaque dépôt.
  → fichiers restaurés automatiquement après veille/redémarrage Render.
- ✅ **Objectifs partagés** (`objectives.js`, `/api/objectives`) : en base si dispo, sinon mémoire.
  Le module GA lit/écrit via l'API (plus de localStorage).
- ✅ **Comptes équipe** (`auth.js`) : table `users` (hash scrypt + sel, rôle admin/user, actif/inactif).
  Admin env (`ADMIN_USERNAME/PASSWORD`) conservé comme bootstrap/secours. Endpoints CRUD `/auth/users`
  (admin only). Panneau **« 👥 Comptes équipe »** dans l'UI (visible admin + base active).
- ✅ **Repli total sans base** : vérifié (report 200, objectifs RAM, `/auth/users` → 400 explicite).
- ✅ **Chemin base vérifié** en local (cluster Postgres jetable) : persistance + restauration au
  redémarrage + cycle de vie comptes (créer / désactiver→refus / rôle / supprimer / mauvais mdp→refus).
- ➕ dépendance `pg` ; `.env.example` documenté pour Neon.

---

## Session du 03/06/2026 (suite) — Segmentation en 6 modules ✅
Objectif : simplifier l'usage (au lieu d'un seul grand tableau qui exige tous les fichiers).
- ✅ **Hub de modules** (1 moteur, 6 vues) : 🎯 Direction (360), ☀️ Quotidien (la veille), 📊 Hebdo (détaillé),
  🧵 Saison (collection, référentiel requis), 🗂️ Annexe (exploration), 🔎 GA dédié (+ objectifs)
- ✅ Chaque module = **layout de cartes dédié** + **liste de fichiers requis/optionnels** avec badges (chargé/manquant)
- ✅ Module GA : **objectifs CA/Sessions/TT** saisis (localStorage) → **% d'atteinte** coloré
- 100 % front (`web/app.js` MODULES + initModules/renderModuleHint/renderObjectives, `app.html`) ; calculs serveur inchangés
- ℹ️ Le PDF reste l'export complet (toutes sections). Persistance + objectifs partagés = à venir avec la base.

---

## Session du 03/06/2026 (suite) — Parcours GA4 enrichi ✅
- ✅ **Funnel e-commerce détaillé** : Sessions → Ajouts panier → Checkout → Achat, avec **taux de passage et déperdition par étape** + conversion globale (métriques GA4 `checkouts`, `ecommercePurchases` ajoutées)
- ✅ **TT par pays** : commandes OMS × sessions GA4 par pays, avec **normalisation des noms FR/EN** (United Kingdom↔Royaume-Uni, etc.)
- ✅ **Pages d'atterrissage × conversion** (GA4 `landingPage`) : sessions, achats, taux de conversion, revenu
- ✅ **Funnel produit** : vues → panier → achat par article (GA4 `itemsViewed/AddedToCart/Purchased`) → diagnostic prix/visuel vs stock/taille
- Implémenté : calc.js (calcGA +checkouts/purchases, ttByCountry + normCountry), ga4.js (fetchLanding/fetchItemFunnel, slots galanding/gaitems), reports/UI/PDF + insights auto ; tests ✅
- ⚠️ Landing + funnel produit alimentés par l'API → nécessite « Rafraîchir GA4 »

---

## Session du 03/06/2026
### Réalisé — Saison + Annulations + Retours
- ✅ **Vue Saison** : CA par saison via le référentiel (Ref. externe → colonne `Saison`), N vs N-1
- ✅ **Annulations** : depuis l'OMS (colonne `Quantité non livré` ≥ 1) — pièces non expédiées, commandes impactées, taux, CA annulé estimé (prorata)
- ✅ **Retours** : nouveau type de fichier (`export_retours_client_produit`) — CA retourné, taux de retour, pièces, nb retours, top raisons, par destination ; PII écartées à l'ingestion (Nom/Prénom client, Responsable)
- Implémenté : `calc.js` (buildSeasonMap, calcBySeason, calcCancellations, calcReturns) + RET_ALIASES + report + UI + PDF + tests ✅ ; nouvelle source `ret` (slots N/N-1)
- Validé end-to-end sur le vrai fichier retours (493 lignes)

### Réalisé — reporting croisé vente × trafic (4 blocs)
- ✅ **Funnel de conversion** Sessions → Commandes → CA + TT + **CA/session** (N vs N-1)
- ✅ **Efficacité par canal** (GA4) : taux de conversion, CA/session, **part trafic vs part revenu**
- ✅ **Suivi quotidien** : graphiques Chart.js (CA & Sessions, puis TT) → détection des chutes de conversion
- ✅ **Mobile vs Desktop** : dimension `deviceCategory` ajoutée à l'appel GA4 → conversion/revenu par device
- Implémenté dans `calc.js` (channelPerf, calcByDevice, dailySeries) + report + UI (Chart.js) + PDF + tests ✅

### Réalisé — mise en prod + CA par pays + connecteur GA4
- ✅ **Application V2 déployée sur Render** (mode sans base) : login, dépôt fichiers, reporting, PDF — testée en prod par Vincent
- ✅ **CA par pays** ajouté (calcul + report + UI + PDF + test) : CA / commandes / panier par pays, hors marketplace, comparaison N-1
- ✅ **Connecteur GA4 API implémenté** (`server/ga4.js`, ADR-007) : service account → sessions/canaux datés → TT fiable par période ; bouton « Rafraîchir GA4 » ; `calcGA` agrège désormais par canal (test ajouté). Property ID 358326945. **Activé en prod** (Data API activée côté Google, 415 lignes N / 381 N-1 sur mai 2026 ; TT live 0,88 % vs 0,93 %).
- 📋 Recommandations business proposées (retours/annulations, CA pays, saison, objectifs, graphiques)

### ⚠️ Sécurité
- La clé du service account GA4 a été partagée en clair dans le chat → **à révoquer et recréer** (rotation), nouvelle clé à déposer uniquement dans Render (Secret File / GA4_SA_KEY).

### Réalisé — bascule mode SANS base de données (ADR-006)
- Déploiement Render bloqué : free tier limité à 1 base gratuite (déjà utilisée)
- Décision : démarrer **sans base**, archiver les reportings via **PDF**
- App basculée en mode mémoire : `server/store.js` (datasets en RAM, partagés, perdus au redémarrage)
- Auth simplifiée : login partagé par env (`ADMIN_USERNAME`/`ADMIN_PASSWORD`), suppression de `db.js`/`users.js`/page admin
- `render.yaml` sans base ; `pg`/`bcryptjs` retirés ; anonymisation à l'ingestion conservée
- Flux validé end-to-end (login → upload OMS avec PII écartées → report → **PDF 200 application/pdf**)

### Réalisé — scaffolding V2
- Application Node/Express + PostgreSQL créée (`server/`, `web/`, `render.yaml`, `package.json`)
- Auth par session cookie + **administration des comptes** (admin crée/active/désactive/supprime, reset MDP) — compte admin seedé depuis `ADMIN_USERNAME`/`ADMIN_PASSWORD`
- Ingestion de fichiers persistée (OMS/Y2/GA/référentiel, slots N/N-1) avec **anonymisation à l'ingestion** (colonnes PII écartées)
- Logique de calcul V1 portée en module pur testé (`server/calc.js` + `calc.test.js` ✅)
- Reportings (quotidien/hebdo/mensuel/YTD/tout) + comparaison N-1, et **export PDF** (pdfkit)
- UI : login, dashboard (KPI EShop, CA, marketplace, familles, GA), page admin
- Cahier des charges V2 complété (F6 export PDF)
- Validé en local : `npm test` OK, smoke-test serveur OK (healthz, auth 401, routes)

### Réalisé — antérieur (même session)
- Récupération de tous les fichiers projet ajoutés au dépôt (specs, ADR, plan de tests, référentiel) + `bidash.html`
- Consolidation de STATUS en un seul fichier markdown
- **Audit complet de `bidash.html`** (2280 lignes) : voir bugs/code mort ci-dessous
- Décisions d'architecture V2 actées (ADR-005)
- Rédaction du **cahier des charges V2** (`specs/cahier-des-charges-v2.md`)
- Mise à jour du CONTEXT (passage en markdown, correction du rôle de Y2, direction V2)
- Conversion en markdown : `CONTEXT.md`, `architecture/decisions.md`
- **Correctifs V1 appliqués** (avant scaffolding V2) :
  - TT (taux de transformation) : sessions désormais résolues par période (`getSessionsForPeriod`) ; affiché « — » + note quand la période filtrée n'est pas datable (export GA par canal). Plus de TT faux.
  - KPIs GA rendus visibles : bandeau Sessions / Utilisateurs / Nvx users / Engagement / Revenu (avec Δ N-1) ajouté dans la carte GA — ces valeurs étaient calculées mais jamais affichées.
  - Code mort supprimé : `renderGA()` (115 l., ciblait des éléments inexistants), `renderKPIs()` (ciblait `#krow`), doublon cassé `runAnnexeAnalysis()`. Diff : +51 / −233 lignes.
  - Calculs cœur inchangés (CA Global/EShop/Marketplace/famille/top produits) → CA Global 916 k€ préservé. Syntaxe JS validée (`node --check`).

### Décisions prises (V2 — cf. ADR-005)
- Hébergement : **Render** (free tier pour démarrer)
- Backend : **Node.js + Express** (réutilise la logique JS de la V1)
- Base de données : **PostgreSQL** (données persistées, pas de re-dépôt par les équipes)
- Sources phase 1 : **dépôt de fichiers uniquement** (API wshop indispo, GA4 API en phase 2)
- Auth : comptes + **création/modération d'utilisateurs** par un admin ; tout le monde voit tout
- Confidentialité : **anonymisation à l'ingestion** (aucun PII client en base)
- Calculs V1 conservés et portés côté serveur

### Audit V1 — bugs et code mort identifiés
- 🔴 `renderGA()` jamais appelé + cible `#ga-section`/`#ga-content` inexistants → cartes KPI GA et graphe GA jamais affichés (seul `renderGACanaux` l'est)
- 🟠 TT (taux de transformation) faux en sous-période : `getTotalSessions` somme tout le fichier GA (pas de filtre date)
- 🟡 `renderKPIs()` mort (cible `#krow` inexistant)
- 🟡 `runAnnexeAnalysis()` défini 2× (les deux morts ; le 2e référence `res` inexistant)
- 🟡 Onglets header OMS/Y2/GA décoratifs (aucun handler)
- 🟡 Incohérence CA Global (exclut gl.com+printemps mais inclut La Redoute+24S) vs spec (CA Global = CA EShop + CA Marketplace)
- 🟡 GA lu en windows-1252 alors que GA4 exporte en UTF-8 ; GA en .xlsx casserait le parser

### Points ouverts
- 🔲 Choix : nettoyer/figer la V1 en parallèle, ou tout miser sur la V2 ?
- 🔲 Premier compte admin + URL Render
- 🔲 API wshop bloquée (autorisation requise)
- ⚠️ Caveats Render free : cold start, expiration Postgres gratuit → prévoir sauvegarde

## Backlog priorisé
1. ~~Scaffolding V2 (Node/Express + Postgres)~~ ✅ fait (03/06)
2. ~~Auth + administration des utilisateurs~~ ✅ fait
3. ~~Ingestion persistée + anonymisation~~ ✅ fait
4. ~~Portage des calculs V1 testés~~ ✅ fait
5. ~~Reportings J/hebdo/mensuel + export PDF~~ ✅ fait (vue **saison** restant à brancher)
6. ~~Déployer sur Render~~ ✅ fait (03/06, mode sans base)
7. ~~CA par pays~~ ✅ fait (03/06)
8. ~~Connecteur GA4 API~~ ✅ implémenté ET activé en prod (03/06) — TT fiable
9. ~~Reporting croisé vente × trafic~~ ✅ fait (03/06 : funnel, efficacité canal, suivi quotidien, device)
10. ~~Vue saison~~ ✅ fait (03/06, via référentiel)
11. ~~Retours & annulations~~ ✅ fait (03/06)
12. **Objectifs / atterrissage** : dépôt d'un fichier objectifs → % d'atteinte, projection
13. Graphiques saison/retours dans l'UI

## Backlog détaillé — amélioration UX & analytique (demandé le 03/06)
### Lot A — Structure & navigation ✅ FAIT (03/06)
- ✅ Vues par cadence **Quotidien / Hebdo / Mensuel / YTD / Tout** : layouts de cartes adaptés (Quotidien = lecture rapide, Mensuel = complet)
- ✅ Dimension **Global / FR / International** sur tout le dashboard (OMS + retours filtrés par pays ; GA FR/Inter via dimension `country` ajoutée à l'appel GA4 + `addToCarts`)
- calc.js : filterDim, filterGADim + tests ; reports/PDF prennent `dim` ; UI : toggles cadence + dimension
- ⚠️ Nécessite un nouveau « Rafraîchir GA4 » pour activer le split pays (sinon note d'avertissement)

### Lot B — Analyses produits ✅ FAIT (03/06)
- ✅ **Top 10 N vs Top 10 N-1** + **produits à reconquérir** (forts N-1, en retrait N, triés par CA perdu)
- ✅ **Plus vendus (CA/qté) vs plus retournés** → rentabilité nette par produit (jointure OMS × retours sur Ref. externe, taux de retour, CA net)
- calc.js : productGap, salesByRef, returnsByRef, productProfitability + tests ; UI 2 cartes ; PDF 2 sections

### Lot C — Enrichissement GA ✅ FAIT (03/06)
- ✅ **Ajouts panier** (addToCarts) + **micro-funnel** Sessions → Panier → Commande (taux ajout panier, panier→commande)
- ✅ **Top pages vues** N vs N-1 (appel GA4 `pagePath` × `screenPageViews`)
- ✅ **Top pages par source** N vs N-1 (`pagePath` × canal)
- ga4.js : helper `post` + fetchPages/fetchPagesBySource, stockés en slots `gapages`/`gapagesrc` ; calcGA agrège addToCarts
- ⚠️ Pages alimentées par l'API uniquement → nécessite « Rafraîchir GA4 »

### Lot D — Visuel & reco ✅ FAIT (03/06)
- ✅ **Graphiques** ajoutés : donut mix CA (Entrepôt/SFS/Mkt), donut sessions par canal, barres CA par famille, barres top produits (+ courbes quotidiennes existantes)
- ✅ **1 tableau = 1 analyse/recommandation** : fonction `ana()` génère un insight (règles) injecté sous chaque carte (KPI, funnel, canaux, device, pays, saison, produits, rentabilité, retours, annulations, pages, marketplace)
- 100 % client (web/app.js + styles.css) ; aucun changement serveur
10. **Retours & annulations** + taux de retour (Statut / TTC négatifs Y2)
11. **Rebrancher une base** (persistance + comptes) dès qu'un slot Postgres est dispo (cf. ADR-006)
12. (Phase 3) Connecteur API wshop
13. ~~Correctifs V1 : dashboard GA, TT, code mort~~ ✅ fait (03/06)
