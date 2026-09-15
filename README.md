# Evercast

A 2.5D incremental fantasy game about one endlessly evolving spell.

## Stack

- Vite + TypeScript
- React for HUD, menus and the spell tree
- Babylon.js for the 3D side-scrolling diorama
- Headless deterministic simulation engine
- `break_eternity.js` for incremental-scale numbers

## Run locally

```bash
npm install
npm run dev
```

## Validate

```bash
npm run validate
```

Validation runs the full Vitest suite and a production Vite/TypeScript build.

## Security, privacy and accessibility

Evercast has no server and no accounts, which decides what each of these can
honestly promise.

- **The save is the only untrusted input**, and it is validated rather than
  trusted: `src/engine/save/SaveGuards.ts` bounds every field on the way in, so
  no file - edited, corrupted or truncated - can produce a state the simulation
  could not have reached by playing, or a `NaN` that breaks an economy
  permanently. Saves also carry a checksum, which is tamper-*evident* and not
  tamper-proof; `src/engine/save/SaveIntegrity.ts` is explicit about the
  difference and about why a client-side game cannot close that gap.
- **Offline time cannot be farmed.** `src/app/AwayClock.ts` keeps a monotonic
  high-water mark of the wall clock, so moving the system clock forward pays
  once and then costs that much future progress, and moving it back pays
  nothing.
- **The deploy sets a strict CSP** and seven other headers - see `vercel.json`,
  pinned by `src/app/SecurityHeaders.test.ts`. `connect-src 'self'` is what
  turns "Evercast sends nothing" from a claim into something the browser
  enforces.
- **Nothing leaves the device.** Three `localStorage` keys, one cache holding
  copies of the game's own files, no telemetry, no third-party requests, no
  fonts from a CDN. The service worker that writes that cache refuses any
  request that is not same-origin, and `src/app/WebManifest.test.ts` fails if a
  host ever appears in it. See [the privacy note](docs/PRIVACY.md), which
  includes the commands to check it, and [third-party
  notices](THIRD_PARTY_NOTICES.md) for the Apache-2.0 attribution Babylon.js
  requires.
- **WCAG 2.2 AA** is enforced where it can be, in
  `src/ui/accessibility.test.ts`: contrast ratios computed from the token
  sheet, a focus ring on every focusable, reduced-motion honoured, and every
  `aria-modal` backed by something that actually manages focus.

## Licence

Evercast is proprietary: copyright (c) 2026 Blooprocket, all rights reserved.
See [LICENSE](LICENSE). It covers this project's own code and assets only -
the third-party dependencies stay under their own terms, reproduced in
[third-party notices](THIRD_PARTY_NOTICES.md).

Note that the production build ships source maps, so the TypeScript is
readable in any browser's developer tools. That is deliberate - it makes a
production stack trace worth reading - and the licence says plainly that being
able to read the source is not a licence to use it.

## Architecture rules

- `src/content` owns authored enemies, zones, gear data and spell-tree definitions.
- `src/engine` owns deterministic state/rules and may not import React, Babylon.js or browser APIs.
- `src/ui` owns React presentation and presentation-only layout such as spell-tree geometry.
- `src/game` owns Babylon rendering, animation and VFX and reacts to snapshots/events rather than deciding combat outcomes.
- `src/app` owns browser lifecycle, persistence and background/offline catch-up.

See `docs/ARCHITECTURE.md`.

## Environment art

The Blender-authored environment library contains 39 props for Greenfields,
Whispering Woods, and Gravehollow. Editable source and preview sheets are in
`art/environment`; individual GLBs and their manifest are in
`public/models/environment`. See [the asset guide](art/environment/README.md)
for inventory, scale conventions, rebuild instructions, and integration notes.

The articulated cast includes the mage, all eight enemy types, and eight standalone
equipment files. Five animation clips drive travel, casting, attacks, hit reactions,
and defeat; equipment gains modeled details across all six evolution tiers.
Editable Blender source, a cast sheet, and rebuild instructions are in
[the character guide](art/characters/README.md).

The renderer adds matte materials, uneven terrain around a clear combat lane,
soft shadows, layered distant hills, wind, and lit biome landmarks. In development,
**N** previews the next biome and **Shift N** its transition; these shortcuts do not
change simulation progress or appear in production.

## Light and air

The diorama is shaded by three custom shaders rather than by Babylon's defaults.

- **`src/game/render/Atmosphere.ts`** is a material plugin that rides on the PBR
  shader - so the lights, the shadows and the image processing are untouched -
  and replaces flat fog with aerial perspective: haze that pools low and thins
  with height, coloured from the ground haze along the floor to the sky at the
  top of the frame, and lit *along* the sun rather than evenly. It also carries
  the wind, which used to be the CPU rotating every prop on the road once a
  frame and is now a vertex offset scaled by height above each prop's own base,
  and a translucency term that lights a leaf with the sun behind it.
