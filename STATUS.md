# STATUS.md — BiDash
_Mis à jour : 02/06/2026_

## Objectif de la prochaine session
Implémenter l'écran de chargement multi-fichiers avec slots N / N-1 pour OMS, Y2 et GA.

---

## Session du 02/06/2026
### Réalisé
- Prototype BiDash v1 validé (HTML standalone, drag & drop, KPIs, charts, table)
- Bug CA Global corrigé : filtre `gl.com` (avec point) — évite d'exclure "Global-e"
- Bug timezone corrigé : comparaison de dates sans `new Date(isoString)`
- Bug CSV parser corrigé : gestion des champs entre guillemets
- Bug JS corrigé : suppression du plugin `chartjs-plugin-datalabels` CDN
- Normalisation des headers corrigée : remplacement explicite des accents
- CA Global confirmé à **916 k€** sur export_oms_produit_client_911.csv
- Diagnostic embarqué (masqué par défaut) pour valider les calculs
- Graphiques fixés en hauteur (220px)

### Décisions prises
- Architecture v1 : HTML pur côté client, SheetJS + Chart.js, aucun serveur
- CA Global = somme "Prix de vente payé" SAUF Type Paiement contenant "gl.com" ou "printemps"
- Encodage fichier wshop : windows-1252

### Points ouverts
- ⚠️ Fichiers Y2 (stock) et GA (trafic) pas encore intégrés
- ⚠️ Architecture multi-fichiers (N + N-1) à concevoir
- 🔲 Cahier des charges v1 pas encore formalisé

## Backlog priorisé
1. **[EN COURS]** Écran de chargement multi-fichiers (OMS N/N-1, Y2 N/N-1, GA N/N-1) — validation manuelle
2. Dashboard dynamique selon fichiers chargés
3. Intégrer Y2 (stock) — nouveaux KPIs
4. Intégrer GA (trafic) — sessions, sources, conversions
5. Cahier des charges v1 complet
6. Vision v2 (connexions directes API)
