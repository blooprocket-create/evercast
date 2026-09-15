# Evercast Architecture

Evercast is a deterministic incremental simulation with a 3D presentation layer.

## Non-negotiable boundary

`src/engine/**` must never import React, Babylon.js, browser storage, DOM APIs, or presentation assets.

The authoritative game can therefore run:

- in the browser with Babylon + React,
- headlessly in Node for balance testing,
- during offline/background catch-up,
- in automated tests,
- and later on a trusted server if validation is ever needed.

## Runtime dependency graph

```text
content/ authored game data
   ↓
engine/ authoritative deterministic rules
   ↓ snapshots + serializable GameEvents
┌───────────────┬──────────────────┐
↓               ↓                  ↓
app/           game/               ui/
persistence    Babylon             React
boot/offline    renderer            menus/tree
```

Presentation never reports collision, damage, kills, progression, or rewards back into the engine.

## Ownership rules

### `src/content`

Owns authored game data: enemies, zones, gear definitions/tuning, and the authored spell-tree graph. Content may use engine schema types, but authored names, descriptions, balance values, and graph definitions do not belong inside engine system files.

### `src/engine`

Owns deterministic rules, mutable authoritative state, economy/combat calculations, save migrations, commands, snapshots, and serializable events. It does not own React/Babylon behavior or UI layout coordinates.

### `src/ui`

Owns React presentation and presentation-only layout data. Spell-tree x/y coordinates live here rather than in the gameplay node definitions.

### `src/game`

Owns Babylon models, animation, camera, environment rendering, particles, VFX, and other visual reactions to snapshots/events.

### `src/app`

Owns browser lifecycle, save loading, autosave, visibility/background handling, and bootstrapping - including the boot phase the shell gates on.

## State boundaries

`GameState` currently has five domains:

- `RunState`: frontier, current encounter, push/farm mode, Arcane Essence, spell build, combat timers, the live party and run stats.
- `MetaState`: Rebirth count, Knowledge, lifetime/highest-stage records, permanent unlock/story flags.
- `EquipmentState`: Gold and the eight persistent gear pieces.
- `SpellTreeState`: purchased Spell Points, activated spell-tree nodes, and the Attunements that set the tree's rules.
- `CompanionsState`: Starlight, the owned roster, the party, and the draw/pity counters.

Rebirth replaces `RunState` while equipment and spell-tree state survive. Knowledge now has a sink - it buys Attunements, which are permanent tree rules - so the first rebirth opens the tree rather than merely costing a frontier. The reset boundary itself is still provisional and must not become canon by accident.

## Numbers

Authoritative economy/combat magnitudes use `break_eternity.js` `Decimal` values. Serialization uses strings. UI receives `QuantitySnapshot` values (`raw` + `display`) rather than owning Decimal objects.

## Boot

Start, loading and first-run onboarding are one state machine rather than three screens. `src/app/BootPhase.ts` is the whole of it: a pure function of two facts - whether the scene's assets have settled, and whether the player has pressed the button - and `src/ui/shell/BootGate.tsx` draws whichever of `preparing` / `ready` / `playing` that yields.

The expensive part of boot streams *behind* the gate. `App.tsx` reaches `EvercastScene` through a dynamic `import()` rather than a static one, which keeps Babylon out of the entry chunk: the gate is React and CSS and paints while the renderer is still arriving, and `index.html` carries a wordmark in plain markup so something is on screen before any script has parsed at all. The game loop does not start until the gate opens, so nothing ticks against a world nobody can see; time spent waiting lands in the away debt like any other absence.

Four properties the gate has to keep:

