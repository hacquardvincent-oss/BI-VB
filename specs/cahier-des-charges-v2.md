# Cahier des charges — BiDash V2
_Version : DRAFT 0.1 — 03/06/2026_
_Référence architecture : `architecture/decisions.md` (ADR-005)_

---

## 1. Vision
Application web hébergée et partagée permettant aux équipes de consulter des reportings business
e-commerce (quotidien, hebdomadaire, mensuel, analyse de saison), à partir de fichiers déposés et
**persistés** en base, sans avoir à re-déposer les données à chaque consultation.

## 2. Périmètre

### 2.1 Dans le scope (V2 — phase 1)
- Application web accessible par URL avec authentification
- Comptes utilisateurs + **administration (création/modération)** par un admin
- Ingestion par **dépôt de fichiers** : OMS/wshop, Y2, GA, référentiel produit
- **Persistance** des jeux de données (par source, par période N / N-1)
- **Anonymisation à l'ingestion** (suppression du PII client)
- Moteur de reporting réutilisant les calculs V1 (CA Global/EShop/FR/Inter/Entrepôt/SFS, Marketplace, Full/Off price, CA famille, top produits, GA)
- Vues de reporting : **quotidien, hebdomadaire, mensuel, saison**, avec comparaison N-1

### 2.2 Hors scope (phase 1, voir phases ultérieures)
- Connecteur GA4 API (phase 2)
- Connecteur API wshop (phase 3, bloqué autorisation)
- Rôles/permissions fins par périmètre (phase 4)
- Alertes automatiques, exports PDF, mobile natif

## 3. Acteurs et rôles
| Rôle | Droits |
|------|--------|
| **Admin** | Tout consulter + déposer des fichiers + **gérer les utilisateurs** (créer, activer/désactiver, supprimer, réinitialiser mot de passe) |
| **Utilisateur** | Se connecter, consulter tous les reportings, déposer des fichiers |

> Phase 1 : pas de cloisonnement des données entre utilisateurs (tout le monde voit tout).

## 4. Fonctionnalités

### F1 — Authentification & comptes
- Connexion par identifiant + mot de passe (haché)
- Page d'administration des utilisateurs (réservée admin)
- Déconnexion, session sécurisée

### F2 — Ingestion de fichiers (dépôt)
- Dépôt OMS (CSV/XLSX), Y2 (XLSX), GA (CSV), référentiel (XLSX)
- Slots **N** et **N-1** par source (comme la V1)
- Parsing serveur (réutilise les parsers V1 : `;`, windows-1252, BOM, dates FR ; GA : `,` + lignes `#`)
- **Anonymisation** : seules les colonnes KPI sont conservées (voir §6)
- Stockage en base, horodaté ; un nouveau dépôt remplace/complète la période concernée

### F3 — Persistance & rafraîchissement
- Les données restent disponibles entre les sessions et pour tous les utilisateurs
- Indication de la fraîcheur (date du dernier dépôt par source)

### F4 — Reportings
- **Quotidien** : CA du jour, comparaison J vs J-1 an
- **Hebdomadaire** : agrégat semaine, comparaison N-1
- **Mensuel** : reprise du « KPI EShop » V1 (CA, Commandes, Pièces, PM, Sessions, TT) N vs N-1
- **Saison** : agrégation par saison (colonne `Saison` Y2 / référentiel), comparaison N-1
- Toutes vues : CA Global/EShop/FR/Inter/Entrepôt/SFS, Marketplace (PDT/Lulli/GL/Printemps), Full/Off price, CA par famille, top produits

### F5 — Réutilisation logique V1
- Les fonctions de calcul V1 sont portées en modules serveur testés (CA, marketplace, GA, FP/OP)
- Les règles métier restent identiques (cf. spec de calcul validée)

### F6 — Export PDF des reportings
- Bouton « Télécharger en PDF » sur chaque vue de reporting (quotidien / hebdo / mensuel / saison)
- PDF généré **côté serveur** (pas de dépendance navigateur), reprenant : en-tête (période, date d'édition),
  KPIs EShop (CA, Commandes, Pièces, PM, Sessions, TT) N vs N-1, blocs CA (Global/FR/Inter/Entrepôt/SFS),
  tableau Marketplace, CA par famille
- Format A4, en français, identité « BiDash »
- Librairie pure JS (pdfkit) — compatible Render free (aucun binaire natif type Chromium)

## 5. Contraintes techniques
| Contrainte | Valeur |
|------------|--------|
| Hébergement | Render (free tier au démarrage) |
| Backend | Node.js + Express |
| Base de données | PostgreSQL |
| Auth | Comptes + mots de passe hachés (bcrypt/argon2) |
| Langue | Interface 100 % française |
| Confidentialité | Anonymisation à l'ingestion (pas de PII en base) |

## 6. Données conservées à l'ingestion (OMS) — liste blanche
À conserver : `Date`, `N° commande`, `Prix de vente payé`, `Prix Vente`, `Prix Vente Remisé`,
`Pays livraison`, `NOM MAGASIN`, `Type Paiement`, `Désignation produit`, `Réf. externe`,
`Quantité`, `Rayon`.
À **écarter** (PII) : Nom/Prénom client, Email, Adresse(s), Téléphone, et tout champ identifiant
une personne.

## 7. Critères d'acceptation (phase 1)
| ID | Critère | Priorité |
|----|---------|---------|
| V2-01 | Un utilisateur se connecte via l'URL et voit les reportings | MUST |
| V2-02 | L'admin crée/désactive un utilisateur | MUST |
| V2-03 | Un dépôt OMS persiste : les données restent visibles après reconnexion | MUST |
| V2-04 | Aucune donnée PII client n'est stockée en base | MUST |
| V2-05 | Le CA Global et le KPI EShop correspondent aux résultats de la V1 sur le même fichier | MUST |
| V2-06 | Vues quotidien/hebdo/mensuel/saison disponibles avec comparaison N-1 | SHOULD |
| V2-07 | Export PDF d'un reporting (KPIs + CA + marketplace + familles) | SHOULD |

## 8. À décider / confirmer
- [ ] Nom de domaine / URL (sous-domaine Render par défaut pour démarrer)
- [ ] Premier compte admin (identifiant Vincent)
- [ ] Politique de rétention des fichiers déposés
- [ ] Plan Postgres (gratuit puis payant ?) et sauvegardes
