# CONTEXT.md — BiDash
_Dernière mise à jour : 03/06/2026_

⚠️ RECHARGER CE FICHIER EN DÉBUT DE CHAQUE SESSION CLAUDE

---

## Projet en une phrase
Outil de BI permettant au responsable e-commerce **et à ses équipes** de piloter l'activité,
à partir d'exports CSV/XLSX (wshop / e-shop, Y2 / ERP, Google Analytics) — en cours d'évolution
vers une **application web hébergée, multi-utilisateurs, à données persistées**.

## Objectif à terme
Interface de data visualisation connectée directement aux systèmes (wshop, CRM, ads, SAV),
remplaçant un besoin BI aujourd'hui non couvert.

## Phase actuelle
**Transition V1 → V2.**
- **V1** (existant) : prototype `bidash.html` mono-poste, 100 % navigateur, sans serveur. Fonctionnel.
- **V2** (cible, démarrage) : application web hébergée (Render), multi-utilisateurs, données persistées,
  reportings quotidien / hebdo / mensuel / saison. Voir `architecture/decisions.md` (ADR-005)
  et `specs/cahier-des-charges-v2.md`.

## Stack technique
### V1 (existant)
- HTML / CSS / JavaScript vanilla, **SheetJS** (parsing CSV/XLSX) + **Chart.js** (viz)
- Fichier unique `bidash.html`, ouvrable dans tout navigateur, aucune dépendance serveur

### V2 (cible)
- **Backend Node.js** (Express) — réutilise la logique de calcul JS de la V1
- **PostgreSQL** — persistance des données (les équipes ne re-déposent pas à chaque fois)
- **Authentification** par comptes, avec **création/modération d'utilisateurs** par un admin
- **Hébergement Render** (free tier pour démarrer)
- Frontend : réutilisation de l'UI V1, alimentée par l'API

## Sources de données
| Source | Système | Format | Contenu réel | Mode V2 |
|--------|---------|--------|--------------|---------|
| E-shop | wshop   | CSV/XLSX | Commandes (lignes article) : date, prix payé, pays, magasin, type paiement, produit | Dépôt fichier (API wshop indispo — autorisation requise) |
| Marketplace / ERP | Y2 | XLSX | **Lignes de vente** pour le **CA Marketplace** (PDT, Lulli, GL). ⚠️ **PAS du stock.** | Dépôt fichier |
| Trafic | Google Analytics (GA4) | CSV | Sessions, utilisateurs, canaux, revenu, engagement | Dépôt fichier (connecteur GA4 API = phase ultérieure) |
| Référentiel | Y2 | XLSX | Réf. externe → familles produits (CA par famille) | Dépôt fichier |

> **Note Y2** : le rôle « stock (référence, quantité, seuil) » décrit dans les anciennes specs ne
> correspond PAS aux fichiers réels. Les exports Y2 fournis sont des lignes de vente servant au
> CA Marketplace. Les KPIs « stock » sont retirés du périmètre tant qu'un vrai export de stock
> n'est pas fourni.

## Ce qui est FAIT ✅
- [x] Cadrage du besoin
- [x] Prototype BiDash V1 (staging multi-fichiers N/N-1, calculs CA EShop/FR/Inter/Entrepôt/SFS/Marketplace, Full/Off price, CA famille, top produits, comparaison N-1, GA partiel)
- [x] Analyse des fichiers exemples réels (wshop, Y2, GA) + règles de calcul validées
- [x] Audit de la V1 (bugs et code mort identifiés — voir STATUS)
- [x] Décisions d'architecture V2 (hébergement, auth, sources, réutilisation calculs)
- [ ] Cahier des charges V2 validé
- [ ] Scaffolding application V2 (Node + Postgres + auth sur Render)
- [ ] Portage des calculs V1 côté serveur
- [ ] Connecteur GA4 API (phase ultérieure)
- [ ] Connecteur API wshop (bloqué : autorisation requise)

## Contraintes
- Interface 100 % française
- Compatible navigateurs modernes (Chrome, Firefox, Edge)
- **Données sensibles** : la V2 héberge les données dans le cloud. Règle **anonymisation à
  l'ingestion** : on ne conserve que les colonnes nécessaires aux KPIs ; le PII client
  (nom, prénom, email, adresse, téléphone) est **écarté dès l'import**.
- Démarrage à coût nul (Render free tier) — prévoir montée en gamme si besoin (cold start, expiration Postgres gratuit)

## Acteurs
- **Utilisateur principal / admin** : Vincent (responsable e-commerce)
- **Équipes** : accès consultation (rôles affinables plus tard ; pour l'instant tout le monde voit tout)
- **Systèmes sources** : wshop (e-shop), Y2 (ERP), Google Analytics

## Liens utiles
- Fichier BiDash V1 : `bidash.html` (racine du dépôt)
- Dossier Drive projet : https://drive.google.com/drive/folders/1dP0nFxUMG49I8sbx4k2r61b4Pa0vkfjQ
- Dossier exemples fichiers : https://drive.google.com/drive/folders/1M9rPAVNCzlP_T2-CIj2Ob_R2CnL4hT-m

## Conventions
- Documents projet en **Markdown** (`.md`) pour un versioning Git lisible
- Toute décision technique → `architecture/decisions.md` avec date et justification
- Toute session → mise à jour `STATUS.md` avant clôture