- **It shows what it is waiting for.** Once the world is genuinely loaded, `EvercastScene.showTitle()` lifts the camera clear of it and raises an arcane sigil built from the game's own VFX meshes; the gate then fades its curtain and the sigil comes up through it. That ignition *is* the readiness signal - the difference between `preparing` and `ready` used to be a button label and nothing else. See **The title sigil** below.
- **It is never a trap.** `ASSET_WAIT_CEILING_MS` opens it regardless after a bounded wait, and `begun` outranks readiness in the reducer. A 404 on a GLB costs the player their scenery, never their session - `ActorAssets` already draws primitives for a mesh that never came, and the simulation never wanted the meshes at all.
- **It never reopens.** A VFX-quality change disposes the scene and builds another, unsettling its assets under a game already in progress. `begun` winning outright is what stops that throwing the title back up.
- **It is the only guaranteed gesture.** Browsers refuse to open an `AudioContext` without one, and an idle game asks for none - the mage fights unattended. Before the gate existed, a first session could run its whole length in silence.

### The title sigil

The camera moves; it is not replaced. With the angles held and `radius` pinned, translating the target translates the camera and the view direction is unchanged - so bloom, the ACES tone map, the vignette, grain and the colour grade all still apply, because it is still the camera `DefaultRenderingPipeline` was built around. A second camera would have had none of them, and bloom is the whole reason an additive sigil reads as light. Depth of field is the one effect suppressed while the title is up: it exists to separate a combat lane from its background, and at the default aperture it turns a sigil sitting a fraction off the focal plane to mush.

Parking it 400 units up is what hides the world, and hiding is the right word - `WorldGenerator`'s constructor calls `rebuildVisibleChunks()`, so terrain and props exist from the first frame even though `updateAtmosphere()` has not run and the fog is still at Babylon's default. The world is outside `camera.maxZ` and clipped, rather than disabled.

The curtain lifts on *ordering*, not opacity: `showTitle()` resolves on `onAfterRenderObservable`, so a frame of the void is already on screen before anything becomes see-through. `src/game/title/` owns the sigil and the framing; `src/ui/shell/BootGate.tsx` only knows whether it may lift.

`.layer[inert]` also hides the HUD and shelf, which `inert` alone does not do. They were being painted behind the gate all along, invisible only because it was opaque.

## Onboarding

Derived, not scripted. There are no controls to teach: every command in the engine is a purchase, and what a new player does not know is which wallet buys what - none of which is worth saying until the wallet has something in it.

So `src/ui/onboarding/coachMarks.ts` is a list of pure questions about live state, highest priority first, at most one live at a time. The rule that keeps it honest: **a mark may only be retired by the state it describes.** "Gold buys gear levels" stops being true when a level is bought; "you have a Spell Point" stops when the point is spent. Nothing is stored, nothing is sequenced, and a mark still true a week later is still worth showing. A condition that needs a "seen" flag to retire it is one being said *at* the player rather than *about* the game, and belongs in the premise instead.

The premise is the single exception, and the single stored bit: it describes the shape of the whole game rather than any one wallet, so nothing the player does makes it false. It lives in `MetaState.storyFlags`, which `SaveCodec` has carried since v8 and nothing had written to - no migration, no new key. That placement is deliberate: onboarding state is progress, not preference, so it survives a Rebirth and travels with an exported save. Someone who moves to a new device is not a new player.

Neither is a sixth archetype. `ARCHETYPES` is closed at five and `ui/architecture.test.ts` asserts it; the gate and the coach mark are shell chrome, and the premise is a `Moment`.

## Time and offline progress

The simulation is event-driven rather than frame-driven. `advance(seconds)` consumes time until the next spawn, cast, enemy attack, timed spell effect/status expiration, or encounter transition. The same method powers live play and offline/background catch-up, so renderer FPS and browser throttling cannot change authoritative outcomes.

The browser layer detects tab visibility. Hidden time is applied through `OfflineProgressor` when the tab becomes visible again, with presentation events suppressed and the normal offline cap applied.

Long absences are settled analytically rather than simulated end to end. `OfflineProgressor` simulates the first `OFFLINE_SAMPLE_SECONDS` (ten minutes) of an absence at full fidelity, then credits the remainder from the per-second rate that window measured. So an absence up to the sample is exact - a tab closed over lunch loses nothing - and a longer one costs the same bounded work whether the player was gone a day or a week.

