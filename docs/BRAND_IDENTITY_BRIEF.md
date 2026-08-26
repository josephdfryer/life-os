# LifeOS — Logo & Icon Suite Design Brief

*A self-contained prompt for a design AI. Everything needed is in this document; no repo access required.*

---

## 0. Your assignment

Design a complete identity system for **LifeOS**, a private personal-intelligence platform published under the company/domain name **La Collecteur** (`lacollecteur.com`).

Deliver:

1. **One master LifeOS mark** — the platform logo (also the parent app icon).
2. **A wordmark lockup** — mark + "LifeOS", plus the "La Collecteur" corporate lockup.
3. **Ten app icons** built as a family from the master mark's grammar (list in §5).
4. **Eight primitive glyphs** — the iconographic alphabet the whole system is built from (§4).
5. **A short system rulebook** so future icons can be drawn by someone else without drift.

Work in **SVG** (geometry-first, not raster). Every mark must survive at 16px and at billboard scale.

---

## 1. What LifeOS actually is — read this before drawing anything

LifeOS is **not** a productivity app, not a to-do list, not a dashboard. The founding manifesto is explicit about this, and the identity must reflect it:

> "My unit of analysis is my life." — not the task.

Four ideas the identity must carry:

**A graph, not a list.** The entire system is eight primitives connected by one universal edge called *Interaction*. The visual DNA should be **nodes and relationships**, never checkboxes, checkmarks, gears, brains, sparkles, or "AI" clichés.

**Derived, not stored.** Nothing important is a stored field — net worth, relationship health, fulfillment are all *queries* computed from atomic truths. Visually: things are **composed from smaller parts**, not drawn as solid monoliths. A mark built from repeated elemental units expresses this; a single blobby shape does not.

**The tension layer.** The most valuable intelligence lives in the **gap between what you declared you value and what you actually did**. Two layers, slightly out of register. This is the single most distinctive idea in the product and the best candidate for the conceptual core of the master mark — a deliberate, meaningful offset between two related forms.

**Sovereignty.** Local-first, plain-text, no lock-in, no recurring cost, "the most intimate model of my life should not live on someone else's server." The mark should feel like a **well-made owned object** — a maker's mark, a monogram stamped into leather, a hallmark on the underside of something you keep for thirty years. Not a startup logo. Not a SaaS gradient.

Also relevant: "La Collecteur" — the collector. There is a quiet archival, curatorial, personal-museum quality to the whole enterprise.

---

## 2. Brand system already in place — "Still" (non-negotiable)

Still is the existing design system. **Do not invent new colors or fonts.** Every mark must be drawable in these values.

### Palette

| Role | Token | Hex |
|---|---|---|
| Page background | `--bg` | `#e9e3d8` |
| Surface (cards, nav) | `--surface` | `#f7f4ee` |
| Secondary surface | `--surface-2` | `#efe9df` |
| Border | `--border` | `#d9d0c3` |
| Primary text (ink) | `--ink` | `#2c2620` |
| Secondary ink | `--ink-2` | `#524a42` |
| Meta ink | `--ink-3` | `#7a7268` |
| Faint ink | `--ink-4` | `#a69c90` |
| **Cognac — primary accent** | `--cognac` | `#8f6b4a` |
| Cognac deep | `--cognac-deep` | `#6e5238` |
| Cognac soft | `--cognac-soft` | `#f0e6d8` |
| **Camel — highlight** | `--camel` | `#c4a574` |
| Camel soft | `--camel-soft` | `#f5edd8` |
| **Petrol — depth** | `--petrol` | `#1a2a35` |
| Petrol soft | `--petrol-soft` | `#e8edf0` |
| Attention (warm nudge) | `--attention` | `#b07d4f` |
| Success | `--success` | `#6b7a63` |

