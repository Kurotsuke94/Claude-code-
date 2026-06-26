# Rapport d'audit Maintix — Version 1.0.31

**Date** : 26 juin 2026 | **Analysé** : Claude Code (claude-sonnet-4-6)

---

## Résumé chiffré

| Catégorie | Problèmes |
|---|---|
| Composants / fonctions inutilisés | 8 |
| Pages / sections inutilisées | 5 |
| Doublons de code | 9 |
| Requêtes Firestore inutiles / problématiques | 8 |
| Erreurs console potentielles | 10 |
| Problèmes responsive | 4 |
| Problèmes de performance | 7 |
| Qualité de code | 9 |
| **Total** | **60** |

---

## 🔴 TOP 10 — Problèmes les plus urgents

| # | Fichier | Problème |
|---|---|---|
| 1 | `admin.js:1883` | `MX.modal()` appelé au lieu de `MX.showModal()` → crash garanti (TypeError) |
| 2 | `interventions.js:149` | `db.collection('users').get()` en double lecture à l'intérieur d'un listener actif |
| 3 | `interventions.js:155–163` | `_autoRetard()` : N `update()` Firestore non batchés à chaque snapshot (boucle infinie) |
| 4 | `home.js:96` | `currentUser.displayName` n'existe pas dans le modèle → affiche toujours "Utilisateur" |
| 5 | `home.js:100` | `state.config` jamais initialisé → `hotelName` toujours "Mon Hôtel" |
| 6 | `home.js:118–124` | Statuts missions `'done'`/`'annule'` incorrects vs Firestore (`m.done` boolean + `'terminee'`/`'annulee'`) → KPIs faux |
| 7 | `db.js:505–512` | `initRewardsDefaults()` non exportée dans `MX.DB` et jamais appelée → système récompenses mort |
| 8 | `app.js:800` | `Pages.Checklist.render('resp-lundi')` → devrait appeler `Pages.RespPlan.renderDay('lundi')` |
| 9 | `admin.js:1815` | `MX.toast(msg, 'success')` / `MX.toast(msg, 'error')` → succès affichés en rouge (attend un booléen) |
| 10 | `interventions.js:380–396` | `_tFiltered()` et `_tStats()` (~90 lignes) jamais appelées depuis `_body()` — code mort |

---

## 🗑️ 1. Composants / Fonctions inutilisés

### `interventions.js:380–396` — `_tFiltered()`
🔴 **Critique** — Fonction complète (17 lignes) jamais appelée depuis `_body()`. Le switch de `_body()` ne connaît que `'calendrier'` et le default `_tGestion()`. La logique est partiellement dupliquée dans `_tGestion`.

### `interventions.js:659–708` — `_tStats()`
🟠 **Important** — 50 lignes de calcul de stats (avg temps, répartition par tech, byStatus) jamais appelées. Les stats sont réimplémentées manuellement en bas de `_tGestion()` avec un code quasi-identique.

### `db.js:427–453` — Listeners Rewards jamais branchés
🟠 **Important** — `listenRewardsRules`, `listenRewardsGrades`, `listenRewardsItems`, `listenRewardsHistory`, `listenRewardsUsers` sont exportées dans `MX.DB` mais jamais appelées dans `setupListeners()`. Les collections `rewards_*` ne sont jamais lues en temps réel.

### `db.js:529–566` — Listeners Games jamais branchés
🟠 **Important** — `listenGameScores`, `listenGameAchievements`, `listenGameQuestions`, `saveGameScore`, etc. exposés dans `MX.DB` mais consommés uniquement par `minigames.js` et `rewards.js`, deux fichiers non référencés dans `NAV` ni dans `renderPage()`.

### `db.js:505–512` — `initRewardsDefaults()` / `resetRewardsDefaults()`
🔴 **Critique** — Non exportées dans `window.MX.DB` (absent de la liste export lignes 882–921) et non appelées dans `init()`. Le système de récompenses ne sera jamais initialisé.

### `admin.js:661` — `saveTeam()`
🟡 **Mineur** — Exposée dans `window.MX.Pages.Admin` mais jamais appelée dans le HTML généré par `renderTeam()`. Les sauvegardes utilisent uniquement `_autoSaveTeam()` via debounce.

### `admin.js:795` — `saveAlerts()`
🟡 **Mineur** — Même problème : exposée mais jamais appelée depuis le HTML. `renderAlerts()` utilise `togAlert` et `updAlert` avec autosave.