- **`src/game/world/WorldBackdrop.ts`** casts the sky from the view ray instead
  of painting it in screen space, which is what makes the gradient, the sun, the
  cloud deck and the stars facts about the world rather than about the window.
  The three parallax ridgelines are mixed out of the sky's own horizon, so they
  nest inside it at every biome.
- **`src/game/actors/ActorAssets.ts`** fades an enemy up as it arrives and down
  as its body settles, which is what lets the shot be aimed further down the
  road than the spawn line.
- **`src/game/world/WorldHorizon.ts`** is the land past the last chunk, plus the
  mist lying on it. A camera frustum widens with depth, so a ground made of
  twelve-unit chunks runs out inside the frame however many of them are kept
  alive - and the corners of the picture showed the world ending on a diagonal.
  One mesh of four hundred vertices reaches further than any frame can, rolls
  where the chunks are flat, and is continuous with them because both read the
  same height function.

Two things about the light are worth knowing before changing any of it. The
**key-to-fill ratio** used to be about one to one - between the sky light, the
rim and the sun, the sun was roughly a third of the light in the scene, so
nothing had a lit side and a dark side and the shadow map had almost nothing to
remove. `FILL_SCALE` and `KEY_SCALE` in `WorldGenerator` pull those apart
without touching a single authored biome value. And the **foreground** is a
deliberate plane: a few clumps between the camera and the road, cropped by the
bottom of the frame and well inside the near blur, because a shot with nothing
in front of its subject reads as an elevation drawing.

The shot itself is composed by `src/game/render/Framing.ts`. The party stands
about a third in from the left at every aspect the game is played at, with the
road ahead - and whatever is walking down it - filling the rest.

## Performance, and phones in particular

The renderer decides a budget from the device before it draws anything, in
`src/game/render/DeviceProfile.ts`. The problem on a handheld is heat rather
than frame rate: a renderer that merely *reaches* sixty frames on a phone
reaches them for a few minutes and is then throttled for the rest of a session
that an idle game expects to be long. So the tiers cut what costs every frame
forever.

| | desktop | tablet | handheld |
| --- | --- | --- | --- |
| Frames per second | uncapped | 60 | 30 |
| Shadow map | 2048 | 1024 | 512 |
| Finishing passes | 6 | 4 | 1 |
| Chunks built | 6 | 5 | 4 |

`src/game/render/FrameGovernor.ts` then moves the resolution between bounds from
measured frame times, because thermal throttling is exactly the failure a static
profile cannot predict - it arrives minutes in, on hardware that was fast at the
start. Players who disagree with any of it set **Frame rate** in Settings.

Two structural fixes underneath the tiers apply everywhere. The glow layer used
to render the whole scene a second time to discover that grass does not shine;
it now sees only the materials that can glow. And the world kept thirteen
terrain chunks alive spanning 144 units of road for a shot that shows about
twenty-two, so chunks outside the frame are built no further and hidden rather
than culled per mesh.

Measured on a 390x844 viewport, same software renderer, same stage:

| | before | after |
| --- | --- | --- |
| Meshes in the scene | 2,238 | 546 |
| Vertices | 1,169,798 | 217,913 |
| Meshes in the glow pass | 2,238 | 52 |
| Shadow casters | 399 | 218 |
| Draw calls per frame | 685 | 521 |
| Frames drawn in 14s | 20 | 93 |

## Companions

Up to five companions fight alongside the mage, drawn from a 30-strong roster
across five rarities and six classes. They are real combatants: they swing on
their own timers, soak the blows aimed at the mage, and can be knocked out for
the rest of an encounter. Duplicates bank shards, and shards buy star levels.

Companions get their own section of the rail: a roster screen, a Party screen for
deploying them, and the Summon banner. Summons cost Starlight, a third wallet
earned from kills so the collection loop feeds off the combat loop without
competing with gear or Arcane Essence. The
reveal is animated, with a skip toggle in Settings and a Skip button on the
overlay itself.

Companion models are procedural placeholder art built from primitives at
runtime, not authored GLBs — `modelKey` is the seam a Blender pack would drop
into later. See the Companions section of [the architecture guide](docs/ARCHITECTURE.md).

## Starting up

Start, loading and first-run onboarding are one screen, not three. The boot gate
shows the title while Babylon and six megabytes of models stream in behind it,
so the world arrives complete rather than assembling itself in view, and the
button that opens it is also the gesture browsers demand before any sound can
play - which an idle game otherwise never collects.

Onboarding is derived rather than scripted. One hint shows at a time, each one a
question about live state, and each retires because the player did the thing it
asked for rather than because anything recorded that they saw it. Only the
opening premise is stored, in the save rather than beside the preferences, so it
travels with an export and a Rebirth never replays it.

