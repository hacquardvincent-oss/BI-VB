# Démo autonome (sans API)

Service de démonstration : l'app tourne **sans aucune API ni upload**, à partir d'un
**instantané de données** chargé au démarrage.

## Préparer le snapshot
1. Sur l'app de prod (connecté en **admin**), clique **« 🎬 Exporter les données (démo) »**
   (panneau « Chargement des données »), ou ouvre `/api/admin/export-datasets`.
2. Tu obtiens `bi-demo-snapshot.json`. Renomme-le **`snapshot.json`** et place-le dans ce dossier
   (`demo/snapshot.json`), puis commit.

## Déployer le service démo (Render)
Nouveau service à partir du **même dépôt**, avec ces variables d'environnement :
- `DEMO_MODE=1`              → charge `demo/snapshot.json` au boot, masque les connecteurs
- `ADMIN_USERNAME=demo`      → identifiant du compte démo dédié
- `ADMIN_PASSWORD=…`         → mot de passe démo
- `SESSION_SECRET=…`         → secret de session (au hasard)
- **AUCUNE** clé API (WSHOP/GA4/Ads/Meta) ni `DATABASE_URL`

Au démarrage, le log affiche `[demo] mode DÉMO actif — N jeu(x) chargé(s)`.
