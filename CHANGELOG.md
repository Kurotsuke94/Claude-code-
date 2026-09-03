# Changelog — Maintix

## v1.1.08 — 2026-09-03 🔒📱 Check-lists personnelles + fiabilité mise à jour mobile

**Check-lists — validations propres à chaque technicien**
- Les validations de tâches de la check-list du jour n'étaient identifiées que par jour de semaine + créneau + tâche (`lundi_matin_xyz`), sans technicien ni date réelle : une case cochée par un technicien apparaissait cochée pour tous, y compris les semaines suivantes.
- Nouvelle clé de validation : technicien + année/semaine ISO + date + créneau + tâche (`MX.checkKey`/`MX.checkOwnerId`), appliquée partout où les validations sont lues ou écrites (technicien, responsable/admin, missions, alertes, récompenses), y compris pour la semaine en cours dans les écrans responsable (calendrier mensuel, cartes des 8 semaines, détail d'une semaine).
- Chaque technicien démarre sa journée avec des tâches non validées par défaut ; les validations restent propres à son compte et persistent après actualisation. Sélectionner un créneau ne valide plus aucune tâche automatiquement.
- Les semaines archivées conservent leur ancien format de données, inchangé.

**Mise à jour de l'application sur mobile (iOS/Android)**
- Cause racine identifiée : les fichiers CSS/JS de `index.html` référençaient encore `?v=206`, gelé depuis plusieurs versions, alors que Firebase Hosting sert ces fichiers avec un cache d'un an — les téléphones ne récupéraient donc jamais les nouveaux fichiers tant que cette valeur ne changeait pas. `mx-room-list.js` était resté figé à `?v=1` depuis son introduction.
- Toutes les références de version (`index.html`, `manifest.json`) sont réalignées sur le build courant à chaque publication.
- Bandeau de mise à jour : message et bouton reformulés (« Une nouvelle version de Maintix est disponible. Rechargez l'application. » / « Mettre à jour maintenant »). Le mécanisme sous-jacent (détection, activation, rechargement sans déconnexion, anti-boucle) existait déjà et reste inchangé.

## v1.1.07 — 2026-07-07

- Redesign en cours du planning.
- Correctifs PMP.
- Améliorations de stabilité.
- Mise à jour PWA.

## v1.0.34 — 2026-07-04 🚀 Espace de travail Mission & Déploiement automatique

- Espace de travail quotidien : vue 25 %/75 % avec panneau latéral de tâches
- Sélection de tâche avec consigne, note et boutons de validation
- Mise à jour obligatoire et transparente : écran de déploiement automatique
- Mode Maintenance : blocage des techniciens pendant les déploiements admin
- Historique de déploiement enregistré dans Firestore (`config/maintenance/deploy_log`)
- Section "Maintenance" dans Paramètres (admin uniquement)
- Numéro de build affiché dans la barre de statut et la section À propos
- "Bienvenue" affiché une seule fois au premier lancement de la nouvelle version
- `pmp.js` ajouté au manifeste du Service Worker (SHELL)

## v1.0.33 — 2026-06-26 🔔 Centre de notifications unifié

- Icône 🔔 avec compteur dans la barre supérieure
- Panneau rapide : 10 dernières notifications par catégorie
- Page complète avec filtres : Messages, Interventions, Stock, Badges, Mises à jour, Système
- Notifications automatiques : nouveau message, stock faible, badge obtenu, version
- Actions : marquer lu, tout marquer lu, archiver, supprimer
- Activité récente de l'accueil synchronisée avec le centre

## v1.0.32 — 2026-06-26 🔧 Corrections Sprint 1 & 2

- KPI missions cockpit corrigés (schéma admin vs interventions)
- Toasts admin corrigés (format boolean)
- Optimisation `_autoRetard()` — batch Firestore + early return
- Libération listener Firestore Bible à la navigation
- Nom hôtel et utilisateur corrects dans l'accueil

## v1.0.31 — 2026-06-26 🚀 Système de gestion des versions

- Notification automatique lors d'une nouvelle version
- Section "Nouveautés" dans Paramètres avec historique complet
- Badge "Nouvelle version" dans la barre supérieure
- Bannière PWA de mise à jour améliorée
- Gestion des versions dans Super Admin (Firestore)

## v1.0.30 — 2026-06-20 📊 Dashboard ultrawide & cockpit redesign

- Grille cockpit responsive (mobile → 2560 px+)
- Fil d'activité enrichi avec missions et messages
- Indicateurs d'évolution des consommations (▲/▼)
- KPIs adaptés aux écrans 2560 px et 3200 px+
- Suppression des limitations de largeur ultrawide

## v1.0.29 — 2026-06-10 🏨 Configuration hôtel & maintenance BDD

- Panel Super Admin avec fiche hôtel complète (14 champs)
- Sélecteurs de couleur pour l'identité visuelle
- Outils de maintenance Base de Données (5 opérations)
- Suppression du fond industriel/blueprint
- Fonctions `getHotelConfig` / `saveHotelConfig` en Firestore

## v1.0.28 — 2026-05-15 ⭐ Badges professionnels & présence temps réel

- Système de badges professionnels assignables
- Indicateur de présence en temps réel
- Heartbeat de présence toutes les 2 minutes
- Affichage des badges dans le header utilisateur