## Automation

Evercast's opening line is "Nothing here needs your hands", and until
`src/engine/automation/` that stopped being true after about an hour: the whole
gold economy was a button, tapped a few hundred times a stage.

The rule that decides what belongs there:

> **Automate what has one right answer. Never automate what has a build behind
> it.**

So Gold, Spell Points and shards are handed over, and each defaults on because
giving them away costs the player no decision they were making. Summoning is
there too but defaults *off* - the reveal is content rather than friction.
Activating a spell node is deliberately absent and must stay absent: the routes
are exclusive, a capstone is a choice, and a game that picked the tree for you
would have automated away the only thing Evercast is about. Party slots are out
for the same reason.

Automation runs as an encounter is created, and that call site is the whole
determinism story. Buying gear changes the mage's damage, which changes when
the next enemy dies - so it must not fire at a moment that depends on how
`advance` was chunked. Arriving at an encounter is already an event the loop
stops on, and both the cleared path and the defeated one route through travel
to reach it, so one hook covers every way a fight can end.

The engine owns the purchase rule and `tools/balance/` now imports it, so a
balance run measures the player the game actually has. See [the progression
curve](docs/PROGRESSION_CURVE_V1.md) for what that changed.

## The Surge

Every other decision in Evercast is made in a menu and then watched. The Surge
is the exception, and the only place the game asks for the player rather than
for their build.

Every third boss swing is a **Surge**: telegraphed for about two seconds
instead of the 0.3s cue an ordinary swing gets, which is the difference
between a cue for the renderer and a window for a person. Spend a
**Counterspell** charge while it is in the air and the blow is cancelled and
the boss reels - taking half again as much damage from the mage and the party
alike for four seconds.

The rule the whole mechanic is built on, and the one not to break:

> **A Surge replaces a boss swing. It never adds one.**

It lands for the ordinary damage at the ordinary moment its cooldown was
already going to bring it. The only thing that moves is when the telegraph
*starts*. So a player who is away, or who never presses the button, faces
exactly the boss they faced before Surges existed, and a player who is present
gets something better than that. This is an idle game: a mechanic that punished
absence would be a tax collected mostly from the people who like the genre
most. `src/engine/combat/Surge.test.ts` pins that invariant in two halves - the
telegraph does not move the blow, and an unanswered Surge deals ordinary
damage.

Whether the next swing is a Surge is derived from a swing count rather than
stored as a flag, so offline catch-up, a chunked run and a resumed save agree
about it without any of them replaying the fight. The charge pool is
deliberately *not* one of the gates the combat loop stops on: a charge arriving
changes what the player may do and never what the world will do, so it settles
by subtraction and `nextAction` is untouched.

## Installing it

Evercast is a web app with a manifest, an icon set and a service worker
(`public/sw.js`), so it installs to a home screen and opens with no network at
all - from the first visit, which took two fixes to be true. Registration is
deferred to `load`, so the entry bundle, the stylesheet and the preloaded
typefaces are all fetched before the worker exists; it never sees those
requests, so the install step goes and gets them by parsing the shipped shell.
And every cache lookup passes `ignoreVary`, because a host sending
`Vary: Origin` otherwise makes a stored entry unmatchable by the page that
needs it - the precache was storing the right files under the right URLs and
failing to serve them. Only Vite's content-hashed `assets/` are cached as immutable; models,
fonts and icons are served from cache and refreshed behind the player, so a new
model arrives on the next launch with nothing versioned by hand. The shell is
network-first, because serving a stale one would pin a player to a build whose
assets may already be gone.

The install is offered in **Settings → Account** and nowhere else. The
browser's own install bar is suppressed the moment it fires, precisely so an
idle game never interrupts a fight to ask for a home-screen icon.

Icons are generated by `tools/icons/generate.mjs`, which is dependency-free -
Node already has the only hard part of PNG - and the output is committed. Run
it after changing the mark.

## Spell tree

One spell, 127 nodes: three routes, nine identities with three-rank side paths,
nine mutations, nine pairwise fusions and two capstones per route - one that
answers a hit, one that answers a death.

The fork is sharp but not permanent. Attunements, bought with the Knowledge that
Rebirth pays out, widen the exclusive groups: take all three identities of a
route, then hold two routes at once, then all three. The routes compose rather
than exclude - Twin is how many projectiles, Piercing how many targets each one
reaches, Charged how hard and how slow - so a blended build is two heavy bolts
that each penetrate. A legal build grows from 18 points to 105 - everything but
the capstone you did not take, which stays a choice however much you unlock.

See [the v2 guide](docs/SPELL_TREE_V2.md) for the rules, tuning, blended-route
conventions and save migration, and [v1](docs/SPELL_TREE_V1.md) for the original
graph and its combat conventions.
