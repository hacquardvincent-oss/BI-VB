# CLAUDE.md — Mémoire opérationnelle complète du projet BI-VB

> **À RECHARGER EN DÉBUT DE CHAQUE SESSION.** Document de référence exhaustif (audit front+back du 09/06/2026).
> Objectif : pouvoir **re-développer ce type d'outil pour une autre entreprise sans refaire aucune erreur**.
> Compléments : `CONTEXT.md` (vision produit), `STATUS.md` (roadmap), `README.md`.
>
> **Sommaire** : 1. Architecture · 2. Jeux de données · 3. Connecteurs (WSHOP/GA4/Google Ads) ·
> 4. Ingestion & anti-PII · 5. **Définitions du CA & périmètre** · 6. **Moteur de calcul (formules)** ·
> 7. Structure de l'objet `rep` · 8. Plan d'action / pilotage · 9. **Frontend : cartes & graphiques** ·
> 10. PDF · 11. Reco IA · 12. **Journal d'anomalies résolues** · 13. Conventions · 14. **Checklist re-dev**.

---

## 1. Architecture

Outil BI e-commerce (Vanessa Bruno) : reporting **N vs N-1** par module. Déployé sur **Render** (lit la branche `main`).
- **Backend** Node.js/Express. **Frontend** vanilla JS + **Chart.js**. **PDF** via **pdfkit**.
- **Persistance** : `store.js` = `Map` en RAM (lectures synchrones pour `calc`). Si **`DATABASE_URL`** (Postgres/Neon) :
  `db.js` crée `datasets(source,period,data jsonb)`, `objectives`, `users`; `store.hydrate()` recharge au boot;
  écritures write-through (upsert). **Sans DB → données perdues au redeploy** (toujours conseiller `DATABASE_URL`).
- **Auth** (`auth.js`) : scrypt + `timingSafeEqual`. Admin bootstrap par env `ADMIN_USERNAME`/`ADMIN_PASSWORD`
  (marche sans DB). Comptes équipe en DB (`users`, rôle admin/user, `allowed_views` jsonb = **RBAC par vue**).
  `cookie-session` 7 j (`SESSION_SECRET`). Middlewares `requireAuth`/`requireAdmin`/`requireDb`.
  **`checkCreds`** : la ligne DB fait FOI si présente (permet de **changer le mot de passe** d'un compte) ;
  l'identifiant env reste un **secours**. `POST /auth/change-password` (son propre MdP, upsert DB ; pour l'admin
  bootstrap → crée sa ligne) ; admin `PATCH /auth/users/:u {password}` (réinitialise un compte). UI : page Admin.
- **Montage des routes** (`index.js`) : `/healthz`; `/auth`; `/api/ingest`; `/api/report` (**reports.js ET pdf.js**);
  `/api/ga4`; `/api/wshop`; `/api/googleads`; `/api/reco`; `/api/objectives`; statique `web/` (no-cache html/js/css).
  Au boot : ouvre le port → `db.init()` → `store.hydrate()` → `objectives.hydrate()` → `loadSpecs()` auto-charge
  les fichiers versionnés de `specs/` (`ref` N = "Referentiel produit.xlsx", `impl` N/N1 = "Implantation E26/E25.xlsx").