### `admin.js:824–826` — `saveProd()`
🟡 **Mineur** — Exposée dans le namespace Admin mais aucun bouton HTML dans `renderOrders()` ne l'appelle.

---

## 📄 2. Pages / Sections inutilisées

### `app.js:80` — Route `"admin"` orpheline
🟡 **Mineur** — La route `id === "admin"` dans `renderPage()` est définie mais l'id `"admin"` n'apparaît nulle part dans le tableau `NAV`. Seul `"utilisateurs"` permet d'accéder au panneau Admin.

### `app.js:87` — Page `"fournisseurs"` stub
🟠 **Important** — La page Fournisseurs est dans `NAV`, affichée dans la sidebar, mais rend uniquement `_renderStub(...)` avec "La gestion des fournisseurs sera disponible prochainement." Présente depuis au moins la v1.0.28.

### `admin.js:1662–1696` — Section "Architecture multi-hôtels" et "Licences" non fonctionnelles
🟡 **Mineur** — Section "Architecture multi-hôtels" liste des fonctions "à venir", section "Licences" affiche des plans hardcodés (Standard, Groupe) sans logique fonctionnelle.

### `admin.js:1881–1921` — 4 boutons Maintenance BDD non implémentés
🟠 **Important** — Les boutons `badges`, `stats`, `conso`, `integrity` affichent un toast de succès sans aucune opération réelle. L'UI indique "modifient directement Firestore" — trompeur pour des actions critiques.

### `minigames.js` et `rewards.js`
🟠 **Important** — Ces fichiers sont chargés dans `index.html` mais leurs pages n'apparaissent ni dans `NAV` ni dans `renderPage()`. Inaccessibles depuis l'interface. Toutes les collections Firestore `rewards_*` / `games_*` sont du dead code fonctionnel.

---

## ♻️ 3. Doublons

### Calcul progression semaine — 4 occurrences
🟠 **Important** — La boucle `totalAll/doneAll` sur `DAYS × getDaySlots × tasks × checks` est dupliquée dans :
- `home.js:103–113`
- `admin.js:516–526`
- `app.js:431–446`
- `admin.js:851` — `_buildWeekStats()`

Une fonction utilitaire centralisée dans `helpers.js` s'impose.

### `interventions.js:329–366` / `659–708` — Stats interventions dupliquées
🟠 **Important** — Le calcul `byTech`, `avgMin`, `done.filter(iv => iv.timeSpentMin)` est présent deux fois avec un code quasi-identique.

### `helpers.js:34–42` / `interventions.js:82–85` — Fonction `esc()` redéfinie
🟡 **Mineur** — `interventions.js` redéfinit localement sa propre version de `esc()` alors que `MX.esc` est disponible globalement.

### `consommations.js:38` — Fonction `esc` locale
🟡 **Mineur** — Même pattern : redéfinition locale de `esc`.

### `app.js:523–526` / `helpers.js:44–53` — Deux `_fmtTime`
🟡 **Mineur** — `app.js` définit sa propre `_fmtTime(d)` (retourne `"HH:MM"`) alors que `helpers.js` exporte `MX.fmtTime(ts)` (relatif). Noms identiques, logiques différentes — source de confusion.

### `admin.js:232–236` + `300–303` — `prioBtnStyle` / `eprioBtnStyle`
🟡 **Mineur** — Deux fonctions strictement identiques dans `renderMissions()` pour les formulaires création/édition. Même body exact.

### `app.js:400–410` / `app.js:417–448` — Calcul `seen/unread` dupliqué
🟡 **Mineur** — `_updBadges()` et `_doUpdateNavProgress()` partagent le même calcul `seen/unread` et les mêmes mises à jour DOM sur `sxb_msgs`, `bnb_msgs`, `dh-bell-badge`.

### `db.js:615–624` / `app.js:838` — `_DEF_SHIFTS` / `_SHIFT_TO_SLOT`
🟡 **Mineur** — `db.js` définit `_DEF_SHIFTS`, `app.js` redéfinit `_SHIFT_TO_SLOT` — deux mappings représentant la même donnée de configuration, découplés sans raison.

### Tableaux de noms jours/mois FR — 3 définitions
🟡 **Mineur** — `DOW_FR`, `MOIS_FR`, `MOIS_SH` définis séparément dans `interventions.js:49–55`, `helpers.js` et `planning.js`.

---

## 🔥 4. Requêtes Firestore inutiles / problématiques