**Color rules for the identity:**
- Cognac `#8f6b4a` is the primary brand color. Camel `#c4a574` is the highlight/second voice. Petrol `#1a2a35` is depth — used as a *ground*, not a fill for everything.
- **No blue accents, no `#007aff`, no zinc/slate greys, no pure white, no red.** The system's own alarm color is warm amber, never red.
- Legacy terracotta `#c4572a` is retired — do not use it.
- Every icon must work in three treatments: **cognac on cream**, **camel on petrol**, and **single-color ink** (`#2c2620`, no color at all).

### Type

- **Display / names:** Newsreader (serif), regular 400, `letter-spacing: -0.02em`.
- **Body / UI:** Inter, 400–500.
- Wordmarks use **Newsreader**. Never uppercase-shout — the system is sentence case throughout. "LifeOS" keeps its natural capitalization; do not set it as "LIFEOS".

### Form language

- Card radius **10px**; large panels 14px; buttons are **fully pill** (100px). The identity should echo this: **soft, generous corners — never sharp corners, never fully square**. Warm Concrete's square-corner era is over.
- Feel targets, verbatim from the design system: *"a well-made personal object — warm linen, cognac leather, camel highlights, occasional petrol depth. Calm like Muji, breathable like Things, restrained like Aesop."*
- Soft elevation, quiet hierarchy, gentle urgency. Nothing loud.

---

## 3. The master LifeOS mark

### Requirements

- Reads as a **single symbol** at 16×16 in a browser tab, and as an engraved-feeling mark at large scale.
- Contains, structurally, the idea of **nodes joined by an edge** and/or **two layers in deliberate offset** (declared vs. behavioral — the tension layer).
- Geometrically constructible: build on a defined grid with a stated stroke weight and corner radius, so every child icon inherits the same physics.
- Works in a **circle, a squircle (iOS), and free-standing**.
- Monogram-adjacent is welcome — an "L" and a "C"/"O" living inside the node geometry is a legitimate solve, but only if it doesn't force the shape.

### Explicitly avoid

Brains, neural nets, sparkles/✨, orbit-and-electron atoms, generic hex grids, infinity loops, house icons for "Home," speech bubbles, gradients-as-personality, glassmorphism, anything that looks like a crypto or AI startup in 2023.

### Deliver three distinct directions

Give **three** conceptually different master marks (not three tints of one). For each: name it, state the idea in one sentence, show it at 512px, 64px, and 16px, in cognac-on-cream and camel-on-petrol, and show the "LifeOS" Newsreader lockup horizontally and stacked.

---

## 4. The eight primitives — the iconographic alphabet

This is the actual data model, locked and pressure-tested. Design **one glyph per primitive plus one for the edge**. These glyphs are the shared vocabulary that app icons are then assembled from — that is what makes the suite a family rather than ten unrelated drawings.

| Primitive | Definition (design to this, not to the word) |
|---|---|
| **Person** | A human in the owner's life. Carries closeness, history, attention signals. |
| **Place** | A location at *any scale* — Earth → Country → City → Home → Room → Shelf. A self-referencing hierarchy. Nesting is the essential idea, not a map pin. |
| **Item** | A physical owned object. Carries acquisition, warranty, location, assembly tree. |
| **Event** | Something that *happened* in the world. Exists independently of any participant. |
| **Plan** | Declared intent — goal, commitment, prediction. Plans are the declared layer made queryable. **Plan is the mirror image of Event**: prediction vs. record. Their glyphs must be visibly paired — same form, one solid, one provisional. |
| **Group** | A collective identity — family, team, company. Humans only in Person; collectives live here. |
| **State** | A timestamped condition on any entity. Always point-in-time, never a mutable field. |
| **Note** | A raw captured thought or voice-memo transcript. The unstructured entry point before resolution into structure. |
| **Interaction** *(the one edge)* | The universal linker connecting any combination of the above, carrying timestamp, emotional weight, outcome. This is the connective tissue of the entire graph — its glyph is the most important one after the master mark. |

Constraints: one grid, one stroke weight, one corner radius, one optical size. Each glyph must be distinguishable from every other at 20px. Present the nine together as a specimen sheet.

---

## 5. The app suite