### Fichiers clés
| Fichier | Rôle |
|---|---|
| `server/wshop.js` (756 l.) | Connecteur WSHOP. `orderToRows` = commande→ligne OMS. `collectRange`, `refresh`, `syncIncremental`, `/ping`, audit CA. |
| `server/ga4.js` (376 l.) | Connecteur GA4. ~13 fetchers → jeux `ga`, `gasess`, `gacampaigns`, `gacampdaily`, `gaemailhour`… |
| `server/googleads.js` (183 l.) | Connecteur Google Ads (GAQL, cost_micros, impression share). |
| `server/calc.js` (1245 l.) | **Tout le moteur de calcul** (pur, sans DOM, partagé serveur/front/PDF) + alias colonnes. |
| `server/reports.js` (1007 l.) | `buildReport` (objet `rep`) + `buildSaison`. Source unique pour UI, PDF, reco. |
| `server/ingest.js` (199 l.) | Upload fichiers (projection colonnes canoniques, **anti-PII**). |
| `server/pdf.js` (401 l.) | Export PDF (sections par type quotidien/hebdo, pdfkit). |
| `server/reco.js` (187 l.) | Reco IA (Anthropic) + endpoint `/context` (gratuit, prompt à coller dans Claude.ai). |
| `server/store.js`/`db.js`/`auth.js`/`objectives.js`/`index.js` | Persistance, RBAC, objectifs, montage. |
| `web/app.js` (2062 l.) | Frontend central (cartes, graphes, bilan, plan d'action, handlers). |
| `web/saison.js`/`saison.html` | Page « Analyse de saison » (à part, période longue). |

### Pipeline de rendu front
`loadReport()` → `GET /api/report?…` → `renderReport(rep)` construit une string HTML de cartes →
`MODULES[module].layout` (clés cartes) → `THEME_OF` (thème/carte) → `sectionize` (groupe par `THEME_ORDER`,
**préserve l'ordre du layout dans chaque thème**) → bannières `THEME_META` (affichées si ≥2 sections).
Après `innerHTML` : `renderObjectives`, `renderDailyChart`, `renderTimelineChart`, `renderTimeline2Chart`,
`renderCharts`, puis `wireBilan()`. **Pour réordonner des cartes d'un même thème : changer l'ordre du `layout`.**

---

## 2. Jeux de données (dataset keys, source-period)

Clé store = `${source}-${period}`, `period ∈ {N, N1}`. Forme dataset : `{hdrs, rows, map, row_count, date_min, date_max, uploaded_by, uploaded_at}`.

| Source | Origine | Contenu |
|---|---|---|
| `oms` | WSHOP `orderToRows` / upload | Lignes commande EShop (le cœur). 15 colonnes (cf §3.1). |
| `ret` | WSHOP `orderRefund` / upload | Retours niveau remboursement (montant, raison, date). |
| `retprod` | WSHOP `/returns/get` (N seul) | Retours niveau **produit** (1 ligne/article) → top produits retournés. |
| `bis` | WSHOP back-in-stock | Demande sur ruptures (« prévenez-moi »). |
| `y2` | upload ERP/Marketplace | `Total TTC ligne`, `Etablissement`, `Commercial`, `Reference interne`, `Code article`. |
| `ref` | upload / `specs/` | Référentiel produit : ref_ext → **famille/regroupement/saison**. |
| `impl` | upload / `specs/` | Implantation catalogue saison (E26 N / E25 N1). |
| `ads` | Google Ads API / upload | Campagne×jour : coût, impressions, clics, conversions, valeur conv. |
| `offre` | upload équipe commerciale | Listing produits N/N-1 : réf, famille, prix initial/soldé (ou % démarque), origine (initial/outlet) → comparatif d'offre. |
| `adsis` | Google Ads API | Impression share (search IS, lost budget/rank). |
| `ga` | GA4 API | **date×canal×device×pays** (sur-compte les sessions — cf §12). |
| `gasess` | GA4 API | **date×pays** → splits FR/Inter, TT par pays, courbes jour. ⚠️ la dim `country` déclenche le **seuillage GA4** (petits pays masqués) → SOUS-compte le total. |
| `gatot` | GA4 API | **date seule** (sans `country`) → **KPI sessions GLOBAL du Bilan** = total plateforme GA, non seuillé (cf §12). |
| `gacampaigns`/`gacampnr`/`gacampcat`/`gacampaignland` | GA4 | campagne×pays / new-vs-returning / campagne×catégorie / campagne×landing. |
| `gacampdaily` | GA4 | date×campagne → courbes campagnes (timeline2). |
| `gaemailhour` | GA4 | heure×canal → heure d'envoi email (`emailPeakHour`). |
| `galanding`/`gapages`/`gapagesrc`/`gaitems` | GA4 | landing×pays / pages / pages×source / funnel produit (itemName). |
| `saison*` (`saisonoms`,`saisony2`,`saisonref`,`saisonstock`,`saisonret`,`saisonbis`,`saisongaitem`) | WSHOP slot/upload | Jeux dédiés période longue de la page Saison (n'écrasent pas l'OMS courte). |

---

## 3. Connecteurs

### 3.1 WSHOP (`wshop.js`)
**Env** : `WSHOP_INSTANCE` (→ `https://{instance}.wshop.cloud`), `WSHOP_PREPROD`, `WSHOP_API_BASE` (override),
`WSHOP_USER`/`WSHOP_PWD`, `WSHOP_MONTHS` (défaut 24), `WSHOP_PAGE` (1000), `WSHOP_MAX_WINDOW` (`RESULT_CAP` 10000).
**Auth** : `POST /api/v1/authenticate` → JWT 1h, caché ~55 min ; `_authP` dédoublonne les auth concurrentes (N & N-1
partagent une auth). `apiPost` : Bearer ; **401/403 → refresh forcé + 1 retry** ; `≥500` → backoff ; 4xx → throw.
`wfetch` = `fetch` + `AbortController` (timeout, sinon le proxy Render renvoie un 502 opaque).

**`orderToRows(order)`** — 1 ligne par `orderItems`. Champs commande : `pays`=`countryName(shippingAddress.countryCode)`,
`mag` (NOM MAGASIN)=`storeItems.label || website.name || orderOrigin`, `pay`=`payment_method.label`,
`lieu`=`orderLocation` rempli ? `INSTORE` : `OUTSTORE`, `num`=`orderId||mainOrderId`.
**Non-livré** (le cœur, cf §12) : `cstatus = orderCustomerStatus || orderStatus || status` ;
`cancelled = /cancel/ && !/customer|blacklist|fraud|doubtful|unpaid|filedenied|denied|payment|refus/` ;
`incomplete = /shippedincomplete|incomplete/`. `qShipKnown` = `quantityShipped` ou null (`qShip` retombe sur `qOrd`).
`cancelled → max(0, qOrd − (qShipKnown ?? 0))` ; `incomplete → max(0, qOrd − (qShipKnown ?? qOrd))` ; sinon **0**.
⚠️ **`quantityOffered` n'est PAS utilisé** (= quantité offerte/cadeau, piège). Coloris ajouté à la désignation.
**Colonnes `OMS_HDRS` (18)** : `Date, Heure, Prix de vente paye (=unitPrice×qOrd), Pays livraison, NOM MAGASIN,
Type Paiement, Numeros, Designation produit, quantites commandees, Quantité non livré, Ref. externe (=reference||ean),
Lieu de prise de commande, Prix Vente (=originalUnitPrice×qOrd), Prix Vente Remise (=originalDiscountedUnitPrice×qOrd),
Statut commande (=orderCustomerStatus brut), Code Promo, Type Code Promo, Valeur Code Promo` (3 dernières = best-effort,
distinctes de la démarque → analyse `calcPromoImpact`).
**Retours** : `orderRetRowObjs` → `RET_HDRS` (Date creation, Montant rembourse, Numero de retour, Raison [refundType:
manual→"Remboursement manuel", return→"Retour client"], Pays, Nb colisages, Numeros). `returnsProductDataset`
(`retprod`, 1 ligne/article remboursé) : Date, Designation, Nb retournes, Montant, Raison. `bisDataset` (back-in-stock).

**Pagination** `collectRange(from,to,onCount,extra,guard)` : pagine `orders/get` (`created_from/to`), dédup par orderId,
convertit au fil de l'eau + **jette la page brute** (mémoire bornée) ; **si `got ≥ RESULT_CAP` → découpe la fenêtre de
dates en deux récursivement** ; `guard=true` ne garde que les commandes créées ∈ [from,to] (sécurité delta `begin/end`).
**`refresh`** (import COMPLET) : N et N-1 **en parallèle** (`Promise.all`) → `oms`/`ret`, puis best-effort `bis` + `retprod`.
**`syncIncremental`** (delta) : `begin/end` = date de **modification** depuis `.sync.since`, `mergeDelta` remplace les
lignes des commandes ré-importées (clé `Numeros`). **Ne recalcule PAS le passé / N-1 / bis / retprod** → après un
changement de règle, **exiger un import complet**.
**`/ping`** : auth + **5 `orders/get` en parallèle** chacune sous `withTimeout(p,9000)` (anti-504, réponse partielle) :
échantillon + sondes `Cancelled`/`ShippedIncomplete`/`CancelledCustomer`/`CancelledInternal`. Renvoie `statusDistinct`,
`orderStatusDistinct`, `simNonLivrePieces/ByStatus`, `probe*` ({commandes, piecesNonLivre, statutRenvoye}), champs
prix/statut/coloris. **Anti-PII** (email masqué, aucun champ client). Audit CA (`newCAAudit`/`auditCARange`) : rejoue les
commandes et somme tous les champs prix plausibles pour caler la formule CA (`pvpOf = unitPrice × quantityOrdered`).
**Jobs** : `runJob` répond 202, le client poll `GET /job` (`jobSnapshot`). Routes : `/status`, `/ping`, `/refresh`,
`/saison-merch`, `/sync`, `/ca-audit`, `/job`.

**`orderCustomerStatus` (enum 22 états, calque les libellés OMS)** : `Waiting, Controlling, WaitingDocumentation,
CancelledCustomer, CancelledBlacklistUnpaid, CancelledBlacklistFraud, CancelledBlacklistDoubtful, Preparation, Late,
Shipped, ShippedIncomplete, Cancelled, WaitingPayment, CancelledFileDenied, PreparationPartial, ShippedPartial,
CancelledInternal, ReturnPreparation, PickupStoreProcessed, WaitingValidation, Preorder, SubscriptionRenew`.
`orderStatus` (8 états back-office, **sans Shipped ni ShippedIncomplete**) → inutilisable pour le détail OMS.

### 3.2 GA4 (`ga4.js`)
**Env** : `GA4_SA_KEY` (JSON ou base64) ou `/etc/secrets/ga4.json` ou `GOOGLE_APPLICATION_CREDENTIALS` ; `GA4_PROPERTY_ID`.
`post()` : `google-auth-library` JWT (scope `analytics.readonly`) → `runReport`. Retries 5xx/réseau, pas sur 4xx.
**Fetchers (dimensions → métriques → jeu)** :
| Jeu | Dimensions | Métriques |
|---|---|---|
| `ga` (`fetchGA4`) | date, sessionDefaultChannelGroup, deviceCategory, country | sessions, activeUsers, newUsers, keyEvents, totalRevenue, engagedSessions, engagementRate, addToCarts, checkouts, ecommercePurchases |
| `gasess` | date, country | sessions |
| `galanding` | landingPage, country | sessions, ecommercePurchases, totalRevenue |
| `gaitems`/`saisongaitem` | itemName | itemsViewed, itemsAddedToCart, itemsPurchased |
| `gapages` | pagePath, country | screenPageViews |
| `gapagesrc` | landingPage, channelGroup, country | sessions, totalRevenue, ecommercePurchases, screenPageViews |
| `gacampaigns` | sessionCampaignName, country | sessions, ecommercePurchases, totalRevenue, addToCarts |
| `gacampnr` | sessionCampaignName, newVsReturning, country | sessions, ecommercePurchases, totalRevenue |
| `gacampcat` | sessionCampaignName, itemCategory | itemRevenue, itemsPurchased |
| `gacampaignland` | sessionCampaignName, landingPage, country | sessions, ecommercePurchases |
| `gacampdaily` | date, sessionCampaignName | sessions, totalRevenue, ecommercePurchases |
| `gaemailhour` | hour, sessionDefaultChannelGroup | sessions |
⚠️ **`gasess` existe parce que `ga` SUR-COMPTE les sessions** (somme multi-dimension non seuillée). `gasess` colle au
total plateforme → l'utiliser pour le KPI sessions et le TT/jour. `refresh` : `fetchGA4` essentiel (awaité), le reste
sous `safe()` (un 502 secondaire n'interrompt pas l'import). `gacampcat` = N seul. Routes : `/status`, `/refresh`, `/saison-items`.

### 3.3bis SFTP (`sftp.js`) — automatisation Y2/ERP
**Env** : `SFTP_HOST`, `SFTP_PORT` (22), `SFTP_USER`, `SFTP_PASSWORD` **ou** `SFTP_PRIVATE_KEY` (PEM ou base64,
+ `SFTP_PASSPHRASE`), `SFTP_DIR`, **`SFTP_FILES`** (JSON `[{source,period,match}]`, ex.
`[{"source":"y2","period":"N","match":"Y2_N_*.csv"},{"source":"y2","period":"N1","match":"Y2_N1_*.csv"}]`),
`SFTP_POLL_MINUTES` (optionnel = auto-import). Dépendance `ssh2-sftp-client` (require **paresseux** : pas d'erreur si
non configuré). `fetchAll` : connecte, prend le fichier **le plus récent** matchant chaque motif (glob `*`/`?`), télécharge
→ **`ingest.ingestBuffer`** (même pipeline + anti-PII que l'upload manuel). Routes : `/status`, `/ping` (liste le dossier +
résolution des motifs, sans rien ingérer), `/refresh`. UI : `#sftpbox` (Importer / Tester). Recommandé pour **Y2/ERP**
(une API n'existe que si l'ERP en publie une ; le SFTP est universel pour les exports fichiers). Poll auto = instance toujours active.

### 3.3 Google Ads (`googleads.js`)
**Env** : `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`/`CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`,
`GOOGLE_ADS_CUSTOMER_ID` (10 chiffres), `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (MCC, optionnel), `GOOGLE_ADS_API_VERSION`.
OAuth2 refresh_token → access token. `search(gaql)` sur `…/{ver}/customers/{id}/googleAds:searchStream` ; **sur 404 →
essaie la version d'API suivante** (`v21,v20,v19,v18`, la 1ʳᵉ qui répond est cachée). `ADS_HDRS` : Campagne, Jour, Coût
(`cost_micros/1e6`), Impressions, Clics, Conversions, Valeur de conversion → jeu `ads`. `fetchImpressionShare` → `adsis`.
Routes : `/status`, `/ping` (probe `SELECT campaign.id … LIMIT 1`), `/refresh`.

---

## 4. Ingestion & anti-PII (`ingest.js`)
`UPLOAD_MAX_MB` (300). `SOURCES = oms,y2,ga,ads,ref,ret,impl,saison*`. `ANONYMIZE = {oms,ret,saisonoms,saisonret}`.
**`OMS_CANON`** = colonnes canoniques conservées à l'import projeté (le reste, dont PII, jeté).
**`PII_DENY` (ADR-005, privacy by design)** : `nom client, prenom client, prenom, email, mail, adresse, telephone,
code postal, ville livraison, numero de suivi, id transaction, n tva, responsable`. `ingestOmsProjected` (saisonoms)
projette ligne par ligne → PII naturellement exclue. Parsing : Ads (`buildAdsTable` localise la vraie ligne d'en-tête),
GA (`parseGAcsv`, saute les `#`), XLSX (1ʳᵉ feuille), CSV `;` latin1. Routes `POST/GET/DELETE /:source/:period`.

---

## 5. Définitions du CA & périmètre (⭐ référence métier)
- **Parser money** : `fN` (FR `1 234,56`), `fGA` (US), `numAds` (tolérant FR/US + symboles).
- **`isMkt(type)`** = type de paiement ∈ `['gl.com','printemps','la redoute','24s']` (`MKT_ALL`). **L'exclusion marketplace
  se fait TOUJOURS par le TYPE DE PAIEMENT, jamais par le magasin** (ship-from-store = corners physiques, gardés en CA).
- **Périmètre EShop = Outstore** (`filterOutstore` exclut Instore via `Lieu de prise de commande` ; no-op si colonne absente).
- **Prisme `dim`** : `global` (FR+Inter) / `fr` / `inter` (`filterDim` sur `pays`). GA : `filterGADim` (null si pas de pays).

**`calcOMS(rows,map)` — toutes les définitions de CA** (`p = fN(Prix de vente payé)`) :
| Champ | Définition |
|---|---|
| `total` | Σ p (TOUTES lignes, marketplaces inclus) |
| `caGlob` | Σ p où `!isMkt` = **CA Global EShop** (FR+Inter, hors **les 4** marketplaces) |
| `caMkt` | Σ p où `isMkt` |
| `caFR` / `caInt` | (hors mkt) `pays === 'france'` / sinon |
| `caEnt` / `caSFS` | (hors mkt) `NOM MAGASIN === 'webstore eur'` (Entrepôt) / sinon (Ship-from-store) |
| `caFP` / `caOP` | (hors mkt) **Off price (démarque)** ⇔ « Prix Vente Remisé » ≠ 0 ET ≠ « Prix Vente » ; sinon **Full price**. ⚠️ AUCUNE tolérance (cf §12). La démarque se lit sur **Remisé vs Vente**, JAMAIS sur le payé (un **code promo** ≠ une démarque). |
| `caEShop` | `caFR + caInt` · `caOmni` | `caEnt + caSFS` |
- **CA = « Prix de vente payé » = `unitPrice × quantityOrdered`** (champ OMS confirmé par audit CA).
- **⭐ DÉMARQUE = règle FIGÉE EXACTE (ne plus rediscuter — cf §12)** : `isFullPriceLine(pvFull,pvRemise) = (pvRemise===0) || (|pvRemise−pvFull|<0.01)`.
  Formule client (export OMS) : `IF(OR(Remisé=0 ; Remisé=Prix Vente); "Full"; "Off")`. `discountDepthOf` = `1−pvRemise/pvFull`.
  - **AUCUNE TOLÉRANCE** : même un écart de 0,68 € = off price (c'est ce que fait leur TCD). Une tolérance de 2 % avait été essayée → faisait basculer ~8 K€ de petites démarques en full → ÉCART vs TCD (rejeté). Seul `0.01` = bruit flottant.
  - **JAMAIS sur le « Prix de vente payé »** : un **code promo** baisse le payé sans être une démarque soldes (→ a sa PROPRE analyse `calcPromoImpact`).
  - Partagée par `calcOMS, calcKPIEShop, fullOffSplit, calcDiscountDepth, hourlySeries, calcZoneFullOff` → **toutes les cartes full/off de Reporting ET d'Analyse commerciale en héritent** (source unique).
  - Validé : reproduit le TCD client **à chaque cellule** FR/Inter × Full/Off × N/N-1 (ex. FR 2026 Full 31 879 / Off 54 238 ; Inter 2026 Full 9 412 / Off 19 733).
  - ⚠️ Suppose **« Prix Vente Remisé » renseigné**. Export OMS ✓. **Via WSHOP, `originalDiscountedUnitPrice` est souvent à 0**
    → `orderToRows` **reconstitue la démarque** : si `unitPrice < originalUnitPrice`, il prend `unitPrice` comme prix remisé
    (sinon tout passerait en full price — cf §12). Diagnostic dans `/ping` → `demarqueSample` (montre si l'API peuple un prix remisé).
- **Codes promo (≠ démarque)** : `calcPromoImpact(rows,map)` → `{codes[{code,type,ca,orders,remise}], caPromo, share, ordersPromo, estRemise}` (colonnes `Code Promo`/`Type`/`Valeur` ;
  `orderToRows` les capte best-effort côté WSHOP). Exposé `rep.promo{n,n1}` → carte `promo` (Reporting) + section `secPromo` (commerciale). Mesure le **levier promotionnel**, pas la démarque.

---

## 6. Moteur de calcul (`calc.js`) — formules par domaine

**Détection colonnes** : `norm` (minuscule, sans accents) + `autoMap` (match exact prioritaire, sinon **plus longue
sous-chaîne d'alias** = la plus spécifique gagne). Alias : `OMS_ALIASES, Y2_ALIASES, GA_ALIASES, ADS_ALIASES,
REF_ALIASES, RET_ALIASES, IMPL_ALIASES, STOCK_ALIASES`. `ensureRefExtIdx` garantit `_refExt` pour les familles.

### KPI EShop — `calcKPIEShop(rows,map,sessions)` (hors mkt)
`ca`=Σ prix · `pieces`=Σ qte · `commandes`=|num distincts| · `pm`=ca/commandes · `tt`=commandes/sessions (TT) · `caFP/caOP`.

### Annulations — `calcCancellations` / `calcCancellationsDetail` (hors mkt, cf §12)
- **Taux d'annulation = `commandesImpactees ÷ commandes`** (à la **commande**, pas à la pièce). `tauxPieces`, `tauxCA` aussi.
- **Annulation** = lignes `Quantité non livré > 0` au statut **Cancelled\*** (ou statut absent). `unit = prix/cmd` (prorata).
- **`ShippedIncomplete` comptée À PART** (`/incomplete/ && !/cancel/`) → `qteIncomplete`/`caIncomplete`/`commandesIncompletes`,
  **hors du taux** (la commande a été expédiée, juste partielle). WSHOP l'applique très largement (splits/partiels) ≠ OMS.
- `Detail` : `entrepot`/`magasin` (webstore vs ship-from-store), `incomplet{entrepot,magasin}`, `topStores`, `topProduits`,
  `byCanal` (qui a annulé quoi), **`byStatut`** (audit Cancelled vs ShippedIncomplete, comparaison au pivot OMS).

### Retours — distinct des annulations (APRÈS livraison)
`calcReturns` (caRetourne, qte, nbRetours, `reasons`, `countries`, `destinations`). `topReturnedProducts` (retprod, top 10
+ raisons par produit). `returnsByRef`/`salesByRef`/`productProfitability` (caNet = caVendu − caRetourné, tauxRetour =
qteRet/qteVendu). **Taux de retour = CA retourné / CA EShop période.**

### Marketplace
- **`calcMarketplace`** : OMS par type (`gl.com`→glOMS, `printemps`→printemps) ; Y2 (**skip `ttc ≤ 0`** = retours) :
  `glY2` (etab `gl ac haussmann` + commercial `674sfs`), `pdt` (`place des tendances` + `686001`),
  `lulli` (`lulli` + `610lulli` + ref `005…`). `glTotal = glOMS+glY2`, `total` = somme des 5.
- **`calcMarketplaceCancelRefund`** : annulations OMS (lignes mkt non livrées par enseigne) + remboursements Y2 (**`ttc < 0`**).
- **`calcCrossChannel`** (`ccAccumulate`, `omsChannelOf`=EShop/GL/Printemps, `y2ChannelOf`=PDT/Lulli/GL) :
  `channels` (ordre `EShop,GL,Printemps,PDT,Lulli`), `familles` (famille×canal), `topByMarketplace` (top 5/enseigne),
  **`arbitrage`** (produit fort sur un canal/faible sur l'autre ; seuil 300€ & 15% ; **on ne SOMME jamais EShop+mkt**),
  `recos`. ⚠️ **Toujours exclure les lignes Y2 `ttc ≤ 0`** (sinon CA famille négatif).

### Familles
`buildRefMap` (ref_ext → famille ; **`regroupement` prioritaire sur `famille`**). `calcCAFamille`, `calcFamilleDetail`
(ca+qte), `calcFamilleParPays` (top 5 pays), `calcFullOffByFamille`/`ByProduct` (`fullOffSplit` = même règle FP/OP).

### GA / acquisition
- **`getTotalSessions` SUR-COMPTE** → KPI sessions via **`gasess`**. `getGADaily`/`gaDailyMetrics` → `{ISO:{sessions,carts}}`.
- **`dailySeries(rows,map,ga,sessByDay)`** : CA+commandes OMS/jour × sessions/paniers GA → `{tt, addRate}`. **Passer
  `sessByDay` issu de `getGADaily(gasess)`** pour un TT/jour fiable (sinon courbes fausses/vides).
- `calcGA` (agrège par canal, gère 1-ligne ou date×canal), `calcByCountry`, `calcByDevice`, `calcChannelTypes`
  (`channelType` → Paid/Direct/CRM/Social/SEO/Referral/Autre), `channelPerf`, `ttByCountry` (jointure GA pays↔OMS pays
  via `normCountry`), `campaignDailySeries` (top 3 campagnes, exclut direct/organic/referral), `emailPeakHour`, `hourlySeries`.
- **Ads** : `calcAds` → `ctr, cpc, cpa, convRate, roasGA`. **COS = dépense / CA · ROAS = CA / dépense · CPA = coût/conv.**
  Cible COS configurable (champ UI, défaut 30%).

### Saison / produits
`buildTopProdMap` (par désignation), `topList`/`topListQte`, `productGap` (à reconquérir : `perte = caN1 − caN`, garde
perte>0), `buildSeasonMap`/`calcBySeason`, `calcSeasonCompare` (E26 vs E25 : counts, familles, bests, manquants,
nonVendus ; `baseRef` = modèle, `isSeasonal` = drop `P\d`), `demarque` (détection auto des périodes de démarque).

---

## 7. Structure de l'objet `rep` (`buildReport`)
Source **unique** consommée par `/api/report`, le **PDF**, et la **reco**. Clés principales :
`meta` (preset, from/to, isAll, cf/ct, dim, gaDimUnavailable, has*, scope, consent) · `kpiEShop{n,n1}` · `ca{n,n1}` ·
`marketplace{n,n1,cancelRefund}` · `pays[]` · `saison[]` · `seasonCompare` · `crossChannel` · `cancellations{n,n1,detail}` ·
`returns{n,n1,tauxRetour,topProduits}` · `famille[]` · `produits{topN,topN1,manquants,topVendus,topRetournes}` ·
`topProduits{n,n1}` · `topProduitsQte` · `familleDetail` · `familleParPays` · `fullOffFamille`/`fullOffProduits` ·
`funnel{n,n1}` · `channels{n,n1}` · `channelTypes{n,n1}` · `device{n,n1}` · `daily`/`dailyN1` ·
`timeline[]` (28 j, voir ci-dessous) · `timeline2{campN,campN1}` · `stockAlerts[]` · `hourly{n,n1}` · `gaFunnel{n,n1}` ·
`ttPays[]` · `sessionsByZone{n,n1:{fr,inter}}` (sessions FR/Inter via gasess → donut Bilan `binDonutIntlSess`) · `landingPages` · `itemFunnel` · `topPages`/`lostPages`/`newPages` · `campaigns`/`campaignsTotals` ·
`lostCampaigns`/`newCampaigns` · `actionPlan` (voir §8) · `campaignLanding` · `topPagesBySource`/`lostPagesBySource` ·
`ga`/`gaN1` · `ads`.
- **`timeline`** : fenêtre **28 jours** indépendante de la période (`tlEnd`=to ou `omsN.dateMax`, `tlStart=−27 j`). CA/jour +
  TT + ajout panier (via `dailySeries`). **Jour email** : pic du canal Email GA (`/e-?mail|mailing|newsletter|crm/i`),
  seuil `max(médiane×1.5, 10)`. N-1 = même fenêtre **−364 j** → `caN1, ttN1, addN1, email, emailN1, emailVol, emailVolN1`.
- **`timeline2`** : `campaignDailySeries` top 3, `campN` (shift 0) + `campN1` (shift −364) alignées sur l'axe 28 j.
- **`ads`** : `roas/cos/cac` + `campaigns[]` (caGA, roas, cos, cpa, IS, newShare…), `top/flop/saturated/imbalanced/
  budgetLimited/lowNew`, `categories` (thèmes payants via gacampcat), `cosTarget`.
- **`buildSaison`** (route `/saison`) : rapport saison période longue (réconciliation WSHOP eshop/instore/mkt, sell-through,
  couverture, taux retour, full/off, **démarque auto**, demande back-in-stock).

---

## 8. Plan d'action / pilotage (calculé SERVEUR = source unique UI + PDF + copie)
- **`bilanSignals` (front)** : leviers classés par **impact € signé**, triés par |€|, seuils ~1000€ : familles (Δ CA),
  canal d'acquisition (type qui recule le plus, + thème payant via `ads.categories`), annulations (si taux>2%), produits
  à reconquérir, marketplace (pire enseigne), TT (`(tt−tt1)×sessions×pm`). Puis opportunité International (hors classement €).
- **`actionPlan.teams` (serveur)** : to-do par équipe **Acquisition / Merch / CRM / Ops** (mêmes seuils ; cadence email =
  jours via timeline `email`/`emailN1`, heure via `emailHour`). Rendu identique carte UI / `actionPlanText` (copie) / PDF `secPlanAction`.
- **« Ce qui a changé vs N-1 »** : `newCampaigns`/`missingCampaigns` (gacampaigns N vs N1), `offerChanges`
  (best-sellers entrants/sortants via `topProdMap`, seuil 300€, étiquetés famille via `desFam`), `emailHour`.

---

## 9. Frontend (`app.js`) — cartes & graphiques

### Modules / thèmes
`MODULE_ORDER` (barre de vues, filtrée RBAC). Thèmes `THEME_ORDER = [P,T,ES,AQ,IN,MP,CR,OF,Z]` (`THEME_META` = bannières).
Modules notables : `full` (layout exhaustif : kpi, actionplan, timeline, timeline2, daily, famille, produits, …,
ga, channels, canaltype, ads, campaigns, …, marketplace, crosschannel, …, saisoncompare, saison, renta, ca) ;
`acquisition` (ga, **channels, canaltype**, ads, campaigns — ordre KPI→détail→récap, choix métier) ; `international`
(dim `inter`) ; `marketplace`, `saisonprod`, `croisees`, etc. `card(k)` injecte une `ana()` (insight 💡) en fin de carte.

### Cartes (clé → contenu)
`kpi` (Pilotage 360 : mini-panels top 5 pays/familles/produits CA & Qté/canaux/campagnes) · `actionplan` (leviers €,
to-do par équipe, écarts vs N-1, bouton Copier) · `ca` (vide, fusionné dans Bilan) · `funnel`/`gafunnel` (entonnoirs) ·
`daily` (suivi période, granularité heure/jour/semaine) · `timeline`/`timeline2` (4 semaines) · `channels` (table + 2
donuts N/N-1) · `canaltype` (récap par type) · `device` · `marketplace` (donut + table + cancel/refund) · `crosschannel`
(barres empilées + arbitrage) · `pays` (barres croissance/décroissance) · `ttpays` · `fampays` · `saison`/`saisoncompare` ·
`annulations` (tuiles delta **inversé**, entrepôt/magasin, **incomplètes à part**, byStatut, byCanal) · `retours` (tuiles,
top produits + raisons, raisons N vs N-1) · `stockalerts` (top 10) · `produits`/`itemfunnel`/`renta` · `pages`/`landing`/
`pagesrc`/`lostpages`/`campaignland` · `famille` (barres croissance/décroissance) · `ga` · `campaigns` · `ads` ·
Cartes commerciales (thème `CO`, dispo dans l'éditeur de vue) : `demarque` (CA off/full, taux de démarque inversé,
**CA par tranche de démarque** via `calcDiscountDepth` sur pv/pv_remise) · `fulloff` · `offrecompare` (via
`calcOffreCompare` : largeur par famille, réfs par niveau de démarque, origine, « à réintégrer », « démarquées sans
vente ») · `comalerts` (campagnes manquantes/flop/saturées/bridées, landing en chute, pages perdues).
**Page dédiée « Analyse commerciale »** (`commerciale.html`/`commerciale.js`, onglet header — PAS une vue Reporting) :
pilotage d'UNE opération (avant-première/soldes). Sections (ordre) : **secBilan** (360 + poids off/full + donut) ·
**secGlobal** (pivot FR/Inter × Démarqué/Full : CA, poids, vs N-1, évol € ; démarque en inversé ; via `rep.zoneFullOff`) ·
**🚀 secLancement** (CA à l'heure du jour J ; tuile **« CA cumulé à Hh » vs N-1 à heure équivalente** = en avance/retard ;
`chartLancement` = **bâtons empilés Full/Off N + N-1 côte à côte** [`stack:'N'`/`'N1'`] + courbes **Sessions N plein /
N-1 pointillé** [`rep.hourly.sessN/sessN1` via `sessionsByHour(gaemailhour)`]) · **secTranches** (profondeur démarque) ·
**secFamilles** (`perfBlock` Off price puis Full price : familles CA/poids/vsN-1/Dif + top produits vs N-1 ; via
`fullOffFamille`+`fullOffProduits` enrichis `caOPn1/caFPn1`) · **secCanaux** (vue groupée canaux : sessions+CA+conv vs N-1) ·
**secCRM** (détail emails) · **secAcquisition** (campagnes UTM + KPI Ads) · **secOffre** (comparatif d'offre) · **secAlertes**.
**CTA « Comparer N-1 »** (`#cmpToggle` → `compare=0` = analyse N seule). **Zone de dépôt listing d'offre** (`#offreUpload`
→ `POST /api/ingest/offre-listing` : 1 fichier scindé par colonne **Saison** [E26→N, E25→N-1] → `offre-N`/`offre-N1`).
Bouton **⚡ delta WSHOP** intégré = quasi temps réel les jours de lancement. Reporting = analyses génériques.

### Graphiques (Chart.js) — comment ils sont construits
Registre global `_charts`, `mk(id,cfg)` détruit avant recréer. Couleurs : `--a #f5a623` (CA/ambre), `--b #4a9eff`
(sessions/bleu), `--g #22c55e` (vert=hausse/TT), `--r #ef4444` (rouge=baisse/retours), `#a78bfa` (violet=ajout panier).
`PALETTE` (8). **Convention courbes : trait plein = N, pointillé = N-1.**
- **`growShrink(id,items)`** (famChart, paysChart) — **barres horizontales empilées « croissance/décroissance »** :
  base bleue = `min(N,N1)`, cap = `|N−N1|` **vert si N≥N1 (grandit) / rouge si rétrécit** → la barre atteint `max(N,N1)`.
- **`#tlChart`** (timeline 4 sem., mixte) : barres CA/jour N (ambre foncé) + N-1 (ambre clair) sur axe `y` ; courbes TT% et
  ajout panier % (N plein / N-1 pointillé) sur `y1` ; croix ✉️ Email N (`crossRot`) et N-1 (`cross`).
- **`#tl2Chart`** : barres CA N/N-1 + 1 courbe/campagne (campN plein, campN1 pointillé), axe `y1` Sessions.
- **`renderDailyChart`** (`#dailyChart` barres CA N/N-1 ; `#trafChart` sessions+ajout panier N plein/N-1 pointillé ;
  `#ttChart` TT N rempli vert / N-1 pointillé gris). Granularité `aggDaily` (jour / semaine `Sxx` / heure).
- Donuts Bilan : `segDonut` (Intl, Omni, Démarque FP/OP, Marketplace). Autres : `#funnelChart`, `#saisonChart`,
  `#retoursChart`, `#crossStack` (empilé famille×canal), `#prodChart`.

### Bilan / scorecard / helpers
`buildBilan` → `renderScorecard` (7 tuiles : CA Global EShop, Commandes, TT, Panier moyen, **Taux annulation (inversé)**,
Sessions, **COS (inversé)**) + donuts détail. `bilanTile(…,invert)` : `invert` → une hausse est **rouge** (annulation/COS).
Boutons (`wireBilan`) : `#bilanCopy` (contexte Claude.ai, `/api/reco/context`, 0€), `#planCopy` (plan d'action texte),
`#bilanIA` (`/api/reco`, payant). Formatters : `fEur, fInt, fPct, f2, pc, sgn, delta, deltaInv, esc, cut, isFrance`
(France ≈70% du CA → **exclue des tableaux/graphes par pays**).

### UI chargement / diagnostic
Boîtes API masquées tant que `/status` ≠ configured. WSHOP : `#wshoprefresh` (import complet, poll `/job`), `#wshopsync`
(delta), `#wshopping` (rend les blocs « Diagnostic règle CA » + « Diagnostic annulations » : statusDistinct, sondes),
`#wshopcaaudit` (audit CA jour, surlignage du candidat le plus proche du TTC cible). GA4/Ads : refresh + ping. Import
manuel (oms/y2/ads, N & N-1). Champs : 🍪 taux d'acceptation cookies (`consentN/N1` → sessions réelles = GA ÷ taux),
🎯 cible COS, bouton PDF (`type=quotidien|periode`). RBAC : `me()` → `ALLOWED_VIEWS` filtre la barre de vues.

---

## 10. PDF (`pdf.js`)
pdfkit A4. ⚠️ **WinAnsi : pas de `→`, pas de `Δ`, pas d'espaces fines** (`sp()` les remplace ; deltas en `+/-%`, email `✉`).
Primitives : `section, kpiTiles, table, barChart, donut, header, footers`. **`renderQuotidien`** : header, secBilan,
**secPlanAction**, secFamille, secTopProduits, secTopPays(8), secGaKpi, secTypeCanal, secAdsKpi, secMarketplace.
**`renderPeriodique`** : + secPilotage, secSuiviTemporel, secTopAReconquerir, secTopPages, secAdsCampagnes,
secTopFamillesPayant, secFamillesParPays, secAnnulations, secRemboursements, secCrossCanal, secAnalysesCroisees.
Route `GET /pdf` (`isDaily` = type `quotid|daily|jour` ou from==to).

## 11. Reco IA (`reco.js`)
`/api/reco/context` (**gratuit, sans clé**) : renvoie `BRIEF + PASTE_TAIL + distill(rep)` à coller dans Claude.ai (Pro/Max).
`/api/reco` (payant, `ANTHROPIC_API_KEY`) : `SYSTEM` (JSON strict `{synthese,court,moyen,long}`, `cache_control:ephemeral`),
`distill(rep)` compacte le rapport, cache SHA-1 en RAM, `callClaude` (max_tokens 4000, retries 429/5xx).

---

## 12. Journal d'anomalies résolues (cause racine → fix)
| Symptôme | Cause racine | Fix |
|---|---|---|
| **Taux d'annulation 76 % puis 68 vs 7 puis 20 vs 7** | (1) `commandé−expédié` comptait les commandes EN ATTENTE. (2) `quantityOffered` ≠ « à expédier » mais « offert/cadeau » (≈0). (3) lecture de `orderStatus` (8 états, sans Shipped/Incomplete) au lieu de **`orderCustomerStatus`** (22 états). (4) toutes les variantes Cancelled comptées (client/fraude incluses). (5) `ShippedIncomplete` (statut live, splits) bien plus large côté WSHOP que côté OMS. | Statut = **`orderCustomerStatus`** ; **denylist demande** (`customer|blacklist|fraud|doubtful|unpaid|filedenied|denied|payment`) ; **`ShippedIncomplete` comptée à part** ; **taux = Cancelled seul** (choix métier). Colonne `Statut commande` stockée + carte `byStatut` pour auditer. **WSHOP = live ≠ photo OMS figée** : ne JAMAIS viser le match au pixel. |
| **0 annulation après le fix** | `/ping` n'affichait pas les nouveaux champs ; et l'API n'expose pas les libellés FR mais l'enum EN (`Cancelled`/`ShippedIncomplete`). | Sondes API filtrées par statut + affichage front du bloc diagnostic. |
| **Sessions GA = 2× la plateforme (27993 vs 12163)** | Somme de la ventilation date×canal×device×pays sur-compte (données non seuillées). | Jeu **`gasess`** (date×pays) pour le KPI **et** le TT (`dailySeries(sessByDay)`). Carte Acquisition : total **ancré sur le Bilan** + ventilation canal mise à l'échelle. |
| **Sessions Bilan (35 487) < GA brut (42 728)** | `gasess` interroge GA4 avec la dim `country` → **seuillage de confidentialité GA4** masque les petits pays → la somme par pays SOUS-compte le total plateforme (~−17 %). | Jeu **`gatot`** (date SEULE, sans `country`) = total plateforme non seuillé → KPI sessions global du Bilan quand `dim=global` ; `gasess` reste pour FR/Inter (périmètre pays, forcément seuillé). **Exige un re-import GA4.** |
| **TT / ajout panier vides** | TT calculé sur les sessions ventilées. | `dailySeries` accepte `sessByDay` issu de `gasess`. |
| **CA marketplace famille négatif** | Lignes Y2 `Total TTC ≤ 0` (retours/avoirs) comptées. | Exclure `ttc ≤ 0` (`calcMarketplace`, `ccAccumulate`) ; `ttc < 0` = signal remboursement. |
| **Suivi temporel « disparu »** | Période 1 jour → courbes 1 point invisibles. | Timeline **28 jours** indépendante + message si OMS trop court. |
| **Test connexion / import en 504** | Appels WSHOP lents **en série** (auth + 5 sondes ≈ 8 s) ou échantillon 300 cmd. | **`Promise.all` (parallèle) + `Promise.race` (timeout 9 s)** → réponse partielle ; échantillons réduits. |
| **Plein/Off « a changé »** | Pas un changement de règle : ré-import a rafraîchi les données. | RAS (démarque dans `originalDiscountedUnitPrice`). |
| **CA full price faux (saga démarque — CLOS DÉFINITIVEMENT)** | (1) 1ʳᵉ tentative : appui sur le **payé < catalogue** → faux car les **codes promo** baissent le payé → off à tort. (2) 2ᵉ tentative : tolérance 2 % « anti-résiduel » → faisait basculer ~8 K€ de petites démarques en full → ÉCART vs TCD (le client compte un écart de 0,68 € en off !). (3) Encodage WSHOP : `originalDiscountedUnitPrice` à 0 ou `originalUnitPrice` = prix soldé. | **Règle EXACTE FIGÉE** : `isFullPriceLine = (pvRemise===0) || (|pvRemise−pvFull|<0.01)` — formule client `IF(OR(Remisé=0;Remisé=Vente);Full;Off)`, **AUCUNE tolérance** (0.01 = bruit flottant). Off ⇔ Remisé renseigné ET ≠ catalogue. Codes promo → `calcPromoImpact`. WSHOP : `orderToRows` reconstitue (Prix Vente = `max(compareAtPrice, originalUnitPrice)` ; Remisé = `originalDiscountedUnitPrice` sinon `unitPrice` si < catalogue). **Validé : reproduit le TCD à chaque cellule FR/Inter × Full/Off × N/N-1.** Audit `calcFullOffAudit` dans la carte démarque. |
| **Soldes : 98 % de FULL price côté WSHOP live (1,8 K off / 101 K full)** | L'API WSHOP renvoie `originalDiscountedUnitPrice` (= « Prix Vente Remisé ») **à 0 même en soldes** → la règle (Remisé vs Vente) voit `Remisé=0` partout → tout en full price. (L'export OMS uploadé, lui, a bien la colonne remplie → marchait.) | `orderToRows` **reconstitue le prix remisé** : `pvrUnit = originalDiscountedUnitPrice (ou discountedUnitPrice/salePrice…) ; sinon, si unitPrice < originalUnitPrice → pvrUnit = unitPrice`. La démarque redevient visible. **Exige un import complet** pour s'appliquer. Vérifier le vrai champ API via `/ping` → `demarqueSample`. |
| **Données OMS pas mises à jour après changement de règle** | « Synchroniser le delta » ne recalcule pas le passé. | Exiger **« Importer OMS depuis WSHOP » (import complet)**. |
| **Bilan -73% trompeur sur AUJOURD'HUI (N partiel vs N-1 full day)** | Analyse d'un jour = aujourd'hui : le N s'arrête à l'heure courante (ex. 12h) mais le N-1 comptait la **journée entière** → comparaison déloyale. | **Cumul à l'heure** : `buildReport({hourMax})` + `calc.filterTimeMax(rows,map,"HH:MM")` tronque N **ET** N-1 aux ventes ≤ heure courante quand `from===to===aujourd'hui`. Le front (`commerciale.js`) passe `hourMax=now` au rapport principal (PAS au `loadLaunch`, qui garde la trajectoire N-1 full day). ⚠️ Les sessions GA restent en journée (date-level, non sécables à l'heure) → TT du jour indicatif. |
| **0 commande le jour de lancement (Analyse commerciale)** | `syncIncremental` réutilisait le `to` figé du dernier import complet ; `guard` (created ∈ [from,to]) **rejetait les commandes créées APRÈS** cette date → les ventes du jour J n'entraient jamais. De plus le delta **ne charge JAMAIS N-1** (« PAS DE N-1 »). | `syncIncremental` **étend `to` à aujourd'hui** (`max(to, today)`). Bouton **« ⬇️ Import complet (opération + N-1) »** sur la page commerciale → `POST /api/wshop/refresh?from&to&cfrom&cto` (charge N **et** N-1 sur la fenêtre de l'opération). |
| **Conflits de merge à répétition** | Branche = sur-ensemble de `main` (squash-merges). | Résoudre `git checkout --ours <fichier>`, vérifier (`node -c`, `grep`), push, re-merge. |

---

## 13. Conventions de travail (IMPÉRATIF)
- **Brancher** sur la branche de feature ; **jamais** push direct sur `main` sans accord. **Render lit `main`.**
- **Shipper chaque évolution comme une PR puis squash-merge** vers `main`.
- **Conflits** : `git checkout --ours <fichier>` (branche = sur-ensemble), vérifier (`node -c`, `grep`), push, re-merge.
- **Identité modèle** : ne JAMAIS l'écrire dans commits / PR / code (chat uniquement).
- **OMS anonymisé à l'ingestion** : aucune PII client (cf `PII_DENY`, ADR-005).
- **MCP GitHub restreint** au repo autorisé. **Footer commit & PR** : `https://claude.ai/code/session_<id>`.
- **Toujours `node -c`** sur les fichiers modifiés ; tester les fonctions `calc` en `node -e` (cf `calc.test.js`).
- **`actionPlan.teams`, `offerChanges`, `emailHour` calculés côté SERVEUR** (source unique UI/PDF/copie — ne pas dupliquer).
- **Sessions : toujours préférer `gasess`** à la ventilation `ga`. **Exclusion mkt : toujours par type de paiement.**

---

## 14. Checklist « re-développer ce projet ailleurs sans erreur »
Pour refaire cet outil pour une autre entreprise, demander/cadrer **dès le début** :

**A. Accès & secrets**
- OMS/commandes : **API** (auth, endpoint, pagination/plafond, champ **statut détaillé par commande** ⭐) ou export CSV/XLSX ?
- GA4 : `property_id` + **service account** (Secret File Render). Confirmer que le **revenu e-commerce** et `addToCarts` sont trackés.
- Google Ads : developer token (MCC validé), OAuth (client id/secret/refresh), customer id (+ login MCC).
- ERP/Marketplace (équiv. Y2) : quelles enseignes, quels identifiants (établissement/commercial/préfixe réf.) par enseigne.
- DB : **provisionner Postgres (`DATABASE_URL`) AVANT la prod** (sinon données perdues au redeploy).

**B. Règles métier à figer noir sur blanc (sources d'erreurs n°1)**
- **Définition du CA** : quel champ exact = « prix payé » ? TTC/HT ? port inclus ? (faire un **audit CA** qui somme tous les
  champs prix et compare au CA de référence — cf `newCAAudit`).
- **Périmètre EShop** : qu'exclut-on ? (Instore, marketplaces — **par quel champ ?** paiement vs magasin).
- **Marketplaces** : liste exacte + **comment les identifier** (type de paiement) + retours = `TTC ≤ 0` à exclure.
- **Statuts de commande** : **récupérer l'énumération complète** + leur **mapping vers les libellés du reporting de référence**.
  Distinguer **annulation** (échec fulfillment : stock/interne) vs **annulation demande** (client/fraude/impayé, à exclure)
  vs **expédition incomplète** (à compter à part). ⚠️ **Statut API = live ≠ export figé** : ne pas viser le match au pixel.
- **Full price vs Off price** : où est encodée la démarque ? (ici `originalDiscountedUnitPrice`).
- **Familles/regroupements** : référentiel ref→famille (priorité regroupement) + saisons + implantations datées (drops).
- **Sessions GA** : **toujours un jeu date×pays dédié** pour le KPI (la ventilation multi-dimension sur-compte).

**C. Données de comparaison & calibration**
- Un **export de référence figé** (le « pivot » Excel du client) pour chaque KPI sensible (annulations, retours, CA par
  famille…), **avec sa période et son périmètre exacts**, pour calibrer — et accepter l'écart live/figé.
- Le **taux d'acceptation cookies** (ajuste les sessions GA).

**D. Produit / affichage**
- Modules & vues souhaités, segmentation des équipes du plan d'action (Acquisition/Merch/CRM/Ops ou autre).
- Conventions visuelles (N plein / N-1 pointillé ; barres croissance/décroissance ; delta inversé pour annulation/COS).
- Persistance des graphiques : Chart.js, registre `_charts`, détruire avant recréer.

**E. Pièges techniques confirmés (cf §12)** : proxy 504 sur appels lents → **paralléliser + timeout** ; mémoire bornée à
l'import (jeter les pages brutes) ; PDF WinAnsi (pas de `→`/`Δ`) ; merges via `--ours` ; import complet vs delta.

---

## 14bis. Module Objectifs (`web/objectifs.html`/`objectifs.js`, onglet header)
Prévision & suivi **mensuels** du CA EShop (mix auto + manuel). Backend : `objectives.js` étendu —
`OBJ = { ca, sessions, tt (legacy global), months:{ "YYYY-MM":{ca,sessions,commandes} }, growth }`.
Routes : `GET /api/objectives/history` (historique mensuel = `calc.monthlyEShopCA` agrégé sur `oms`+`saisonoms`
N&N-1, périmètre EShop hors mkt + Outstore) ; `PUT /api/objectives/months` (objectifs mensuels + croissance).
Front : tableau 12 mois × [Réalisé / N-1 / vs N-1 / Objectif éditable / % atteint / Reste à faire] + graphe
(barres Réalisé/N-1 + courbe Objectif) + bouton **« ✨ Proposer »** (objectif = CA N-1 du mois × (1+croissance)).
Plus l'OMS importé est large, plus l'historique mensuel est complet. **Connecteurs à venir** : META (Marketing API,
dépense/ROAS comme Google Ads) et SPLIO (CRM emailing) — suivront le pattern connecteur (isConfigured/refresh/ping).

## 15. Idées / pistes ouvertes
- Plan d'action : croisement offre×saison (drops/implantations datées), synthèse rédigée auto enrichie, export PDF/email du plan.
- Segmentation équipes paramétrable (Trafic Manager, E-Merch, Studio…).
- Persistance Postgres (`DATABASE_URL`) à activer en prod si pas déjà fait.

---

## 16. Structure de projet recommandée (pour re-développer proprement)
Le projet actuel est **monolithique plat** (`server/*.js` + `web/*.js`, pas de bundler) — efficace pour un proto/MVP
mono-client, mais à structurer ainsi pour un vrai produit multi-clients :

```
/server
  /connectors      wshop.js, ga4.js, googleads.js, <crm>.js   ← 1 fichier/source, interface commune
                   (chacun expose: isConfigured(), refresh({from,to,cfrom,cto,slot}), /ping, dataset shape)
  /core
    calc/          1 fichier par DOMAINE (ca.js, kpi.js, cancellations.js, returns.js, marketplace.js,
                   families.js, acquisition.js, season.js) + aliases.js + helpers.js  ← découper calc.js (1245 l.)
    report.js      buildReport (orchestration → objet rep)
    season.js      buildSaison
  /io              ingest.js (upload+anti-PII), store.js, db.js (migrations versionnées)
  /output          pdf.js, reco.js
  /http            routes (1 router/domaine), auth.js, rbac.js, jobs.js (runJob générique)
  config.js        TOUTES les règles métier paramétrables (cf. ci-dessous) — JAMAIS en dur dans le calc
/web
  /core            api.js (fetch), state.js, format.js (fEur/fInt/pc/delta…), charts.js (mk + helpers Chart.js)
  /components      card.js, scorecard.js, timeline.js, growShrink.js, donut.js…  ← découper app.js (2062 l.)
  /views           modules.js (MODULES/THEME), layout-editor.js, nav.js (sommaire/ancres)
  app.js           bootstrap
/config            mapping client : statuts, marketplaces, périmètre, familles… (1 fichier par client)
/specs             référentiels versionnés (ref produit, implantations)
/tests             calc.test.js par domaine (les formules sont le cœur → couverture max)
```

**Principe directeur n°1** : **externaliser toutes les règles métier dans une config** (pas en dur dans le code).
Un fichier `config/<client>.js` déclare : champ CA, périmètre (instore/mkt + champ discriminant), liste marketplaces +
règle d'identification, mapping statuts→{annulation/incomplète/en-cours}, encodage démarque, mapping familles, cibles
(COS), conventions d'affichage. → re-cibler un nouveau client = écrire UNE config, pas toucher au moteur.
**Principe n°2** : le **moteur de calcul reste pur** (entrées = rows+map+config, sorties = nombres) et **partagé** serveur/
front/PDF (une seule source de vérité par formule). **Principe n°3** : connecteurs derrière une **interface commune**
(une nouvelle source = un fichier connector qui émet la même forme de dataset). **Principe n°4** : `buildReport` reste
la **source unique** consommée par UI + PDF + reco (jamais recalculer côté front ce qui est déjà dans `rep`).
**Tooling cible** : TypeScript (typer `rep` et les datasets évite 80 % des bugs vus ici), tests sur chaque formule,
un bundler (Vite) quand le front dépasse ~1500 lignes, migrations DB versionnées.

---

## 17. Expérience utilisateur — règles d'affichage & interface (analyse)
**Principe UX central** : *« le Bilan répond en 5 s, le détail répond aux pourquoi ».* Le **Bilan épinglé en tête**
(scorecard 7 KPI N vs N-1 + leviers € + plan d'action) donne la photo instantanée ; les **modules/thèmes** en dessous
creusent. L'utilisateur cible = responsable e-commerce **et ses équipes** (d'où le plan d'action segmenté + le RBAC par vue).

**Règles d'affichage codifiées (à respecter pour la cohérence) :**
- **N vs N-1 partout** : chaque chiffre porte son **delta coloré** (`delta`). **Vert = mieux, rouge = moins bien** —
  **SAUF annulations & COS où c'est inversé** (`deltaInv` : une hausse est rouge). Toujours préciser « vs N-1 ».
- **Graphes — convention temporelle** : **trait plein = N, pointillé = N-1** ; barres N foncées / N-1 claires.
- **Barres « croissance/décroissance »** (familles, pays) : la barre atteint `max(N,N-1)`, **cap vert si ça grandit /
  rouge si ça rétrécit** → on lit l'évolution d'un coup d'œil (vs un simple histogramme N).
- **France exclue des tableaux/graphes par pays** (≈70 % du CA, écrase l'échelle) — vue International = hors France.
- **« Ce qui marchait en N-1 et qu'on n'a plus »** est systématiquement surfacé (campagnes manquantes, best-sellers
  sortis, pages perdues) → c'est le levier d'action n°1.
- **Couleurs sémantiques** : ambre = CA, bleu = sessions/trafic, violet = ajout panier, vert = TT/hausse, rouge = baisse.
- **Insight 💡** auto en bas de carte (`ana()`), **leviers triés par impact € signé** (jamais par % seul).
- **Cartes auto-masquées** quand la donnée manque (pas de carte vide) ; **bannières de thème** seulement si ≥2 sections.
- **Densité maîtrisée** : tuiles KPI (`.kc`), tables compactes, donuts 110–130 px ; tout en `tabular-nums`.
- **Anti-frustration data** : messages explicites quand un import manque ou est trop court ; diagnostic `/ping` lisible ;
  import **complet** vs **delta** clairement distingués ; champ taux d'acceptation cookies pour caler les sessions.

**Limites UX actuelles → pistes (dont la demande en cours) :**
- La page Reporting est **très longue** → **sommaire latéral à ancres** (navigation rapide) — *en cours*.
- **Éditeur de vue WYSIWYG** : mode édition (bouton « + Ajouter à la vue » + ⠿ drag'n'drop sur chaque tableau). Vues
  **partagées** éditées par les admins → `/api/layouts` (table `layouts`). **Tableaux de bord PERSONNELS** par utilisateur
  (« ➕ Nouveau tableau de bord ») → `/api/myviews` (table `user_views`, 1 ligne/compte) : onglets `my:<key>`.
- **Widgets « from scratch »** (🧱 Nouveau widget, en mode édition) : l'utilisateur compose **Donnée × Métrique × Forme**
  (KPI/tableau/barres/donut/courbe) + Top N + toggle N-1. Widget = objet `{id,title,dim,metric,form,top,n1}` mêlé aux
  clés string dans le layout (validé serveur par whitelists `W_DIMS/W_METRICS/W_FORMS` dans layouts.js & userviews.js).
  Front : catalogue `W_DIMS`/`W_METRICS`, `widgetData(w,rep)` extrait depuis l'objet `rep` (source unique, AUCUN nouveau
  endpoint), `renderCustomWidget` + `renderWidgetCharts` (file `W_PENDING`, registre `W_CHARTS`).
- **Comparaison N-1 désactivable** : toggle « N vs N-1 / N seule » (Période d'analyse) → `compare=0` → `buildReport`
  ne charge AUCUN jeu N-1 et coupe les replis N-1 depuis l'OMS N (analyse mono-année possible). Période N-1 par ailleurs
  **libre** (plus de recalage auto −364 j ; bouton « ≈ −364 j » à la demande).
- Pistes : thème clair/sombre, export par carte, favoris, recherche de carte, vues partagées par équipe.