### `interventions.js:149–151` — `.get()` dans un listener
🔴 **Critique** — `db.collection('users').get()` exécuté à l'intérieur de `_load()` à chaque render. La collection `users` est déjà dans `MX.state.users` via `listenUsers()`. Double lecture inutile qui contourne l'abstraction MX.DB.

### `interventions.js:155–163` — `_autoRetard()` : N updates sans batch
🔴 **Critique** — À chaque snapshot, `_autoRetard()` appelle `DB.int().doc(iv.id).update(...)` pour chaque intervention en retard — 10 interventions en retard = 10 writes séparés. Ces writes déclenchent un nouveau snapshot → boucle infinie. Doit utiliser un batch et vérifier que le statut change réellement avant d'écrire.

### `app.js:761–768` — Listeners Announcements → full re-render Home
🟠 **Important** — `listenAnnouncements` déclenche `Pages.Home.render()` sur chaque modification (y compris une réaction emoji ou un `readBy`). Un changement de réaction = re-render complet de la Home.

### `admin.js:94–99` — `listenAdminJournal` → `render()` en boucle potentielle
🟠 **Important** — Le callback de `listenAdminJournal` appelle `render()` directement. `render()` reconstruit tout le panneau Admin. Chaque écriture dans `admin_journal` déclenche un re-render complet. Risque de boucle si l'écriture est déclenchée depuis `render()`.

### `db.js:700–703` — `listenAdminJournal` non stocké dans `_unsub`
🟠 **Important** — Le handle unsubscribe n'est pas dans `_unsub`. Il ne sera pas désabonné par `unsubAll()` lors de la destruction de la session.

### `bible.js:563–568` — `listenBibleArticles` jamais désabonné
🟠 **Important** — Initialisé avec un guard `if (!_unsubArticles)` correct, mais jamais désabonné si l'utilisateur quitte la page Bible. Memory leak accumulé.

### `db.js:632–641` — `loadPlanningMonth` non temps réel
🟡 **Mineur** — Chargé une seule fois au démarrage dans `setupListeners()`. Si le planning change pendant la session, les suggestions ne se mettent jamais à jour.

### `db.js:341–347` — `deleteAnnouncement` : ordre lecture/batch inversé
🟡 **Mineur** — `get()` pour récupérer `imageUrl` est fait avant de committer le batch. Si le batch échoue, la lecture a quand même eu lieu. L'ordre devrait être inversé.

---

## ⚠️ 5. Erreurs console potentielles

### `admin.js:1883` — `MX.modal()` n'existe pas
🔴 **Critique**
```javascript
// Code actuel (CRASH)
MX.modal({ title: '⚠️ Confirmation requise', ... });

// Correct
MX.showModal('⚠️ Confirmation requise', sub, actions);
```
Tout clic sur les 5 boutons "Maintenance BDD" → `TypeError: MX.modal is not a function`.

### `home.js:118–124` — Statuts missions incohérents
🔴 **Critique**
```javascript
// Code actuel (faux)
m.status !== 'done' && m.status !== 'annule'

// Réalité Firestore du module admin
m.done === true  // pour "terminé"
// interventions.js utilise : 'terminee' / 'annulee'
```
KPIs `mOpen`, `mLate`, `mUrgent`, `mDoneToday` sont tous faux.

### `home.js:96` — `displayName` inexistant
🟠 **Important**
```javascript
// Code actuel (toujours 'Utilisateur')
currentUser.displayName || currentUser.email || 'Utilisateur'

// Correct — champ réel dans Firestore
currentUser.name || 'Utilisateur'
```

### `home.js:100` — `state.config` jamais peuplé
🟠 **Important** — `getHotelConfig()` existe dans `MX.DB` mais n'est jamais appelé pour peupler `state.config`. `hotelName` affiche toujours "Mon Hôtel".

### `app.js:793–800` — `Checklist.render('resp-lundi')`
🟠 **Important** — Le listener `listenUserBadges` appelle `Pages.Checklist.render(cp)` pour les pages `resp-*`. `Pages.Checklist.render()` attend un `dayId` (`'lundi'`) pas `'resp-lundi'`. Devrait appeler `Pages.RespPlan.renderDay(cp.slice(5))`.

### `admin.js:1815` — `MX.toast(msg, 'success')` mauvais type
🟡 **Mineur**
```javascript
// Code actuel (affiche en rouge car 'success' est truthy)
MX.toast('Fiche hôtel enregistrée', 'success');

// Correct (err est un booléen)
MX.toast('Fiche hôtel enregistrée');        // succès (pas de 2e arg)
MX.toast('Erreur lors de la sauvegarde', true); // erreur
```
Affecte : `_hotelSaveInfo()`, `_verSave()`, `_dbRepairExecute()`.

