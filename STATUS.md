# STATUS.md — BiDash
_Mis à jour : 03/06/2026_

## Objectif de la prochaine session
Scaffolder l'application V2 sur Render : backend Node.js + Express, PostgreSQL, authentification
avec administration des comptes, ingestion de fichiers persistée, portage des calculs V1.

---

## Session du 03/06/2026
### Réalisé
- Récupération de tous les fichiers projet ajoutés au dépôt (specs, ADR, plan de tests, référentiel) + `bidash.html`
- Consolidation de STATUS en un seul fichier markdown
- **Audit complet de `bidash.html`** (2280 lignes) : voir bugs/code mort ci-dessous
- Décisions d'architecture V2 actées (ADR-005)
- Rédaction du **cahier des charges V2** (`specs/cahier-des-charges-v2.md`)
- Mise à jour du CONTEXT (passage en markdown, correction du rôle de Y2, direction V2)
- Conversion en markdown : `CONTEXT.md`, `architecture/decisions.md`

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
1. Scaffolding V2 : repo app (Node/Express), Postgres, déploiement Render
2. Auth + administration des utilisateurs (admin crée/modère)
3. Ingestion fichiers persistée + anonymisation à l'ingestion
4. Portage des calculs V1 en modules serveur testés
5. Reportings quotidien / hebdo / mensuel / saison (comparaison N-1)
6. (Phase 2) Connecteur GA4 API
7. (Phase 3) Connecteur API wshop
8. (Optionnel) Correctifs V1 : dashboard GA, TT, code mort
