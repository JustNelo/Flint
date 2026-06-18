# Flint — PDF Workbench Redesign + Native PDF Viewer — Design

> Statut : validé en brainstorming le 2026-06-17. Base du plan d'implémentation.
> Branche : `feat/flint-redesign`.

## 1. Contexte & objectifs

Le PDF Workbench (`PdfWorkbenchTab` + `usePdfWorkbench`) est le seul outil non passé à l'Établi.
C'est l'outil le plus riche : 2 modes (Workbench / Déverrouiller), une grille de pages (images +
pages PDF fusionnées, réordonnables), un sélecteur de 5 actions (Construire / Découper / Exporter
en images / Extraire images / Filigrane), des options dynamiques par action, du post-traitement en
pipeline (Compresser / Protéger par mot de passe), et un panneau de résultat — le tout empilé en
une colonne dense.

**Objectif (décision brainstorming)** : **cohérence avec l'Établi** uniquement — passer l'outil en
2-panneaux Forge **sans refondre le modèle** (on garde les 5 actions, le post-traitement, le mode
Déverrouiller). **Plus** une nouvelle feature demandée : une **visionneuse PDF native défilante**
dans l'app.

Périmètre : ré-agencement + identité Forge + la visionneuse. Pas de simplification du modèle
d'actions, pas de fusion du mode Déverrouiller dans les actions.

## 2. Volet 1 — PDF Workbench en Établi 2-panneaux

- **Outil pleine largeur** : ajouter `"pdf-toolkit"` au set `ETABLI_TOOLS` d'`App.tsx` (rendu dans
  la branche pleine largeur, comme compress/convert). Aucune autre logique d'App touchée.
- **Toute la logique préservée** : `usePdfWorkbench` (pages, pipeline, watermark, unlock) inchangé.
  On ne fait que ré-agencer le JSX de `PdfWorkbenchTab` + appliquer l'identité Forge (panneaux).
  Réutilise `PdfPageGrid`/`PdfPageCard` (déjà vignettes pdfium base64), `PdfUnlockPanel`,
  `ResultPanel`, `Slider`, `ActionButton`.

### Mode Workbench
- **Panneau Matériel (gauche, `flex-1`)** : toggle **[ pages | résultats ]**.
  - `pages` : la barre ajouter/effacer + indicateur "N pages · glisser pour réordonner" + le
    `<PdfPageGrid>`.
  - `résultats` : le `<ResultPanel>` existant. Bascule automatique sur `résultats` après une
    exécution réussie (pattern panelMode des autres outils Établi).
- **Panneau Réglages (droite, ~280px)** :
  - en haut : le toggle **[ workbench | déverrouiller ]** (mode switcher).
  - sélecteur d'**action** (les 5 actions, grille compacte).
  - **options** dynamiques de l'action active (filename / ranges / format+dpi / hint / watermark).
  - **post-traitement** (Compresser + Protéger) pour les actions à sortie PDF (`build`).
  - **Exécuter** ancré en bas (`ActionButton`), avec le résumé pipeline + l'indicateur d'étape.

### Mode Déverrouiller (gardé séparé)
- Le toggle de mode bascule l'outil. En mode déverrouiller (pas de grille de pages) :
  - **Gauche** : zone de dépôt / sélection du PDF + son nom (état simple).
  - **Droite** : champ mot de passe + bouton Déverrouiller (`PdfUnlockPanel` ré-agencé).
  - Résultat via la bascule `résultats` du panneau gauche.

## 3. Volet 2 — Visionneuse PDF native défilante (`PdfViewer`)

Un lecteur PDF multi-pages dans l'app (rendu pdfium), pas un visualiseur externe.