### `auth.js:148–155` — Fallback PIN texte clair
🟠 **Important** — Si le PIN stocké ne matche pas le regex SHA-256, il est comparé en texte clair. Les anciens PINs non hashés restent en clair dans Firestore. Migration non forcée.

### `interventions.js:124` — `.trim()` sur `null` potentiel
🟡 **Mineur** — `_techAvatars(iv.assignedTo)` avec `name` pouvant être `null` dans un tableau mal formé → `name.trim()` crash.

### `checklist.js` — `toggleMission()` sans vérif `cu`
🟡 **Mineur** — `cu.name` utilisé pour `completedBy` sans vérifier si `cu` existe. Si déconnexion entre ouverture et confirmation du modal → TypeError.

### `helpers.js:241` — `o.sub` injecté en innerHTML
🟡 **Mineur** — La propriété `sub` du modal est injectée via `.innerHTML` sans sanitisation systématique. Les appelants passent du HTML inline (`<strong>`, `<small>`) — acceptable actuellement mais risque si `sub` peut contenir du contenu utilisateur.

---

## 📱 6. Problèmes responsive

### `components.css` — Touch targets interventions < 44px
🟠 **Important** — Les boutons `.int-act-btn` ont `padding:4px 8px`. Sur mobile avec `.int-act-txt` masqué (icône seule), la cible mesure ~30×30px. La section `@media (hover: none)` n'augmente pas `.int-act-btn`. Minimum Apple HIG / Material : 44×44px.

### `components.css` — `.int-cal-grid` non responsive < 360px
🟠 **Important** — La grille calendrier semaine génère 8 colonnes avec la première à `40px` fixe. Pas d'`overflow-x:auto` sur `.int-cal-scroll` pour les écrans < 360px.

### `components.css:3089–3546` — Bible sidebar fixe sur tablette
🟡 **Mineur** — `.bl-layout` en flex row avec sidebar de `240px` fixe. Sur 769px–900px (tablette portrait), le contenu principal est très étroit. La media query passe en colonne à `max-width:768px` seulement.

### `main.css:695–768` — Bottom nav 7 items sur 360px
🟡 **Mineur** — Avec l'admin, 7 boutons dans la bottom nav. Sur 360px, chaque bouton fait ~51px. Labels tronqués mais fonctionnel. Surcharge visuelle réelle.

---

## ⚡ 7. Problèmes de performance

### `interventions.js:155–163` — Boucle snapshot → writes → snapshot
🔴 **Critique** — `_autoRetard()` génère N writes Firestore à chaque snapshot, ce qui déclenche un nouveau snapshot → boucle infinie si des interventions sont en retard. Fix : batch + guard `if (iv.statut !== 'en_retard')`.

### `app.js:655–848` — Chaque listener → `render()` complet
🟠 **Important** — Les listeners dans `setupListeners()` appellent directement `Pages.Home.render()` / `Pages.Checklist.render()`. Si 3 listeners se déclenchent en rafale au démarrage, la page Home est renderée 3 fois de suite. `updateNavProgress()` utilise un rAF pour dédoubler, mais pas les renders de pages.

### `db.js:397–405` — 2 `setInterval` sans Page Visibility API
🟠 **Important** — `setInterval` de présence (60s) dans `listenPresence()` + heartbeat (120s) dans `app.js:900`. Les deux tournent indéfiniment sans pause quand l'app est en arrière-plan (Page Visibility API non utilisée).

### `home.js:140–150` — `_getCsoState()` appelé à chaque render
🟠 **Important** — `MX.Pages.Conso._getCsoState()` parcourt `meters` et `readings` à chaque re-render de Home. Si Home se re-rend 5 fois au démarrage (un listener par type), `_getCsoState()` est appelé 5 fois.

### `admin.js:94–99` — Listener Journal → `render()` complet
🟠 **Important** — Chaque écriture dans `admin_journal` déclenche un re-render complet du panneau Admin (toutes les tabs).

### `db.js:693–699` — `listenAllTasks` : 17 listeners simultanés
🟡 **Mineur** — Un listener `onSnapshot` par `(dayId, slot)` : 5 jours × 3 slots + 2 weekends × 1 slot = **17 listeners Firestore ouverts** simultanément. Correct conceptuellement (évite de lire toute la collection) mais coûteux en connexions.

