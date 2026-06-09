# CLAUDE.md — Mémoire opérationnelle du projet BI-VB

> **À recharger en début de chaque session.** Ce fichier capitalise les **formules de calcul**,
> les **schémas des sources**, les **anomalies résolues** (et pourquoi), et les **conventions**.
> Objectif : re-développer ce type de projet beaucoup plus vite, sans refaire les mêmes erreurs.
> Compléments : `CONTEXT.md` (vision produit), `STATUS.md` (roadmap), `README.md`.

---

## 1. Vue d'ensemble

Outil BI e-commerce (Vanessa Bruno) : reporting **N vs N-1** par module (Pilotage, Suivi temporel,
E-Store, Acquisition, International, Marketplace, Analyses croisées, Offre/Merch). Déployé sur
**Render** (lit la branche `main`). Backend **Node.js/Express**, frontend **vanilla JS + Chart.js**,
PDF via **pdfkit**. Données persistées en mémoire, ou **Postgres si `DATABASE_URL`** (sinon perdues
au redeploy → toujours conseiller de configurer `DATABASE_URL`).

### Fichiers clés
| Fichier | Rôle |
|---|---|
| `server/wshop.js` | Connecteur WSHOP API (OMS, retours, stock, back-in-stock). `orderToRows` = mapping commande→ligne OMS. `/ping` diagnostic. |
| `server/ga4.js` | Connecteur GA4 (sessions, canaux, campagnes, pages, items, heure×canal). |
| `server/calc.js` | **Tout le moteur de calcul** (KPI, CA, annulations, retours, marketplace, familles, COS/ROAS…). + alias de colonnes. |
| `server/reports.js` | `buildReport` : orchestre les datasets → objet `rep` consommé par le front et le PDF. |
| `server/ingest.js` | Import fichiers (projection colonnes canoniques, anti-PII). |
| `server/pdf.js` | Export PDF (sections par type quotidien/hebdo). |
| `web/app.js` | Frontend (rendu cartes, graphes, plan d'action, handlers boutons). |
| `web/app.html` | Structure UI. |

### Composition d'un rapport (front)
`MODULES[module].layout` (liste de clés cartes) → `THEME_OF` (thème par carte) → `sectionize`
(groupe par `THEME_ORDER`, **préserve l'ordre du layout dans chaque thème**) → bannières `THEME_META`.
Pour **réordonner** des cartes d'un même thème : changer l'ordre dans le `layout`.

---

## 2. Sources de données & schémas

### WSHOP API (`/api/v1/...`)
- Auth : `POST /authenticate` → JWT 1h. `apiPost` gère retries + refresh jeton.
- `POST /orders/get` : `created_from`/`created_to` (date création) ou `begin`/`end` (date modif, pour le delta).
  Plafond ~10000 résultats → on découpe la fenêtre en récursif (`collectRange`).
- Commande : `orderId`, `orderDate`, `orderTotal`, `orderCustomerStatus` ⭐, `orderStatus`,
  `orderStoreStatus`, `payment_method.label`, `storeItems.label` (NOM MAGASIN, ex. "ENTREPOT"/"WEBSTORE"),
  `orderOrigin` (in-store/out-store), `orderLocation` (Instore si rempli), `orderItems[]`, `orderRefund[]`,
  `orderSplitIndex` ("1/2"), `shippingAddress.countryCode`.
- **orderItems n'ont AUCUN champ statut.** Champs : `ean, title, reference, color, size, category,
  compareAtPrice, originalUnitPrice, originalUnitPriceNet, originalDiscountedUnitPrice,
  originalDiscountedUnitPriceNet, unitPrice, quantityOrdered, quantityShipped, quantityOffered, …`.
  ⚠️ **`quantityOffered` = quantité OFFERTE (cadeau), PAS « à expédier »** (piège classique, voir §4).
- `orderCustomerStatus` (enum 22 états, **calque les libellés OMS** "Annulée (Stock)", "Expédiée Incomplète"…) :
  `Waiting, Controlling, WaitingDocumentation, CancelledCustomer, CancelledBlacklistUnpaid,
  CancelledBlacklistFraud, CancelledBlacklistDoubtful, Preparation, Late, Shipped, ShippedIncomplete,
  Cancelled, WaitingPayment, CancelledFileDenied, PreparationPartial, ShippedPartial, CancelledInternal,
  ReturnPreparation, PickupStoreProcessed, WaitingValidation, Preorder, SubscriptionRenew`.
  `orderStatus` (8 états back-office : Waiting/Processing/Processed/Cancelled…) **n'a ni Shipped ni
  ShippedIncomplete** → inutilisable pour le détail OMS. **Toujours utiliser `orderCustomerStatus`.**
- Autres endpoints : `/inventory/get` (stock), `/returns/get` (retours produit, `orderItems[].refund`,
  `ean`→ref via inventaire), `/back-in-stock-subscriptions/get` (demande sur ruptures).
- Diagnostic : **`/ping`** expose `statusDistinct`, sondes par statut, `simNonLivrePieces`. ⚠️ Appels WSHOP
  lents (~2 s) → **toujours paralléliser (`Promise.all`) + garde-fou timeout (`Promise.race` ~9 s)** sinon 504 du proxy.

### GA4 API
- `runReport`. Jeu principal `ga` = `date×channel×device×country` (sessions, addToCarts, revenue…).
  ⚠️ **Ce jeu SUR-COMPTE les sessions** (somme multi-dimension). → jeu **`gasess`** (`date×pays`, faible cardinalité)
  pour le **KPI sessions** ET le **TT/jour** (sinon courbes fausses/vides).
- Jeux dédiés : `gacampaigns` (campagne×pays), `gacampdaily` (date×campagne → timeline campagnes),
  `gaemailhour` (heure×canal → heure d'envoi email), `galanding`, `gapagesrc`, `gacampcat`
  (campagne×catégorie = thème payant), `gaitems`/`saisongaitem` (funnel produit).

### Y2 (Marketplace / ERP) & OMS upload
- Y2 : `Total TTC ligne`, `Etablissement ligne doc`, `Commercial du doc`, `Reference interne doc`, `Code article`.
  ⚠️ **Exclure `Total TTC ≤ 0`** (= retours/avoirs) du CA, sinon CA famille négatif.
- OMS colonnes canoniques (cf. `OMS_ALIASES` / `OMS_HDRS`) : Date, Prix de vente paye, Pays livraison,
  NOM MAGASIN, Type Paiement, Numeros, Designation produit, quantites commandees, **Quantité non livré**,
  Ref. externe, Lieu de prise de commande, Prix Vente, Prix Vente Remise, **Statut commande**.

---

## 3. Formules de calcul (le cœur)

### Périmètre & CA
- **Périmètre EShop = Outstore** (exclut Instore = vente vendeur en magasin via `Lieu de prise de commande`).
- **Marketplaces exclus du CA EShop** par le **type de paiement** (`isMkt` : gl.com, printemps, la redoute, 24s) —
  on ne touche PAS aux magasins (ship-from-store = corners physiques, gardés dans le CA).
- **CA = « Prix de vente payé » = `unitPrice × quantityOrdered`** (champ confirmé = PVP de l'export OMS).
- **Full price vs Off price (démarque)** : off price si `Prix Vente Remisé (originalDiscountedUnitPrice)`
  ≠ 0 **ET** ≠ `Prix Vente (originalUnitPrice)`. Sinon full price. (WSHOP encode la démarque dans
  `originalDiscountedUnitPrice`.)
- **CA Global EShop** = FR + International, hors tous marketplaces. **Omnicanal** = Entrepôt (WEBSTORE) + Ship-from-store.

### Annulations (⚠️ historique douloureux, voir §4)
- **Signal = `orderCustomerStatus`** (orderItems sans statut).
- **Taux d'annulation = commandes ANNULÉES ÷ total commandes** (à la commande, pas à la pièce).
- **Comptées comme annulation** (`/cancel/` et **PAS** `/customer|blacklist|fraud|doubtful|unpaid|filedenied|denied|payment|refus/`) :
  `Cancelled` (Annulée Stock), `CancelledInternal` (Annulée par le mag). Non livré = `commandé − expédié`.
- **EXCLUES du taux** : annulations *demande* (CancelledCustomer, CancelledBlacklist\*, CancelledFileDenied)
  = pré-livraison, hors « non livré » OMS.
- **`ShippedIncomplete` comptée À PART** (ligne « expéditions incomplètes ») : la commande a été expédiée,
  juste partielle ; WSHOP l'applique très largement (splits, partiels en cours) ≠ OMS « Expédiée Incomplète » (reliquat abandonné).
- ⚠️ **WSHOP = statut LIVE ≠ export OMS figé** : ne JAMAIS viser le match au pixel avec une photo OMS.

### Retours (distinct des annulations — APRÈS livraison)
- Source `ret` (orderRefund : montant, raison via refundType, date) → `calcReturns` (CA retourné, taux, raisons, destinations).
- Source produit `retprod` (`/returns/get`, 1 ligne/article, date filtrable) → top produits retournés + raisons (`topReturnedProducts`).
- Taux de retour = CA retourné / CA EShop période.

### GA / acquisition
- **Sessions KPI = `gasess`** (date×pays), pas la ventilation. **Taux de transfo (TT) = commandes / sessions(gasess)**.
- Taux d'ajout panier = addToCarts / sessions. **`dailySeries(rows, map, ga, sessByDay)`** : passer `sessByDay`
  issu de `getGADaily(gasess)` pour un TT/jour fiable.
- `channelTypes` = regroupement Paid/Direct/CRM/Social/SEO/Referral (`channelType()`).
- COS = dépense / CA ; ROAS = CA / dépense. Cible COS configurable (champ UI).

### Plan d'action / pilotage (`actionPlan`, calculé SERVEUR = source unique UI+PDF+copie)
- `bilanSignals` (front) : leviers classés par **impact € (signé)**, triés par |€|. Canal d'acquisition
  pinpointé (type qui recule le plus + thème payant via `gacampcat`).
- `actionPlan.teams` (serveur) : to-do par équipe **Acquisition / Merch / CRM / Ops**.
- Détection « ce qui a changé vs N-1 » : `newCampaigns`/`missingCampaigns` (gacampaigns N vs N1),
  `offerChanges` (best-sellers entrants/sortants via topProdMap, étiquetés famille), cadence email
  (jours via timeline `email`/`emailN1` + heure via `gaemailhour`/`emailPeakHour`).

---

## 4. Anomalies résolues & pièges (NE PAS refaire)

| Symptôme | Cause racine | Fix |
|---|---|---|
| **Taux d'annulation aberrant (76 %, puis 68 vs 7, puis 20 vs 7)** | (1) `commandé − expédié` comptait les commandes EN ATTENTE d'expé. (2) `quantityOffered` ≠ « à expédier » mais « offert/cadeau » (≈0) → formule = commandé−expédié. (3) lecture de `orderStatus` au lieu de `orderCustomerStatus`. (4) toutes les variantes Cancelled comptées (incl. client/fraude). (5) ShippedIncomplete trop large. | Statut = **`orderCustomerStatus`**, denylist demande, **ShippedIncomplete à part**, **taux = Cancelled seul**. Accepter écart live≠OMS. |
| **Sessions GA = 2× la plateforme (27993 vs 12163)** | Somme de la ventilation date×canal×device×pays sur-compte. | Jeu **`gasess`** (date×pays) pour le KPI et le TT. |
| **TT / ajout panier vides** | TT calculé sur les sessions ventilées (sur-comptées/mal alignées). | `dailySeries` accepte `sessByDay` issu de `gasess`. |
| **CA marketplace famille négatif** | Lignes Y2 `Total TTC ≤ 0` (retours) comptées. | Exclure `ttc ≤ 0` dans `ccAccumulate` / `calcMarketplace`. |
| **Suivi temporel « disparu »** | Période 1 jour → courbes 1 point invisibles. | Timeline **28 jours** indépendante + bouton import période large. |
| **Test connexion / import en 504** | Appels WSHOP lents en série, ou échantillon trop gros (300 cmd). | **Parallèle + timeout race**, échantillons réduits. |
| **Plein/Off « a changé »** | Pas un changement de règle : ré-import a rafraîchi les données. | RAS (la démarque est dans `originalDiscountedUnitPrice`). |

---

## 5. Conventions de travail (IMPÉRATIF)

- **Brancher** sur la branche de feature désignée ; **jamais** push direct sur `main` sans accord.
- **Shipper chaque évolution comme une PR puis squash-merge** vers `main` (Render lit `main`).
- **Conflits de merge** : cette branche est un **sur-ensemble** de `main` (à cause des squash-merges) →
  résoudre avec **`git checkout --ours <fichier>`**, vérifier (`node -c`, `grep`), puis push.
- **Identité modèle** : ne JAMAIS l'écrire dans commits / PR / code (chat uniquement).
- **OMS anonymisé à l'ingestion** : aucune PII client (noms/emails/adresses retirés).
- **MCP GitHub restreint** au repo autorisé.
- **Footer commit & PR** : `https://claude.ai/code/session_<id>`.
- **Toujours `node -c`** sur les fichiers modifiés avant commit ; tester les fonctions `calc` en `node -e`.
- Ré-import : **« Importer OMS depuis WSHOP » = import COMPLET** (recalcule tout). **« Synchroniser le delta »**
  ne recalcule PAS le passé (juste les commandes modifiées) → après un changement de règle, exiger un import complet.

---

## 6. Idées / pistes ouvertes
- Plan d'action : décalage email horaire plus fin, croisement offre×saison (drops/implantations datées),
  synthèse rédigée auto (bouton IA), export du plan en PDF/email.
- Segmentation équipes du plan d'action paramétrable (Trafic Manager, E-Merch, Studio…).
- Persistance Postgres (`DATABASE_URL`) à activer en prod.