- **Forme** : **overlay plein écran** (modal), colonne de pages défilante.
- **Cible** : **tout fichier PDF réel** — un PDF source ajouté, et le PDF de sortie. (Exclut la
  composition images+PDF non encore construite — ce n'est pas un fichier.)
- **Déclencheurs d'ouverture** :
  - clic sur une vignette de **page PDF** dans la grille → ouvre ce PDF source, scrollé à cette
    page (les vignettes de type `image` ne déclenchent pas la visionneuse — inchangées) ;
  - bouton **« voir »** sur le `ResultPanel` quand la sortie est un PDF (`output_path` se termine
    par `.pdf`).
- **Rendu paresseux** : seules les pages visibles/proches sont rendues (IntersectionObserver ou
  handler de scroll) via la nouvelle commande backend ; placeholders ailleurs. **Cache** par
  `(chemin, page, palier de largeur)` ; `content-visibility:auto` + `contain-intrinsic-size` sur les
  conteneurs de page hors écran ; rendus concurrents plafonnés ; re-rendu **debouncé** au changement
  de zoom. (On réapplique la discipline perf des grilles image.)
- **Zoom** : ajuster-largeur / − / + / palier %, indicateur **page x / n**, fermer (Échap + clic
  hors zone + bouton ✕).
- **`prefers-reduced-motion`** : pas d'animation requise (scroll natif).

## 4. Backend

- **Nouvelle commande** `render_pdf_page(pdf_path: String, page_number: usize, target_width: u32)
  -> Result<String, String>` : rend UNE page PDF à `target_width` px via pdfium et retourne une
  image **base64** (aucun fichier écrit). Format : JPEG q≈85 (léger pour un viewer multi-pages ;
  le plan tranchera PNG vs JPEG selon lisibilité/poids). Pattern obligatoire : `validate_path` →
  `require_pdfium` → `run_blocking` → rendu dans `pdf_ops` (ou `pdf_builder_ops`, là où vit déjà le
  rendu pdfium→base64). Enregistré dans `generate_handler!`.
- **Réutilise** `get_pdf_page_count` (existant) pour le nombre de pages, et `PdfiumState`.
- Aucune autre commande nouvelle. Le QR `generate_qr_preview` (déjà livré) est le précédent de
  pattern « rendu → base64 sans fichier ».

## 5. Architecture & composants

- `PdfWorkbenchTab.tsx` : ré-agencé en 2-panneaux (gros fichier ~1000 lignes ; le `ResultPanel`
  interne reste dans le fichier ; envisager d'extraire les blocs d'options par action si ça aide la
  lisibilité, à la discrétion du plan — sans changer la logique).
- `PdfViewer.tsx` *(nouveau)* : l'overlay visionneuse — props `{ pdfPath, initialPage?, onClose }`.
  Gère le nombre de pages (`get_pdf_page_count`), le rendu paresseux par page, le zoom, la nav.
- `usePdfRender` *(nouveau, optionnel)* : hook encapsulant le cache + le rendu paresseux d'une page
  `(path, page, width) -> dataURI`, avec garde anti-obsolescence (comme `useThumbnails`). À la
  discrétion du plan (peut vivre dans `PdfViewer`).
- `App.tsx` : ajoute `"pdf-toolkit"` à `ETABLI_TOOLS` + rend `<PdfWorkbenchTab>` dans la branche
  pleine largeur (retiré du centré).
- Backend : `pdf_ops`/`pdf_builder_ops` (commande de rendu) + `lib.rs` (commande + enregistrement).

## 6. Flux de données

- Workbench : inchangé — `usePdfWorkbench` pilote pages/pipeline/result ; le composant ne fait que
  placer ces éléments dans les 2 panneaux + bascule panelMode sur résultat.
- Viewer : ouverture (page PDF / bouton voir) → `PdfViewer` monte avec `pdfPath` (+ `initialPage`)
  → `get_pdf_page_count` → liste de N conteneurs de page → au scroll/zoom, chaque page visible
  appelle `render_pdf_page(path, page, width)` (debouncé, caché) → data URI affiché.

## 7. Gestion d'erreurs

- `render_pdf_page` : page illisible / pdfium absent → la page affiche un état d'erreur discret
  (pas de crash du viewer) ; `logError` + le reste des pages continue.
- PDF protégé : si le rendu échoue pour cause de mot de passe, message clair (réutiliser le
  sentinel `WRONG_PASSWORD`/notices existants si pertinent ; sinon état d'erreur générique).
- Workbench : comportements/garde-fous existants préservés.

## 8. Phasage

Chaque phase vérifiable (`tsc`/`bun run build`/prettier ; Rust `cargo clippy -- -D warnings` +
`cargo test` pour la commande de rendu).
- **Phase 1 — Établi relayout** : `PdfWorkbenchTab` en 2-panneaux + `ETABLI_TOOLS`. Front-only,
  logique préservée. Livrable seul (cohérence visuelle immédiate).
- **Phase 2 — Backend rendu** : commande `render_pdf_page` (→ base64) + test. Backend-only,
  livrable seul (non encore consommé).
- **Phase 3 — `PdfViewer`** : composant visionneuse (rendu paresseux + zoom + nav) + câblage des
  déclencheurs (clic page PDF, bouton « voir » du résultat).

## 9. Hors scope / différé

- Prévisualiser la **composition images+PDF non construite** (build implicite) — exclu.
- Visionneuse pour les vignettes **image** (elles restent inchangées ; pas de viewer image ici).
- Simplification du modèle d'actions / fusion du mode Déverrouiller — explicitement écartés.
- `ChainBar` (chaînage) — hors de ce chantier.

## 10. Critères de succès & vérification

- Le PDF Workbench lit comme les autres outils Établi (2-panneaux, identité Forge) sans perte de
  fonctionnalité (5 actions, post-traitement, déverrouiller, résultats).
- La visionneuse ouvre n'importe quel PDF réel (source via clic page, sortie via « voir »),
  feuillette en grand avec zoom, **sans charger toutes les pages d'un coup** (rendu paresseux —
  pas de pic mémoire ; cohérent avec les leçons perf vignettes).
- Aucune régression sur les outils Établi existants ni sur la logique `usePdfWorkbench`.
- Vérif verte par phase : `tsc --noEmit`, `bun run build`, prettier ; `cargo clippy -- -D warnings`
  + `cargo test` pour la commande de rendu.
