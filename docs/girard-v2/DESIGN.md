# girard v2 — Design Document

**Status:** Accepted design, pre-implementation.
**Date:** 2026-07-05
**Authors:** Bobby Meyer, with Claude (design collaboration).
**Supersedes:** girard v1 (the blog-embedded pattern tool at bobbymeyer.com/posts/girard) and its companion prototype, element studio. v1 is retired but remains published as a frozen exhibit. Nothing in v1 is load-bearing; v2 starts fresh and deliberate.

This document is the constitution for a fresh repository. It records not just decisions but the reasoning behind them, so future work argues with the rationale rather than relitigating blind.

---

## 1. What girard v2 is

girard is a tool for designing repeatable surface patterns — florals, geometrics, stripes, checks, tossed motifs, trailing vines — as **data**, rendered to SVG. It is:

- **A staged studio, not a single editor.** Four benches — Elements, Meta-elements, Pattern, Colorways — each answering one question. Rooms in one house, not a wizard.
- **Generative but deterministic.** Every "random" variation flows from seeds. Same document + same seed = byte-identical SVG, forever, on every renderer.
- **A component system.** Elements are reused by reference across patterns (the Marimekko discipline: enormous value from a small library). Editing an element updates every pattern that uses it; releases pin what has shipped.
- **Self-hosted OSS.** A Rails 8 application anyone can run as a single container. One instance = one shared workspace. Private by deployment, not by permissions matrix.
- **License:** decided later; likely MIT.

### What v1 taught (and what v2 keeps from it)

v1 grew ~40 bespoke procedural fills with structure arriving never; its successor prototype (element studio) proved a shape-grammar IR could replace hand-coded generators, and that a canvas-first editor beats a tree editor. The specific lessons carried forward:

1. **One rendering engine or drift.** v1's A/B byte-equality proof between legacy generators and the IR interpreter only worked because there was exactly one interpreter. This is now a hard rule (§7).
2. **The recursive op-tree is a great substrate and a bad primary UI.** Users think in stages (make a petal → make a flower → make a pattern), not in recursive trees. The tree survives as the internal representation and an advanced inspector, never as the main interface.
3. **Symbolic color works.** Colors stayed abstract (`{cycle}`, `{band}`) in the IR and were resolved by the host. v2 promotes this to **roles** (§6).
4. **Hand-rolled state sync is where the bugs live.** Every shipped interaction bug (drops that didn't resolve, selection resets) was global-variable state drift. v2 editors get a real state layer with patch-based undo.
5. **Variance you can't see is variance you overshoot.** Jitter sliders felt dead until output was re-rollable and visible. Hence proof sheets (§3) and visible re-roll everywhere.
6. **"Fruit" was a meta-element trying to be born.** v1's charming one-off fills were assemblies without an assembly system. v2 builds the system and lets the library grow deliberately.

---

## 2. The core mental model

**Pipeline of scopes.** Each bench narrows the question:

| Bench | Question | Output |
|---|---|---|
| Elements | What is a petal? | A shape *distribution* (geometry + wobble + roles) |
| Meta-elements | What is a flower? | An assembly of element references |
| Pattern | How does it fill a surface? | A repeat tile: layers = content × layout |
| Colorways | What colors? | Role assignments + variance rules, plural |

**Components and instances** (the Figma model, which users already know): an element is a component; a meta-element is a component of components; the pattern canvas holds instances; colorways are theming. Edit the component, all instances update.

**Benches are optional.** A stripe pattern never visits the Elements bench: go straight to Pattern, add two band layers, then Colorways. The pipeline unfolds to its full length only when the design needs it. Simple things stay simple.

**Everything is data.** An element, a flower, a pattern, a colorway — all are documents a renderer interprets. No motif is ever hand-coded into the engine again.

---

## 3. Bench 1 — Elements

An element is **a distribution, not a shape**. Every numeric parameter may be a plain value or a value with declared wobble:

```
r: 0.3                      // fixed
r: { v: 0.3, w: 0.05 }      // 0.3 ± 0.05, sampled per instance
```

Hand the element a seed and it samples a concrete shape. "No two petals alike" falls out deterministically: same seed, same petal, forever. Wobble applies to any numeric param — scale, rotation, roughness (vertex noise), curve tension (smoothness), skew.

**Geometry vocabulary** (carried from the v1 IR, human-named in the UI):
- Leaf shapes: circle/disc, polygon, star, rectangle/box, wedge, fill/rect, curve/path.
- Assembly ops (shared with Bench 2): group, ring-of-copies (radial repeat, with per-copy swirl), concentric-rings (nest, with per-ring spiral twist), stripes (split), reflect (mirror), clip/lens (boolean).
- Paths are first-class: bezier segments, editable with real drawing tools (§8 — Paper.js as the path appliance). Path smoothing, offsetting, and boolean operations are rented, not reinvented.

**Color never appears here — only roles.** An element tags its parts: this shape is `petal-base`, this vein is `petal-shade`, this is `stem`. All actual color decisions happen at the Colorways bench, in context. This dissolves v1's most confusing widget.

**Proof-sheet UX.** The bench shows the master shape large, plus a row of ~8 seeded samples with a re-roll button. Variance is tuned by *watching the population*, not by imagining a number's effect.

**Reuse surface.** Every element displays its dependents count: "used in 7 patterns (4 released — safe; 3 drafts — will change)." The dependents number is the value of the element; the UI makes reuse feel like winning.

---

## 4. Bench 2 — Meta-elements

A meta-element is an **assembly**: flower = center + ring(petal × 8) + stem. Slots reference elements **by id** (never by copy). Assemblies may nest (a bouquet references flowers).

- **Derived seeds.** The meta-element's seed deterministically derives each slot instance's seed (hash of parent seed + slot path + index). Re-roll the flower → all petals re-sample; re-roll one petal → only it changes.
- **Slot modifiers.** Arrangement-level wobble ("petals vary rotation ±4° around the ring") lives on the slot, not the element.
- **No per-instance overrides in v2.0 — except pin-a-seed.** Full Figma-style override machinery is a swamp. The real need ("I like *this* one, keep it") is served by **pin**: freeze a sampled instance's seed. A pinned instance is just a stored integer.
- **Cross-bench jumping.** Double-click a petal inside the flower → the Elements bench opens on that petal → every flower using it updates live on return. With multiple windows open, edits broadcast between them (§9, ActionCable).

---

## 5. Bench 3 — Pattern

**The canvas is the repeat tile.** You edit one tile with neighboring tiles ghosted around it, so seams are designed-with, not discovered-after. (v1 had wrap-correct rendering internally but never offered it as a direct-manipulation surface; this is the single most important UI promotion in v2.)

**A pattern is a stack of layers** (v1's soul, kept). **A layer = content × layout rule.**

Content, one of:
1. An element or meta-element reference.
2. A **band/path** (see below) — content and layout fused.
3. A **procedural field** — a plugin generator (code, not data) for the genuinely algorithmic: voronoi, maze, tessellations. Fields must respect the layer seed and expose roles for colorways. This category is kept deliberately small; nothing from v1's fill zoo is ported on faith.
4. A solid ground.

Layout rules:
- **By hand** — drag instances on the tile; they wrap over edges. Each placement carries position, rotation, scale, z, and a seed.
- **Scatter** — seeded: density, spacing/collision radius, rotation range, scale range. Re-rollable. (The "tossed floral" genre is exactly this.)
- **Grid / symmetry** — the practical five, not the full seventeen wallpaper groups: **block repeat, half-drop, brick, mirror, point rotation**. Each explainable in one picture; together they cover the overwhelming majority of real textile practice. The full crystallographic set is explicitly out of scope for v2.0.
- **Bands / paths** — below.

### The band/path primitive (stripes → vines, one mechanism)

A **band** is a continuous path across the tile, wrapped at the edges, with:
- a spine: straight, or wavy (seeded wave: amplitude, frequency, phase)
- a stroke/fill and width (possibly wobbled along its length)
- optional **attachments**: elements budded along the path at intervals with spacing + wobble (a leaf every *n* units, a flower at ±jitter)

One primitive, an entire genre map:

| Configuration | Pattern |
|---|---|
| straight path, constant width | stripe |
| straight paths crossed (two layers) | check; translucent + blend = gingham |
| thin crossed | windowpane |
| wavy path | squiggle stripe, bargello, Memphis worm |
| wavy path + attachments | vine / trailing floral |
| short paths, scattered not tiled | Memphis confetti squiggle |

This is why vines are not a special floral feature: a vine *is* a stripe with ornaments. Seam continuity for wrapped paths is a tested invariant (§10), not an aspiration.

**Output drawer** (on this bench; deliberately not a fifth bench): physical repeat dimensions, true-size preview (CSS real-millimeter rendering), SVG export, PNG export via background job. SVG is scale-independent; *density* relative to physical output is the one scale decision a designer must see, and it is one number plus one honest preview.

---

## 6. Bench 4 — Colorways

A colorway = **role → color assignments + variance rules**, applied to a pattern. Plural by design: the same pattern with 3–4 colorway cards side by side, live, is the deliverable (one design, several color runs — the mill model).

- **Variance scoped by seed level**, riding the same hierarchy as geometry: "each *flower* draws `petal-base` from this set" varies at the placement seed; "each *petal* shades ±5% lightness" varies at the element-instance seed.
- **All color math in OKLCH** (via culori). "±5% lightness" must look like ±5%; RGB/HSL math does not. This is non-negotiable.
- Role inference and colorway-swap concepts carry from v1's palette machinery; the CMYK/gamut-check idea (v1 had ICC round-trip ΔE warnings) is a valued v2.x candidate, not v2.0.

---

## 7. Seeds and determinism

The spine of the whole system:

- **Contract:** `render(document, region, seed) → SVG`, byte-identical everywhere — browser bench, test harness, server export job.
- **Seed flow:** the pattern assigns each placement a seed → the meta-element derives slot-instance seeds → the element samples its wobble. Derivation is a pure hash (parent seed, slot path, index).
- **Re-roll at any level**; **pin** freezes a seed at any level.
- **RNG:** our own ten-line mulberry32 (or equivalent splitmix); no dependency, no drift. `Math.random`, `Date.now`, and any non-injected entropy are banned inside the interpreter.
- Determinism is what makes golden-file testing possible, client-rendered thumbnails trustworthy, and releases meaningful.

---

## 8. Rendering engine

**One interpreter, one language, forever.** A single JavaScript package (the successor to v1's `element-ir.js`), consumed by:
- the browser benches,
- the JS test suite,
- a Node sidecar / job runner on the server for canonical renders (thumbnails, exports).

**Never port the interpreter to Ruby.** Two renderers = drift = the end of byte-equality. Rails owns persistence, references, releases, and jobs; JS owns geometry; nothing is owned twice.

**SVG-native.** The scene graph *is* the IR; SVG is the deliverable. Canvas/GPU scene-graph libraries (Konva, Fabric, Pixi) render in the wrong medium and reintroduce two-renderer drift at the export boundary. Whiteboard SDKs (tldraw et al.) bring their own document models — bending one around a seeded shape grammar costs more than the interaction layer it saves, and tldraw's license is no longer plain OSS.

**Hit-testing:** the deepest-wins tagging technique from element studio carries over — the interpreter optionally stamps each emitted SVG node with the IR node that produced it (host-injected hook, no-op otherwise), so click-to-select maps pixels back to documents with no parallel bookkeeping.

### Rented wheels (own the grammar, rent the physics)

| Library | Scope | Why |
|---|---|---|
| d3-zoom, d3-drag | all benches | camera + drag math (inertia, constraints, touch) — the wheels v1 reinvented badly |
| Paper.js | Elements bench only, as a *path appliance* | real bezier editing, smoothing, offsetting, booleans; its output becomes IR; it is never the renderer |
| perfect-freehand | Elements bench, optional | hand-drawn stroke feel (Memphis squiggles) |
| culori | Colorways | OKLCH color math |
| Immer (or equivalent) | editor state | patch-based undo/redo (inverse patches, not whole-document snapshots) |
| resvg | server jobs | SVG → PNG rasterization |
| (own) mulberry32 | interpreter | seeded RNG, ten lines |

If Paper.js's dormant maintenance becomes a problem, the fallback is flatten-js/martinez for booleans plus hand-rolled handles — but only the appliance changes; the IR contract does not.

---

## 9. Application architecture

**Rails 8, deliberately boring, single container:**
- **SQLite in production** (WAL mode) — the blessed Rails 8 pattern; no Postgres to operate.
- **Solid Queue / Solid Cache / Solid Cable** — no Redis.
- **Rails 8 authentication generator** — logins, nothing fancier.
- **One instance = one shared workspace** (the Campfire model). No orgs, no permission matrices. Isolation = run another container.
- **Kamal-friendly**; the self-hoster story is one container + one mounted volume (SQLite file + exports).

**The Hotwire boundary:** Hotwire/Turbo runs the shell — project lists, libraries, colorway cards, version history, navigation between benches. It does not run the canvases. Each bench mounts **one JS editor island** (shared editor core + the interpreter package; Stimulus as mounting glue). Canvas state is a real store with Immer-patch undo. Document edits autosave via JSON PATCH.

**Live propagation:** document saves broadcast via Turbo Streams / ActionCable. Two windows — Elements bench in one, Pattern bench in the other — see each other's edits. "Adjust the element when the meta-element reveals the need" becomes two monitors, nearly free.

**Exports:** ActiveJob (Solid Queue) drives the Node renderer + resvg; artifacts to ActiveStorage on the mounted volume.

---

## 10. Data model

### Tables (nouns)

- **Element** — name, document (JSON), exposed roles, `schema_version`, provenance (`forked_from_version_id`, nullable).
- **MetaElement** — name, assembly document referencing element **ids**, `schema_version`, provenance.
- **Pattern** — name, layer stack document (content refs × layout rules × seeds), repeat settings, `schema_version`.
- **Colorway** — belongs_to pattern (or geometry release once pinned), role assignments + variance rules document.
- **Version** — append-only history for every document table (paper_trail-style or hand-rolled). Doubles as cross-session undo and as the substrate for releases.
- **Release** — see §11.
- **Reference graph — real join tables** (e.g. `element_usages`: user_of_type/id → element_id), maintained on save. Never buried inside JSON: it is queried constantly (dependents counts, delete guards, release manifests) and must survive document-format evolution.
- **Project / library** — grouping + the browsing surface.

### Document format

**JSON, kept without affection.** The IR is a tree; the browser interpreter consumes it directly; it exports/imports portably (a self-hosted tool's documents must survive being emailed). Every document carries `schema_version`; format migrations live in code, because a self-hosted instance *will* have year-old documents meeting new code. The database is storage, not format — export must round-trip.

SQLite stores documents as JSON text (JSON1 functions available but rarely needed — documents load by id; all interesting queries hit the relational reference graph).

---

## 11. Reuse, forking, releases

Three operations, precisely named:

1. **Live edit (default).** Elements are referenced, not embedded. Editing rose-petal updates every rose and every *draft* pattern. This is the reuse engine; it is never weakened.
2. **Fork (explicit divergence).** Rose petal → poppy petal: new identity, seeded from the original, never connected again. Provenance recorded ("forked from rose-petal@v7") — one column, and the lineage of a shape family later.
3. **Release (immutability by pinning, not by copying).** Publishing writes a **manifest that pins exact versions** — pattern@v12 + petal@v7 + flower@v4. A Gemfile.lock for a textile. No mass-fork, no copy explosion, provenance intact. Releases are immutable by policy.

**Releases are two-level; geometry and colorways pin separately:**
- A **geometry release** pins the layer stack and every element/meta version it references.
- **Colorways live their own lifecycle against a geometry release**: drafted, tweaked, and pinned individually. Unikko's 1964 geometry can carry its original red (pinned 1964), a blue pinned decades later, and a draft green — all against byte-identical geometry, none able to disturb the others. New colorways may always be added to an old geometry release; recoloring shipped geometry is the classic mill workflow and never requires a remix.
- An **edition** (working name) = geometry release × pinned colorway — the stable noun the library grid, exports, and thumbnails hang on.

**Copy-on-write:** attempting to edit anything inside a release context lands the edit in a fresh fork/draft; the release stays sealed.

**Remix** opens a new draft from a release in one of two modes: **re-live** (point at current library heads — "this design with today's petal") or **fork-from-pins** (copy pinned versions out as new elements — true divergence).

**Reuse stats everywhere:** dependents index on every element/meta ("used in 7 patterns — 4 released, safe; 3 drafts, will change"), edit-time warnings driven by the same query, delete guards ("used by 3 patterns" is a noisy, confirmed act). Because releases make edits safe, the tool can loudly encourage editing shared elements — that is how the Marimekko discipline (small library, huge leverage) is captured structurally.

---

## 12. Testing strategy (TDD from line one)

The design is unusually testable because the interpreter is pure and everything is seeded.

**Interpreter (JS, the bulk of the suite):**
- **Golden-file tests** — the v1 A/B-proof discipline, kept: known (document, seed) pairs → committed SVG; byte equality.
- **Property tests** — same seed ⇒ same output; wobbled params sample within declared bounds; seed derivation is stable across refactors.
- **Seam continuity** — for wrapped bands/paths and edge-crossing placements: geometry at the tile's right edge equals the left edge translated by the repeat. Seamlessness is an assertion, not an eyeball.
- Schema migration round-trips (old `schema_version` documents upgrade losslessly).

**Rails:**
- Reference integrity (deleting a used element is guarded and noisy).
- Release semantics: pins resolve, immutability enforced, copy-on-write forks correctly, remix modes produce the right graphs.
- Colorway completeness (every exposed role assigned), version restore round-trips.

**System:** thin Capybara/Playwright smoke over each bench (load, select, edit, save). Interaction *logic* lives in JS unit tests against the editor core, not in browser tests — v1's lesson is that interaction bugs are state bugs, and state is unit-testable.

---

## 13. Build order (spine-first)

v1 grew fills-first and structure-never; v2 inverts. Each milestone is shippable and tested.

1. **Interpreter package, no UI.** Primitives, arrangements, seeds, wobble params, roles, the tagging hook. Golden + property tests. Pure logic; the foundation everything leans on.
2. **Rails skeleton.** Auth, workspace, documents + versions, reference graph, bench shell navigation, autosave plumbing.
3. **Pattern + Colorway benches, geometrics only.** Solid grounds + band/path layers + the practical-five symmetries. End state: stripes, checks, gingham designed end-to-end and recolored. A complete tool that has never seen an element.
4. **Elements bench.** Wobble, proof sheet, role tagging, Paper.js path appliance.
5. **Meta-elements bench.** Assembly, derived seeds, pin-a-seed, cross-bench jumping.
6. **Scatter + hand placement; vine attachments on paths.**
7. **Releases + editions + remix; reuse stats surfaces.** (Schema exists from milestone 2; this is the UI + policy layer.)
8. **Output drawer.** Physical repeat size, true-size preview, PNG jobs.

(3 before 4 is the deliberate move: geometrics force the layer/seed/colorway spine to prove itself before any glamorous content arrives.)

---

## 14. UI conventions (carried from v1's hard-won taste)

**Interaction:**
- Canvas-first; direct manipulation before panels. Click shapes on canvas to select (deepest-wins); drag to move; handles to resize/spin; containers outline their contents; arrangement-level handles where math maps back exactly (e.g. a ring's spread handle).
- Layers panels display **stacking order** (top row = frontmost/painted-last).
- Sliders for exploration **plus** editable value boxes for precision (quiet readout until hover/focus).
- Snap-to-center/axis with visible guide flashes.
- Keyboard: ⌘Z/⌘⇧Z, ⌘D duplicate, Delete, arrow-nudge (shift = coarse; bursts collapse to one undo step), Escape deselects. Keys never stolen from form fields.
- Drag-reorder with insertion lines; drop into containers; self-into-subtree drops rejected.
- Autosave always; undo/redo survives selection; re-roll buttons wherever a seed hides.
- Human vocabulary in all UI: "Ring of copies," "Concentric rings," "Stripes," "Reflect," "Spiral°," "Swirl°" — never op names. Raw documents visible only in an "advanced" drawer.
- Proof sheets wherever a distribution is edited.

**Visual language:**
- Mono for data (inputs, values, tables); a sans display face for headings/voice.
- One restrained accent (v1 used teal `#157a86`) meaning selected/active/focus only; red = delete, never overloaded.
- Neutrals for chrome: white, light grey, dashed borders. **Never warm cream/tan ("Anthropic beige") for UI chrome** — pattern-internal colors are unrestricted.
- **Left-align text.** No centered prose, labels, headings, or buttons. Exceptions: a lone glyph in a fixed button; numeric table cells right-aligned by convention.

---

## 15. Out of scope for v2.0

- The full 17 wallpaper groups (practical five only).
- Mockup previews (fabric bolt, wallpaper wall) — v3 candy, same output drawer.
- Multi-workspace / orgs / permissions; real-time co-editing (live cross-window broadcast of saves is in; CRDTs are not).
- Migration of v1 patterns (nothing is load-bearing).
- Porting v1's fill zoo on faith — procedural fields are added one by one, on demonstrated want.
- CMYK/ICC gamut warnings (valued v2.x candidate).
- Marketplace/sharing infrastructure beyond document export/import.

## 16. Open questions

1. **License** — likely MIT; decide before first public push. (AGPL is the alternative if keeping hosted derivatives honest ever matters.)
2. **The "edition" noun** — settle the name for geometry-release × pinned-colorway before the library grid exists.
3. **JS island framework** — the editor core needs a small reactive host (vanilla + store, Svelte, or React). Decide at milestone 3, when the first real bench is built; criteria: bundle weight, state ergonomics with Immer patches, longevity.
4. **Interpreter package boundary** — npm workspace inside the Rails repo vs. separate package. Default: workspace inside the repo until someone else needs it.

---

## Glossary

| Term | Meaning |
|---|---|
| **Element** | An atomic shape distribution: geometry + wobble + roles. A component. |
| **Wobble** | Declared per-parameter variance (`value ± w`), sampled by seed. |
| **Role** | A symbolic color slot (`petal-base`, `stem`) tagged on geometry, assigned at the Colorways bench. |
| **Meta-element** | An assembly of element references with slot modifiers and derived seeds. |
| **Arrangement** | A structural op: ring-of-copies, concentric-rings, stripes, reflect, clip, group. |
| **Bench** | One of the four views: Elements, Meta-elements, Pattern, Colorways. |
| **Layer** | One stratum of a pattern: content × layout rule. |
| **Band / path** | A wrapped continuous path layer (stripe … vine) with optional attachments. |
| **Procedural field** | A code-plugin content generator (voronoi, maze) honoring seed + roles. |
| **Repeat tile** | The unit cell of the pattern; the pattern bench's canvas, edited with ghosted neighbors. |
| **Seed** | The integer from which all variation derives; flows pattern → meta → element. |
| **Pin** | Freezing a sampled seed (an instance you like) or a document version (a release). |
| **Fork** | Explicit divergence into a new identity, with provenance. |
| **Release** | An immutable manifest pinning exact versions (geometry; colorways pinned separately against it). |
| **Edition** | Working name: geometry release × pinned colorway — the shippable artifact. |
| **Proof sheet** | Master shape + a row of seeded samples; the UX for tuning distributions. |
| **Workspace** | One girard instance's shared universe of projects and libraries. |