Only the repeatable kill rewards are extrapolated, through `EvercastSimulation.creditOfflineYield`: Gold and Starlight. Essence and the stage are deliberately left to the simulated window alone. Essence is a first-clear reward and `totalFirstClearEssenceEarned` treats the highest stage as the authority on how much has ever been earned, so synthesising either would put a save at odds with its own economy. The practical cost is that a long absence no longer pushes the frontier as far as exact catch-up would have; measured, a day away walls out and farms after a stage or two regardless.

This replaced exact event-by-event catch-up, which did not fit in a startup. The loop takes one step per world event, so a day away from a played save is several hundred thousand steps: applied in one pass before the first render it blew the advance step budget and came up as a blank page, and spread across frames it left the world visibly fast-forwarding for a minute while the interface was live - which in turn let a returning player spend their first credited Gold and have the rest of the absence run on the stronger build. Settling in one bounded call removes all three.

`src/app/runtime.ts` is imported on the way to the first render, which makes anything that throws there a blank page on every reload rather than a handled error. It resumes a save defensively, reaches for `localStorage` behind a guard (touching it throws outright in a sandboxed iframe or on an opaque origin) and runs without storage rather than not running. Away time owed at boot is settled by `GameLoop` on its first frame for the same reason, and a save made before that lands stamps itself back by what is still owed, so leaving in between defers the absence rather than banking it.

## Encounter system

Each stage is a finite timed-spawn encounter. Multiple authoritative enemies can coexist.

An encounter owns:

- total enemy budget,
- spawned count,
- spawn cadence,
- maximum simultaneous living enemies,
- boss-stage identity.

The stage clears only after the full enemy budget has spawned and no living enemies remain. Spawn timing is independent of whether earlier enemies have died, subject to the `maxAlive` safety cap.

## Combat and presentation events

`CombatSystem` resolves casts, deterministic critical hits, direct hits, pierce, chain, splash, repeats, enemy attacks, control, leech and triggered effects. Player casts win exact timer ties.

A death is answered in one place. `TimedSpellEffects.resolveKill` owns what the spell does about a kill and `EncounterLoop.collectDeadEnemies` is the only caller, because that is where a corpse becomes an engine fact whoever made it - the spell, an infection ticking out, or a companion. It runs before the body is cleared away, and a kill it causes in turn is swept into the same step rather than left for a later one.

The engine event stream is the presentation contract. `projectile_hit` includes effect provenance (`direct`, `pierce`, `chain`, `splash`, or `repeat`), source target when relevant, and sequence information. Babylon should animate those facts rather than infer combat from build stats.

## Progression economies

Gold and Arcane Essence intentionally serve different loops:

- **Gold** is repeatable. Every kill grants Gold and farming/AFK time can accumulate it. Gold levels gear.
- **Arcane Essence** is finite frontier progression. It is granted only on a stage's first-ever frontier clear and purchases Spell Points. Farming/replaying already-cleared stages grants no Essence.
- **Knowledge** is prestige progression. Rebirth grants it and Attunements spend it, so it buys the tree's rules rather than its allocations and is never refunded.
- **Starlight** is repeatable and buys summons. It is deliberately a third wallet rather than a second use for one of the others: draws out of Gold would cannibalise gear, and draws out of Essence would break the rule above. It grows far more slowly than Gold per kill, with a boss multiplier and a first-clear bonus.

Boss first-clears currently award more Essence. Exact curves remain prototype tuning.

## Spell tree

The authored tree has three routes, identity groups, three-rank side upgrades, mutations, pairwise fusions requiring both parents, and a capstone per route requiring all three of its fusions. Allocations compile into SpellBuild.mechanics. EvolvingCombat and TimedSpellEffects own cast/timed behavior; stable enemy positions and temporary spell resources remain authoritative engine state. UI geometry stays separate.

Exclusivity is progression, not a fixed rule: `spellTreeExclusiveGroups` reads the player's Attunements, and the purchase ceiling is derived from the largest build those rules allow rather than from the node count. One fork is permanent - each route ends in one of two capstones, so the tree never collapses into taking all of it. The three routes compose - Twin is how many projectiles, Piercing how many targets each reaches, Charged how hard and how slow - so `route` is a derived name that combat never reads.