### `interventions.js:809–816` — Canvas non détruit après compression photo
🟡 **Mineur** — `_compressInt()` crée un `<canvas>` à chaque photo sans le détruire (`canvas.width = 0`). Sur iOS (GC moins agressif), accumulation mémoire possible sur longue session.

---

## 🧹 8. Qualité de code

### `admin.js` — 1945 lignes, 14 fonctions > 100 lignes
🟠 **Important** — `render()` (103 l), `renderMissions()` (165 l), `renderSuperAdmin()` (165 l), `generateReport()` (70 l HTML inline). Le fichier couvre 14 onglets dans un seul IIFE sans séparation de responsabilités.

### `admin.js` — Magic strings CSS inline répétées
🟠 **Important** — Les styles de boutons de priorité sont construits par concaténation CSS inline dans `prioBtnStyle`/`eprioBtnStyle`. La même chaîne CSS apparaît 6 fois. Des classes CSS dédiées (`btn-prio--active`, `btn-prio--inactive`) élimineraient ce code.

### `admin.js:1881–1921` — Stubs trompeurs en production
🟠 **Important** — 4 boutons Maintenance BDD affichent un toast "succès" sans logique. L'UI indique "Ces outils modifient directement les données Firestore" → trompe l'utilisateur sur des actions critiques.

### `db.js:270–281` — Double read Firestore dans `savePlanning`/`clearPlanning`
🟡 **Mineur** — Font un `.get()` sur `config/planning` avant de `.set()` pour récupérer l'`imageUrl`. `MX.state.planningUrl` est déjà disponible via le listener — pas besoin de re-lire.

### `app.js:839–847` — Logique planning cachée en bas de `setupListeners()`
🟡 **Mineur** — La section "Planning suggestions for today" est un `.then()` asynchrone isolé sans structure claire. Devrait être dans `DB.listenPlanningShifts` ou dans un listener dédié.

### `interventions.js:49–55` — Tableaux jours/mois FR redéfinis localement
🟡 **Mineur** — `DOW_FR`, `MOIS_FR`, `MOIS_SH` définis ici alors que `helpers.js` et `planning.js` ont leurs propres versions. 3 définitions identiques dans le projet.

### `admin.js:1662–1695` — Contenu "à venir" en production
🟡 **Mineur** — Items "à venir" (🕐) visibles par les utilisateurs dans l'interface de production. À masquer derrière un flag ou supprimer.

### `sw.js:1–11` — Config Firebase hardcodée (acceptable mais à documenter)
🟡 **Mineur** — Config complète Firebase en clair dans `sw.js`. Pratique acceptée pour Firebase client-side (les Firestore Security Rules protègent), mais l'`apiKey` est visible dans les DevTools. À documenter explicitement.

### `auth.js:148–155` — Migration PIN non forcée
🟠 **Important** — Fallback comparaison PIN en texte clair pour les anciens comptes non migrés vers SHA-256. La migration devrait être forcée à la prochaine connexion admin.

---

## Plan de correction recommandé

### Sprint 1 — Corrections critiques (1–2h)
```
1. admin.js:1883      MX.modal() → MX.showModal()
2. home.js:96         displayName → name
3. home.js:118–124    Corriger filtres missions (m.done vs m.status)
4. admin.js:1815      MX.toast(msg,'success') → MX.toast(msg) / MX.toast(msg,true)
5. interventions.js:149  Supprimer db.collection('users').get() → utiliser MX.state.users
```

### Sprint 2 — Corrections importantes (2–4h)
```
6. interventions.js:155–163  Batcher _autoRetard() + guard statut
7. home.js:100               Charger hotelName depuis MX.DB.getHotelConfig()
8. app.js:800                Corriger routing resp-* vers Pages.RespPlan
9. interventions.js:380–708  Supprimer _tFiltered() et _tStats() (dead code)
10. bible.js:563             Désabonner listenBibleArticles à la navigation
```

### Sprint 3 — Nettoyage & performance (4–8h)
```
11. Extraire calcul progression semaine dans helpers.js (4 doublons)
12. Supprimer/implémenter les 4 stubs Maintenance BDD
13. Ajouter overflow-x:auto sur .int-cal-scroll (responsive)
14. Corriger touch targets .int-act-btn (min 44×44px)
15. Mettre à jour auth.js : forcer migration PIN SHA-256
16. Désabonner les listeners Rewards/Games ou les supprimer si non utilisés
17. Page Visibility API sur les setInterval de présence/heartbeat
18. Lazy evaluation de _getCsoState() dans home.js
```
