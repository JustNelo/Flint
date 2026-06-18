# Flint — Redesign « Établi » (Forge) — Design

> Statut : validé en brainstorming le 2026-06-16. Sert de base au plan d'implémentation.
> Branche de travail : `feat/flint-redesign`.

## 1. Contexte & objectifs

Flint (Tauri v2 + React) propose 16 outils image/PDF/dev. La première passe de redesign a
livré une identité corail/violet, un logo, un ⌘K et des états vide/actif. Le résultat reste
**trop générique** : sidebar + colonne centrée 680px + dropzone + grille + gros CTA + bandeau
de résultats — le patron « tool SaaS » que tout le monde a déjà vu.

**Demande** : quelque chose de **plus créatif** et **plus UX-friendly**.

**Ambition retenue** : *repenser l'expérience ET l'identité* (option équilibrée — ni simple
re-skin, ni réinvention totale d'une app fraîchement livrée).

**4 douleurs UX à traiter (toutes retenues)** :
1. Colonne centrée vide/fade (mauvaise occupation de l'espace, peu de focus).
2. Résultats en cul-de-sac (pas de chaînage vers l'action suivante).
3. Navigation des 16 outils (découverte, regroupement, switch).
4. Flux par lot / fichiers (ajout, réordre, contrôle, avant/après).

## 2. Concept retenu — l'Établi (workbench)

La fenêtre passe en **plein écran utile** (fin de la colonne 680 centrée), organisée en 3 zones :

- **Rail d'outils** (gauche, ~56px).
- **Panneau « Matériel »** central (héros, largeur flexible).
- **Panneau « Réglages »** (droite, ~280px) avec l'action ancrée.

Métaphore cohérente avec l'ADN « silex → étincelle → braise » : on travaille la matière sur un
établi, l'outil actif chauffe, on « forge ».

## 3. Personnalité — Forge / braise

Chaud, tactile, matière sombre, étincelles. Distinctif et fidèle à l'identité corail existante.
Cette couche d'identité est transverse aux 4 états et à tous les outils.

## 4. Layout & navigation (la coquille)

### Rail d'outils (`ToolRail`)
- ~56px, **icônes par défaut** (tooltip au survol), groupées par section (Image / PDF / Dev),
  séparateurs fins. Remplace la sidebar 200px et rend de la largeur à l'atelier.
- **Repliable/épinglable** : s'étend en libellés si épinglé (état persisté via `usePersistedState`).
- Piloté par la donnée existante `SIDEBAR_SECTIONS`. Le ⌘K (`CommandPalette`) reste le moyen
  rapide de basculer d'outil et est renforcé comme nav principale.

### Panneau central (`MaterialPanel`)
- Toggle **`[ matériel | résultats ]`** en haut → une seule zone qui bascule (plus de bandeau
  qui pousse le contenu vers le bas).
- Mode **matériel** : la grille de vignettes (`ImageGrid`, déjà vignette-backé) en grand, +
  `DropZone` en état vide.
- Mode **résultats** : reel avant/après + `ChainBar` (voir §5).

### Panneau réglages (`ControlsPanel`)
- Les contrôles de l'outil actif.
- Action **« Forger »** **ancrée en bas, toujours visible** (+ raccourci ⌘↵).

### Proportions
Rail 56px · Matériel flexible (héros) · Réglages ~280px. Plein hauteur de la fenêtre Tauri.

## 5. Les 4 états & le chaînage

Le panneau central vit en 4 temps :

1. **Vide** — l'enclume attend : grande zone de dépôt avec lueur braise retenue, `⌘O`,
   (option différée : accès rapides récents). Réglages estompés, action désactivée.
2. **Actif** — matériel chargé + réglages live + action prête.
3. **Forge** (traitement) — l'action « s'embrase », progression à étincelles (réutilise
   `GlobalProgressBar`), vignettes en « chauffe ».
4. **Résultats** — toggle sur « résultats » : reel avant/après (réutilise `BeforeAfterSlider`),
   résumé du gain (taille avant→après, %), et la barre **« et maintenant »** (`ChainBar`).

### Chaînage (`ChainBar`)
- Actions toujours présentes : `ouvrir le dossier`, `recommencer` (re-forger avec d'autres
  réglages).
- **Rampes contextuelles** : ex. `→ favicon`, `→ redimensionner`, `→ convertir`. Un clic
  **change d'outil ET recharge les sorties comme nouveau matériel** dans l'outil cible.
- Mapping piloté par un registre `toolId → TabId[]` (défini dans la spec d'implémentation ;
  point de départ raisonnable : compresser/convertir/redimensionner → favicon, redimensionner,
  optimiser, etc.). Sans cible pertinente, seules les actions par défaut s'affichent.
- Le toggle conserve l'accès au matériel d'entrée après forge (on ne remplace pas, on bascule).

## 6. Système d'identité Forge

### Palette — charbon chaud (on quitte le violet-froid `#16141a`)
| Rôle | Hex |
|---|---|
| base | `#161210` |
| surface | `#1E1813` |
| élevé | `#251D17` |
| overlay | `#2E241C` |
| bordure | `#34281F` |

### Accents — feu à deux tons
| Rôle | Hex |
|---|---|
| braise (deep) | `#7A2E14` |
| corail (core) | `#E8572A` |
| lueur (bright) | `#FF8A5C` |
| étincelle (amber, nouveau) | `#FFB04A` |

### Texte (neutres chauds)
| Rôle | Hex |
|---|---|
| primary | `#F3EEE8` |
| secondary | `#A89A8C` |
| tertiary | `#8C7E70` |

> Note (Phase 0) : `tertiary` (et son alias `--flint-text-muted`) ont été relevés de
> `#7A6E62` à `#8C7E70` à l'implémentation pour passer le contraste WCAG AA (~4.8:1) sur le
> fond chaud. `--flint-bg-elevated` (`#2a1a14`) reste volontairement un peu plus chaud que
> `--bg-elevated` (`#251d17`) : c'est la surface « élevée accent » des dégradés actifs.

### Règles
- **Lueur de chauffe retenue** : glow ember **uniquement** sur l'outil actif, le CTA et l'état
  forge — jamais en fond global.
- **Grain** subtil sur les surfaces (feTurbulence faible opacité, scoping `isolation: isolate`
  pour éviter le repaint plein écran — cf. correctif DropZone déjà appliqué).
- **Typo** : DM Sans + DM Mono conservés. Le **mono** porte le technique (tailles, %, raccourcis) ;
  DM Sans agrandi/resserré pour les titres héros.
- **Étincelles** : micro-interaction signature au **succès** de la forge ; respecte
  `prefers-reduced-motion` (désactivée → simple transition d'opacité).
- Les tokens vivent dans `App.css` (`:root`) ; les composants consomment les variables, pas de
  hex en dur.

## 7. Architecture & mapping au code

### Le retournement (idée clé)
Aujourd'hui chaque `*Tab` ré-assemble `DropZone + ImageGrid + contrôles + ResultsBanner`. L'Établi
**inverse** la responsabilité : **la coquille possède** dropzone / matériel / résultats / action ;
chaque outil ne fournit plus que **ses contrôles** et **sa config**. Bénéfice : duplication
fortement réduite, les 4 états et le chaînage gérés **une seule fois**.

Contrat d'un outil (forme cible, détails de wiring laissés au plan) :
- `id: TabId`, `accept: string`, `command: string`, `multiple?: boolean`
- un composant **Controls** (les réglages spécifiques + leur état local)
- un moyen de produire les `extraParams` du `invoke` + un libellé d'action (« Forger N images »)
- `chainTargets?: TabId[]` (rampes de chaînage)

### Composants
**Nouveaux**
- `WorkbenchShell` — layout 3 zones, onglet actif, toggle matériel/résultats, slots.
- `ToolRail` — rail repliable (depuis `SIDEBAR_SECTIONS`), intègre ⌘K.
- `MaterialPanel` — héros central (mode matériel ↔ résultats).
- `ControlsPanel` — réceptacle des contrôles outil + action ancrée.
- `ChainBar` — rampes « et maintenant » + registre `toolId → TabId[]` + handoff sortie→entrée.

**Réutilisés / refactorés**
- `useTabProcessor`, `useFileSelection`, `useThumbnails`, `GlobalProgressBar` (→ état forge),
  `BeforeAfterSlider`, `ImageGrid`/`ImageGridCard`, `DropZone` (variante enclume), `ResultsBanner`
  (fondu dans le mode résultats), `CommandPalette`.
- `App.tsx` : le layout sidebar+main est remplacé par `WorkbenchShell` ; la donnée
  (`SIDEBAR_SECTIONS`, `TAB_*`) est conservée.

### Data flow
`WorkbenchShell` tient l'onglet actif → instancie le contrôleur de l'outil (via `useTabProcessor`)
→ `MaterialPanel` lit `files`/`results`, `ControlsPanel` rend les contrôles + l'action.
Forge → `useTabProcessor.process(extraParams)` → résultats → bascule en mode résultats →
`ChainBar`. Une rampe = `setActiveTab(target)` + injection des `output_path` comme nouveaux `files`.

## 8. Phasage

Chaque phase est vérifiable (`cargo clippy -- -D warnings`, `cargo test`, `tsc --noEmit`,
`bun run build`) et livrable indépendamment.

- **Phase 0 — Identité** : tokens chauds + ramp braise/corail/lueur/étincelle + utilitaires glow
  + grain + composant étincelles + `prefers-reduced-motion`. Gain visuel immédiat, indépendant
  du layout, risque quasi nul.
- **Phase 1 — Coquille + outil pilote** : `WorkbenchShell`/`ToolRail`/`MaterialPanel`/
  `ControlsPanel`/`ChainBar` câblés sur **Compresser** comme référence.
- **Phase 2 — Outils image** : Convertir, Redimensionner, Rogner, Optimiser, Filigrane, EXIF,
  Palette, SVG convertis au format contrôles+config.
- **Phase 3 — Dev + PDF** : Favicon, GIF/WebP, Sprite, Base64, QR, Renommage.
- **Phase 4 — Chaînage & finitions** : registre des rampes, handoff sortie→entrée, accès rapides
  à l'état vide, polish motion.

## 9. Cas spéciaux & garde-fous

- **`PdfWorkbenchTab`** (state machine `usePdfWorkbench`/`usePdfPages`) ne rentre pas dans le
  modèle générique matériel/contrôles → garde un **contenu central custom** rendu dans la coquille.
- **Préserver les gains perf récents** : vignettes backend, `content-visibility`, clés stables.
  `MaterialPanel` réutilise `ImageGrid` tel quel.
- **i18n** (fr/en) pour toutes les nouvelles chaînes (tooltips rail, toggle, chips, état vide).
- **`prefers-reduced-motion`** pour les étincelles et transitions d'état.
- Respect des règles projet (`CLAUDE.md`) : pas de nouvelle commande Rust sans pattern
  validate → spawn_blocking → rayon (aucune commande Rust nouvelle n'est requise par ce redesign,
  qui est front-only).

## 10. Hors scope / différé

- Accès rapides « récents » à l'état vide (option, Phase 4 si le temps le permet).
- Thème clair (Forge est dark-first ; pas de mode clair prévu).
- Refonte du PDF Workbench interne (on l'intègre tel quel dans la coquille).
- Optimisation `ExifStripTab` (lecture métadonnées) — déjà traitée séparément, hors de ce redesign.

## 11. Critères de succès & vérification

- L'écran n'a plus de grand vide central ; l'état vide est engageant (enclume/braise).
- Après forge, l'utilisateur peut **enchaîner** vers un outil pertinent sans repartir de zéro.
- Les 16 outils partagent une seule coquille ; ajouter un outil = fournir contrôles + config.
- Identité « Forge » perceptible et cohérente, sans surcharge (glow retenu).
- Gains perf récents intacts (pas de régression de décodage/mémoire).
- Vérif technique verte à chaque phase : clippy, tests Rust, `tsc --noEmit`, build.
