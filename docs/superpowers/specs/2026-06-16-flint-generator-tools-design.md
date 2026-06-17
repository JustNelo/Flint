# Flint — Generator/Inspector Tools (Palette · Base64 · QR Code) — Design

> Statut : validé en brainstorming le 2026-06-16. Base du plan d'implémentation.
> Branche : `feat/flint-redesign`.

## 1. Contexte & objectifs

Le rollout Établi a converti 12 outils « lot d'images → résultats ». Trois outils n'y rentrent
pas (sortie non-fichier ou pas d'entrée fichier) et sont restés en colonne centrée :
- **Palette** : image → couleurs (nuancier + pipette), copie/export (pas de fichier).
- **Base64** : image → data URI (texte), copie (pas de fichier).
- **QR Code** : texte → image QR (écrit un fichier).

**Objectif** : leur donner une UX **sur-mesure**, cohérente avec l'identité Forge, sans les
forcer dans le moule Établi. **Périmètre : on ré-agence, on n'ajoute pas de fonctionnalités**
(YAGNI) — seules exceptions : des variantes de « copier » (gratuites) et un aperçu live pour le QR.

**Décisions de cadrage (brainstorming)** :
- **Sur-mesure par outil** (pas de coquille partagée imposée).
- **Interaction mixte** : aperçu **live**, **action explicite** uniquement quand on écrit un
  fichier sur disque (QR « Enregistrer »), **copie** pour les sorties texte/couleurs.

## 2. Forme commune (cadre, pas interaction)

- Chaque outil vit dans la coquille existante (`WorkbenchShell` + `ToolRail`) et **reste dans la
  branche centrée** d'`App.tsx` (PAS dans `ETABLI_TOOLS`, pas de pleine largeur).
- Disposition **2 colonnes « source/saisie → sortie/aperçu »** dans la colonne centrée
  (~860px existant ; chaque colonne ~410px). Panneaux à l'identité Forge (bordure, `--bg-elevated`).
- Pas de grille `ImageGrid`, pas de bandeau `ResultsBanner`. Ces outils ne sont pas des lots.

## 3. Conception par outil

### 3.1 QR Code (`QrCodeTab`)
- **Gauche (saisie)** : textarea `contenu` + sélecteur de taille (256/512/1024/2048 — inchangé).
- **Droite (aperçu live)** : aperçu QR qui se redessine en continu quand le contenu ou la taille
  change (debounce ~150 ms) ; actions : **« Enregistrer PNG »** (corail, écrit le fichier dans le
  workspace — action explicite) + **« copier »** (image dans le presse-papier).
- **Interaction mixte** : l'aperçu est live ; l'écriture disque est explicite.
- **Backend** : ajouter une commande `generate_qr_preview(content, size) -> String` (base64 PNG,
  AUCUN fichier écrit) pour l'aperçu live ; l'enregistrement réutilise la commande existante
  `generate_qr_cmd` (écrit le fichier). Pas d'entrée fichier → pas de `validate_path` sur le
  contenu ; le `output_dir` de l'enregistrement reste validé. Pattern : commande async →
  `run_blocking` → `qr_ops`.
- État vide : contenu vide → pas d'aperçu, bouton enregistrer désactivé.

### 3.2 Palette (`PaletteTab`)
- **Gauche (source)** : toggle mode **palette / pipette** + aperçu de l'image (dépôt 1 fichier).
  En mode **pipette**, l'image devient cliquable (prélèvement au clic) — logique canvas existante
  conservée.
- **Droite (sortie live)** : en mode palette, le **nuancier** extrait (live au dépôt ; le slider
  « nombre de couleurs » met à jour) + exports **copier HEX / JSON / CSS** ; en mode pipette, la
  couleur prélevée + historique des prélèvements.
- **Interaction** : live (pas de fichier écrit) → copie/export uniquement.
- **Backend** : réutilise `extract_palette` (color_ops) tel quel — pas de nouvelle commande.
- Nouveauté gratuite : bouton « copier HEX » (formatage client-side).

### 3.3 Base64 (`Base64Tab`)
- **Gauche (source)** : aperçu de l'image (dépôt 1 fichier).
- **Droite (sortie live)** : le **data URI** dans un bloc de code (généré live au dépôt) + char/size
  count + **copier** en variantes : data URI brut, balise `<img src=…>`, background CSS
  (formatage client-side à partir du même data URI).
- **Interaction** : live ; sortie texte → copie.
- **Backend** : réutilise `image_to_base64` (lib.rs) tel quel — pas de nouvelle commande.

## 4. Architecture & composants

- **Tailored par outil** : chaque `*Tab` possède sa propre disposition 2-colonnes. On n'impose pas
  de composant de layout partagé (décision de cadrage).
- **Réutilisation légère** : un petit composant présentationnel optionnel `GeneratorPane`
  (carte/panneau à l'identité Forge : bordure, radius, `--bg-elevated`, titre) PEUT être extrait
  pour éviter la duplication de chrome entre les 3, sans imposer d'interaction. À la discrétion du
  plan d'implémentation (si la duplication le justifie).
- **App.tsx** : aucun changement de branche — les 3 restent dans la branche centrée. Seuls leurs
  composants sont redessinés.
- **Backend** : une seule commande nouvelle (`generate_qr_preview`, qr_ops) ; Palette/Base64
  réutilisent l'existant.
- **i18n** : nouvelles chaînes (libellés « copier … », « enregistrer », titres de panneaux,
  modes). fr + en.

## 5. Flux de données

- QR : (contenu, taille) → debounce → `invoke("generate_qr_preview")` → data URI affiché ;
  « Enregistrer » → `invoke("generate_qr_cmd", { content, size, outputDir })` (existant) → toast.
- Palette : dépôt image → `invoke("extract_palette")` → couleurs en état → nuancier ; slider/mode
  pilotent l'affichage ; pipette = canvas client-side ; exports = formatage client-side + presse-papier.
- Base64 : dépôt image → `invoke("image_to_base64")` → data URI en état → bloc + variantes de copie.

## 6. Gestion d'erreurs

- QR : contenu vide → état vide propre ; erreur backend → toast (réutiliser le pattern `logError` +
  toast existant).
- Palette/Base64 : fichier non décodable → toast d'erreur ; pas de crash, garde-fous existants.

## 7. Phasage

Chaque outil est livrable indépendamment (vérif `tsc`/`bun run build`/prettier ; Rust
`cargo clippy -- -D warnings`/`cargo test` pour la commande QR).
- **Phase A — QR Code** : commande Rust `generate_qr_preview` + test ; redesign `QrCodeTab`
  (2-col, aperçu live, enregistrer/copier).
- **Phase B — Base64** : redesign `Base64Tab` (2-col, live, variantes de copie). Front-only.
- **Phase C — Palette** : redesign `PaletteTab` (2-col, palette/pipette, exports + copier HEX).
  Front-only.

## 8. Hors scope / différé

- **PDF Workbench** : brainstorm dédié séparé (à venir).
- **ChainBar** (chaînage) : non concerné ici.
- Aucune nouvelle capacité produit au-delà du ré-agencement + variantes de copie + aperçu QR live.

## 9. Critères de succès & vérification

- Les 3 outils lisent comme des **générateurs/inspecteurs** cohérents Forge (source → sortie),
  plus comme des formulaires SaaS empilés.
- QR : aperçu live fluide ; enregistrement explicite inchangé fonctionnellement.
- Palette/Base64 : sortie live + copie/export ; comportement métier préservé.
- Aucune régression sur les 12 outils Établi (changements isolés aux 3 composants + 1 commande Rust).
- Vérif verte par phase : `tsc --noEmit`, `bun run build`, prettier ; clippy + `cargo test` pour la
  commande QR.
