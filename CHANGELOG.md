# Changelog — Maintix

## v1.1.09 — 2026-09-03 🔧 Correctif vues responsable/admin (v1.1.08)

- La v1.1.08 avait migré `state.checks` vers la nouvelle clé longue (technicien+date+…) mais 4 écrans responsable/admin lisaient encore l'ancienne clé courte pour la semaine en cours (via une variable locale `chk`, non détectée par la recherche initiale) : calendrier mensuel (`_renderMonthlyHtml`), cartes des 8 semaines (`_renderWeekSlotsHtml`), détail d'une semaine (`_renderWeekDayGrid`).
- Conséquence : la semaine en cours s'affichait à 0 % dans ces 3 écrans même quand les techniciens avaient bien validé leurs tâches.
- Corrigé : ces écrans lisent désormais la nouvelle clé (`MX.checkKey`/`MX.checkOwnerId`) pour la semaine en cours, et conservent l'ancienne clé courte pour les semaines archivées (format inchangé, non concerné).
- Recherche exhaustive confirmée : plus aucune lecture de `state.checks` (semaine en cours) n'utilise l'ancien format de clé.

## v1.1.08 — 2026-09-03 🔒 Correctif checklists partagées entre techniciens

- Les validations de tâches de la check-list du jour n'étaient identifiées que par jour de semaine + créneau + tâche (`lundi_matin_xyz`), sans technicien ni date réelle : une case cochée par un technicien apparaissait cochée pour tous, y compris les semaines suivantes.
- Nouvelle clé de validation : technicien + année/semaine ISO + date + créneau + tâche (`MX.checkKey`/`MX.checkOwnerId`).
- Chaque technicien démarre désormais sa journée avec des tâches non validées par défaut ; les validations restent propres à son compte et persistent après actualisation.
- Sélectionner un créneau horaire ne valide plus aucune tâche automatiquement (vérifié : ce n'était déjà pas le cas).
- Vue responsable/admin inchangée : elle continue d'afficher l'état de validation du technicien assigné à chaque tâche.

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
