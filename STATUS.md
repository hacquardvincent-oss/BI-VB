# STATUS.md — BiDash
_Mis à jour : 02/06/2026_

## Objectif de la prochaine session
Définir les colonnes Y2 (stock) et GA (trafic) pour intégrer leurs KPIs dans le dashboard.

---

## Session du 02/06/2026
### Réalisé
- Prototype BiDash v1 validé (HTML standalone, drag & drop, KPIs, charts, table)
- Bug CA Global corrigé : filtre `gl.com` (avec point) — évitait d'exclure "Global-e"
- Bug timezone corrigé : comparaison de dates sans `new Date(isoString)`
- Bug CSV parser corrigé : gestion des champs entre guillemets
- Bug JS corrigé : suppression du plugin `chartjs-plugin-datalabels` CDN qui crashait le script
- Normalisation des headers corrigée : remplacement explicite des accents
- CA Global confirmé à **916 k€** sur export_oms_produit_client_911.csv
- Diagnostic embarqué (masqué par défaut, bouton "Diagnostic")
- Graphiques fixés en hauteur (220px) — ne s'étendent plus
- **Écran de staging multi-fichiers** : slots N / N-1 pour OMS, Y2, GA — drag & drop, validation manuelle avant chargement
- Dashboard dynamique : sections Y2 et GA masquées si fichiers non chargés
- Comparaison N-1 : utilise le fichier N-1 chargé s'il existe, sinon cherche dans le fichier N

### Décisions prises
- Architecture v1 maintenue : HTML pur côté client, SheetJS + Chart.js, aucun serveur
- CA Global = somme "Prix de vente payé" SAUF Type Paiement contenant "gl.com" ou "printemps"
- Encodage fichier wshop : windows-1252
- Identification des fichiers : l'utilisateur choisit le slot manuellement (pas d'auto-détection)
- Comportement fichiers partiels : dashboard actif, comparaison N-1 grisée si fichier manquant

### Points ouverts
- ⚠️ Colonnes Y2 (stock) non définies — KPIs stock à concevoir
- ⚠️ Colonnes GA (trafic) non définies — format export GA4 à confirmer
- 🔲 Cahier des charges v1 pas encore formalisé
- 🔲 Architecture v2 (connexions directes API) non définie

## Backlog priorisé
1. Définir colonnes Y2 + intégrer KPIs stock (référence, quantité, seuil, prix achat)
2. Définir colonnes GA + intégrer KPIs trafic (sessions, sources, conversions)
3. Rédiger cahier des charges v1 complet
4. Amélioration UX : filtres par rayon / magasin / pays
5. Définir vision v2 (connexions directes API)