See [Spell Tree v2](SPELL_TREE_V2.md) for the rules, tuning, blended-route conventions and version 8 migration, and [Real Spell Tree v1](SPELL_TREE_V1.md) for the original graph and the combat conventions it established.

## Companions

Up to five companions fight alongside the mage as real combatants with their own
health. They swing on their own cooldowns, take the blow that would have hit the
mage, and can be knocked out; a knockout costs the rest of the encounter, never
the run. `ProgressionSystem.resetAfterEncounter` restores the party where it
already restores the mage.

Ownership is persistent and stored **once per companion**, never once per copy:
a duplicate draw banks shards, and shards buy star levels. Companion power is a
*share* of the mage's own numbers — health off her maximum, damage off her
per-hit — so a companion is worth what it says at every magnitude and needs no
second scaling economy.

Four rules carry the weight:

- **Beats are events.** `nextCompanionBeat` joins the same `min(...)` the spawn,
  cast and enemy beats already feed, and companion cooldowns tick only while
  something is in reach — the mirror of `tickEnemyCooldowns`. Passive abilities
  are never scheduled: a cooldown of zero would put a due action at t=0 on every
  pass and `advance` would spin until the safety limit.
- **Reaches are gates.** `soonestRangeChange` takes a list of thresholds so each
  companion's reach is a moment the loop can stop on, not a condition that can
  flip mid-step.
- **Targeting is pure.** `combat/Threat.ts` sorts by threat with no randomness,
  so a chunked run, a single pass and a resumed save agree on who took the hit.
  Enemies tagged `flying` or `ambush` invert the sort and dive the softest
  target, which is what keeps a wall of vanguards from making the back row free.
- **The standoff is stored.** A wave that spawns against a standing frontline
  keeps its distance for life, captured once at spawn. `contactPoint` is derived
  twice per step, so a stop that moved when a tank fell would put a chunked run
  and a single pass on different coordinates. It also reads correctly: the wave
  that arrives after the line breaks presses in.

Draws are a pure hash of a stored serial, so a reload continues on the roll the
session would have made next. Pity follows the Genshin/HSR shape — the published
rate is not the experienced one, and almost every high-rarity pull comes out of
the ramp.

Companions occupy their own rail group rather than sitting under Power, because
the three jobs are distinct: **Companions** manages the roster (stats, ability,
ascension), **Party** deploys it (pick a slot, then pick who fills it), and
**Summon** draws. The group set in `ui/nav/destinations.ts` is asserted closed by
`ui/architecture.test.ts`, so a fifth is again a deliberate decision.

Formation slots are gameplay geometry and live in the engine: they decide reach
and who is reached first. They separate mostly along x for the reason
`Contact.ts` gives about the enemy slots — z is nearly the depth axis at this
camera angle. Companion art is procedural placeholder built from primitives in
`src/game/actors/CompanionModels.ts`; `modelKey` is the seam an authored Blender
pack would replace without touching combat.

## Gear

The eight persistent gear slots are Helm, Staff, Spellbook, Robe, Boots, Necklace, Ring I and Ring II. Gold levels each piece independently with additive stat growth. Automatic evolution milestones are currently 1/50/100/200/500/1000 and remain tunable.

Authored gear names, descriptions and tuning live in `src/content`; engine gear modules own state/evolution mechanics.

## Environment assets

`world/EnvironmentAssets` owns the scene-local GLB template cache and creates instances
with shared geometry and materials. `EnvironmentPropCatalog` controls weighted biome
selection and scale. `WorldGenerator` owns scrolling chunk roots, roadside placement,
arrival landmarks, and cathedral assemblies. Disposing a chunk removes its instances;
disposing the world releases the templates and any late downloads. Asset loading never
changes deterministic combat or progression. The authored pack lives in
`public/models/environment`, with editable Blender source in `art/environment`.