Each app is a **lens over one shared graph** — not a separate product. Icons must read as siblings: same grid, same stroke, same corner radius, same optical weight, differing in *glyph* and (secondarily) in accent tint.

| App | What it is | Design note |
|---|---|---|
| **Home** | The control plane and daily front door. Orientation, commitments, review burden, one prioritized nudge. It is the *cross-primitive* surface — the hub, the parent. | Should be closest to the master mark — arguably the master mark itself with a containing form. **Not a house.** |
| **Persons** | The People lens: interactions, inbox, imports, mail/calendar/messages, "Theory of Person," graph notes. The flagship, saleable standalone. | Built on the Person glyph + the Interaction edge. Must stand alone as a consumer App Store icon without the LifeOS context. |
| **Places** | The Places lens: place profiles, visits, location import review, maps. | Nesting/hierarchy, not a pin. |
| **Stuff** | Items and inventory — what is owned, where it lives, warranties, assembly trees. | |
| **Events** | The record of what actually happened; calendar surfaces. | Must pair visually with Plan. |
| **Level Up** *(IRL Player)* | Training, workouts, recovery, health states, and a ratings engine — real-life character sheet. Combining raises your ceiling; training moves you within your band. | The one app allowed a slightly more energetic read, but still Still. Bands/ceilings, not muscles or flames. |
| **Assistant** | Chat + actions across the graph. The "counsel," not a chatbot. The manifesto's word is *counsel* — "That is not a notification. That is a relationship." | **No speech bubble. No sparkle.** |
| **Theory Of** | Prose-heavy synthesis — the system's written interpretation of a person. Newsreader-forward, extra whitespace. | The most editorial, most literary mark in the suite. |
| **Companion** *(iOS)* | The always-on capture app — HealthKit, location, ambient signal collection feeding the graph. | Capture/intake, not a camera. |
| **API** | Headless service surface (`api.lacollecteur.com`). Dev-facing. | The most reduced, most utilitarian mark. |

Plus reserve, and show the system extends cleanly to: **Finance** (transactions as evidence attached to existing entities, never a separate financial identity), **Wardrobe**, **Inventory**.

---

## 6. Family logic — pick one and justify it

Choose a single explicit mechanism for how the child icons relate to the parent, and state it as a rule:

- **(a) Container constant, glyph varies** — every app shares the same containing shape from the master mark; the primitive glyph changes inside it.
- **(b) Fragment logic** — each app icon is a visible *sub-graph* of the master mark, as if extracted from it. Strongest conceptual fit with "one graph, many lenses."
- **(c) Tint system** — identical construction, per-app accent drawn from the Still palette. Weakest alone; acceptable as a secondary layer on top of (a) or (b).

Recommend one, show it applied to all ten apps, and be honest about its failure mode.

---

## 7. Deliverables

1. **Three master mark directions**, as specified in §3.
2. Once a direction is chosen (present all three as if for selection), the **full suite in that direction**: nine primitive glyphs + ten app icons + reserve apps.
3. **Wordmark lockups:** "LifeOS" horizontal and stacked; "La Collecteur" corporate lockup; clear-space rule expressed in units of the mark's own geometry; minimum sizes.
4. **iOS app icon renders** — squircle, 1024px, for Companion and Persons at minimum (these ship to the App Store).
5. **Favicon set** — 16/32px proof that the master mark survives.
6. **Specimen sheet** — all marks together on cream and on petrol.
7. **Rulebook** (1–2 pages): grid, stroke weight, radius, optical corrections, do/don't examples, and the exact rule for drawing an eleventh app icon that will look native to the set.
8. **Clean SVGs**, single-color where possible, sensibly named, no embedded rasters, no external font dependencies in the mark itself (outline any type).

---

## 8. The tone check

Before submitting, test every mark against this line from the manifesto:

> "Not another expensive to-do list. A foundation for becoming who I am trying to become."

If a mark would look at home in a screenshot of a productivity app's pricing page, it is wrong. It should look like a **hallmark on an object someone owns and intends to keep** — quiet, warm, structural, and honest about being a graph.