## The render budget

`game/render/DeviceProfile` is the only place that decides what the renderer is
allowed to spend, and it is a pure function of a handful of facts about the
device plus one impure reader (`readDeviceFacts`) that touches the browser. That
split exists so the policy can be tested at every shape of device rather than on
whatever the developer is holding, and so a webview that throws from
`matchMedia` degrades to the conservative answer instead of failing to render.

The budget is about **heat**, not frame rate. A phone has no fan: a renderer
that merely reaches sixty frames on one reaches them until the chip throttles
itself, which on an idle game is always. So the tiers cut per-frame cost - the
frame cap, the shadow map, the finishing passes, how many chunks exist - and
leave one-off costs alone.

`game/render/FrameGovernor` is the half no profile can do: thermal throttling
arrives minutes in, on hardware that was fast at the start. It watches achieved
frames against the target and trades resolution, slowly and with hysteresis,
because every change resizes the whole render-target chain. Pure, and tested
against synthetic frame sequences.

Three rules hold for anything added here:

- **Nothing in the budget may change what is true.** The frame cap declines to
  *draw* a frame; the simulation is event-driven and runs on its own clock.
- **A tier only ever narrows.** `DeviceProfile.test.ts` asserts that no smaller
  device spends more than a larger one on any line, so a new field cannot be
  added to one tier and forgotten in another.
- **The player can overrule the part they can feel.** Frame rate is a Settings
  choice; `auto` defers to the tier.

## Light and air

`game/render/Atmosphere` is a Babylon material plugin, which is the whole of why
it is safe: it injects into the PBR shader at two hook points rather than
replacing it, so lighting, shadows, and image processing are exactly what they
were. It owns three things that were previously either flat or on the CPU -
aerial perspective, foliage wind, and leaf translucency - and one shared
`AtmosphereState` that `WorldGenerator` writes once a frame from the biome.

Scene fog is off, and must stay off: the plugin does that job, with a height and
a direction to it. Anything that makes a PBR material should hand it to
`breatheOn`; the scene's new-material observable catches whatever does not, and
the call is idempotent so the overlap is free.

`game/world/WorldBackdrop` casts the sky from the view ray rather than painting
screen space, which is what keeps the horizon, the sun and the stars correct at
every aspect `Framing` produces. Its ridgelines are mixed out of the sky's own
horizon colour so the two cannot drift apart.

`game/world/WorldHorizon` owns the ground past `CHUNK_FAR_Z`. The rule it exists
for: **a chunked ground cannot fill a frustum.** The frustum widens with depth
and the chunks do not, so the far corners of any wide shot will show the world
ending unless something unchunked is underneath them. It and the chunk terrain
read the same `terrainHeight`, and the horizon sits a hair below - so wherever
chunks exist they win, and where they have run out the seam is invisible. A
chunk's far rows were deleted to pay for it, which made the whole change
slightly *cheaper* than what it replaced.

The lighting has one number worth defending: the **key-to-fill ratio**. The sky
light, the rim and the sun used to come out at roughly one to one, which is the
ratio at which a landscape has no shape - and, less obviously, the ratio at
which a shadow map is pointless, because a shadow only removes the key's share.
`FILL_SCALE` and `KEY_SCALE` scale the authored biome values rather than
replacing them, so the relative mood of the four zones is exactly as written.

## Snapshots and coordinator size

`EvercastSimulation` is the orchestration boundary, not a dumping ground for every derived read model. Snapshot construction lives in `src/engine/snapshot/SimulationSnapshotBuilder.ts`, and event-to-text formatting lives in `src/engine/events/describeGameEvent.ts`.

As new systems arrive, prefer extracting cohesive builders/services rather than allowing `EvercastSimulation` to absorb unrelated presentation/read-model logic.

## Save / migration

`SaveCodec` owns versioned schema conversion across a stated window: `MINIMUM_SAVE_VERSION` (5) to `CURRENT_SAVE_VERSION` (8). Version 8 adds Attunements and version 7 the companions domain; older saves inside the window load with the feature simply not started rather than losing anything they had, and v5 additionally refunds its spell-tree allocations. Attunements deserialize before allocations, because they decide the group caps those allocations are validated against. Browser `localStorage` remains in `src/app`. Saves inside the window migrate forward rather than silently resetting progression.

The v1-v4 migrations were removed once the format settled. They carried a second enemy shape, a pre-encounter run shape and a reconciliation pass for a repeatable-Essence economy the game no longer has - three shapes kept alive only to be converted away from. v5 and v6 stay because the current path already reads them: they cost two conditionals, not a code path. A save below the floor is refused by the codec, reported by `BrowserSaveStore.load`, and the player starts fresh rather than loading a state the codec can no longer describe.

The solver is analytical past its sample window, as the seam always anticipated: exact within `OFFLINE_SAMPLE_SECONDS`, rate-credited beyond it. Combat and the save format are untouched by it - the extrapolation enters through one narrow `creditOfflineYield` call.

## Testing gates

`npm run validate` runs unit/integration tests and a production TypeScript/Vite build. GitHub Actions runs the same validation on PRs and `main`.

Coverage includes the boot phase reducer and the gate it drives, the title framing (a camera pose round-trip, and the Babylon `setTarget` behaviour it depends on) and the sigil it raises (fog opt-out, drift bounds, reduced motion, teardown), onboarding marks (that each retires on the state it describes, that one speaks at a time, and that none precedes the premise), deterministic advancement, multi-enemy overlap, push/farm behavior, content references, spell compilation, gear, Spell Point economy/pathing, first-clear Essence, save migrations and the version window the codec accepts, offline settlement (a day away from a played save inside a bounded budget, exactness within the sample window, rate scaling past it, and no synthesised Essence or stage), the advance loop's runaway guard, save loading that never throws on the way up, prestige reset boundaries, and architecture guards preventing presentation dependencies from entering `src/engine`.

## Still intentionally deferred

- final spell-tree balance,
- bounded/diminishing control rules,
- final prestige behavior,
- gear-tree point sources and authored gear trees,
- final enemy/zone tuning,
- story content,
- further batching and platform tuning of endgame VFX,
- analytics/cloud saves/accounts.

The architecture exposes seams for all of them without pretending their designs are already settled.

## Art and animation presentation

`ActorAssets` caches Blender GLB templates. Each combatant has independent transform
targets and animation groups while repeated parts share geometry and materials.
`ActorVisual` advances named idle, walk, attack, hit, and death clips on a presentation
clock, restoring the rest pose between states. Spell casts originate at the staff
socket. Cast animation duration adapts to the spell interval without delaying damage.
Enemy deaths briefly retain their visual, then release its animation groups and meshes.
The mage recovers from the defeat pose while the simulation resumes its existing flow.

Snapshots expose the content catalog's enemy `modelKey`; no renderer imports enter the
engine. Gear slots expose five cumulative modeled upgrades for the six existing tiers.
Changing equipment never scales anatomy or mutates shared material state.

`WorldTerrain` generates matching world-space chunk edges and a level combat lane.
`WorldBackdrop` owns the sky and distant hills independently of chunk lifetime.
`WorldGenerator` composes groves, verge vegetation, arrival landmarks, shadows, wind,
and two bounded local lights. Idle animation does not advance journey distance.
Environment templates are matte, except for restrained metal and emissive accents.
All GLB requests respect the Vite base path and handle late completion during teardown.

## Combat VFX

`CombatVfxPlan` reads authoritative hit provenance; `SpellVfxPresenter` schedules
short cosmetic flights and links, while `CombatFxPresenter` owns hit/death feedback.
`VfxPool` shares the Blender kit and bounds reusable meshes, path buffers, and jobs
through three quality presets. Presentation-only `healing` and `controlDelaySeconds`
metadata report actual applied results; no combat calculations moved into Babylon.
See [Combat VFX](COMBAT_VFX.md) for timing, resource ownership, caps, test coverage,
the development review fixture, captures, and measured performance limitations.
