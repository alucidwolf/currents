# What Currents is, and what it refuses

This document exists to settle arguments before they are had, and to make it
cheap to say no. Everything in it was already true of the code — it is written
down here because a refusal scattered across nine file headers is not a refusal
anybody can hold you to.

It does not cover how the thing looks. That is the README's **Art direction**
section, which is the authority on the visual target and stays where it is.

---

## What it is for

**A calm ocean to leave running.** You open it and you are already swimming.
You can steer, change animal, or do nothing at all — left alone it explores by
itself indefinitely. Its best use is a spare monitor with `#ambient` on the end
of the address, where it will run for hours without asking anything of anybody.

That is the whole of it. There is no second purpose hiding behind this one.

The feeling to protect is *drifting*. Everything below is downstream of that
one word, and any change that makes the page more demanding, more urgent or
more interruptive is working against the only thing it does.

---

## What it refuses

Each of these is already enforced somewhere in the code. The file named is
where it currently lives, so a change that breaks the rule has something
concrete to answer to.

### 1. No goals, no scores, no timers, no fail state

There is nothing to win and nothing to lose. Nothing is counted. Nothing is
unlocked. Nothing is behind anything else. A progress bar, a collection, a
"you have now seen 6 of 9 animals" — all of it is out, because all of it
converts drifting into completing.

*Stated in the README's opening. Nothing in the codebase counts anything.*

### 2. Nothing stands between the page and the ocean

No menu, no start screen, no splash you have to clear, no "click to begin", no
cookie banner, no sign-in, no modal. The swim starts on load.

This one has already been fought and won once. An animal picker used to be the
first thing that happened — a card with a name and a sentence to read before
anything moved — and it was removed precisely because it was a door in front of
the thing people came to see. What replaced it opens on purpose, sits over a
swim already in progress, and closes on almost anything.

*`src/main.ts` ("Straight into the water. There is no menu."),
`src/ui/speciesPicker.ts` ("Deliberately not the start screen that used to be
here.")*

### 3. Nothing waits on you

No overlay blocks the world behind it. The animal keeps swimming behind the
picker the entire time it is open, which is also why choosing from it is instant
rather than a commitment. The title card shows over a moving ocean and leaves on
its own. The loading screen is a cover over work actually being done, not a
pause for effect, and it has a hard timeout so a failure can never leave it up.

A corollary, and the reason the title card is now skipped on a paused start: any
overlay that counts down in frames must not be shown when there are no frames.

*`src/ui/speciesPicker.ts`, `src/ui/titleCard.ts`, `src/main.ts` (`dismissBoot`)*

### 4. The screen stays clean

Controls fade out after a few seconds of stillness and come back at the first
sign of life, so an unattended screen ends up clean without anybody dismissing
anything. `#ambient` starts it already faded. `H` removes the overlay entirely.

The bar for a new permanent on-screen control is therefore high: it has to be
worth taking up room in a view whose whole design is to empty itself. Two pills
bottom-right is close to the ceiling, not a pattern to keep extending.

*`src/ui/hud.ts` (`FADE_AFTER`), `src/ui/launch.ts` (`#ambient`)*

### 5. A control nobody can see is not a control

Keyboard shortcuts are accelerators, never the only way to do something. The
number keys change animal *and* there is a button; `M` mutes *and* there is a
switch; `Space` pauses *and* there is a button. A feature reachable only by a
key you would have to already know does not count as shipped.

The exceptions are deliberate and are all developer tools — `F` for stats, `P`
for the diorama pass — which are not for the person drifting.

*`src/ui/speciesPicker.ts` ("a control nobody can see is not a way to change
animal, it is a thing you have to already know")*

### 6. One art style, one world

Faceted low-poly forms, bright saturated colour, the cosy tabletop diorama.
There is no second visual register, no unlockable skin set in another style, no
seasonal reskin, no crossover. A good idea in a different style is a different
project, not an addition to this one.

The direction changing does not weaken this rule — it is the rule working. One
style was chosen over another and applied everywhere, rather than the two being
allowed to live side by side.

*`design-system/START-HERE.md` is the authority; the README's **Art direction**
summarises it. This is also why the "STARDUST" space concept is tracked as a
separate project rather than as a mode.*

### 7. Rare things stay rare

An endlessly generated world has a characteristic failure: everywhere is equally
interesting, which means nowhere is. Wrecks appear in roughly one chunk in
seventy for exactly this reason. Anything added as a special moment inherits
that discipline — if you can count on seeing it, it has stopped being one.

*`src/world/landmarks.ts` (`WRECK_CHANCE = 1 / 70`)*

### 8. It is generated, not shipped

The world comes from a seed. The sound is built from two noise buffers and some
oscillators; there are no audio files. This is a constraint worth keeping: it is
why an ocean fits in a link, and why a new animal is a function rather than an
asset pipeline.

*`src/world/terrain.ts`, `src/audio/soundscape.ts` ("There are no audio files.")*

### 9. It only remembers what is yours to keep

Settings follow you between oceans. A swim belongs to the ocean it was swum in.
Anything the system tells us — `prefers-reduced-motion` above all — is obeyed
fresh each visit and never remembered, so a preference of ours can never
quietly overrule a setting of theirs.

Damaged, blocked, full or missing storage always reads as a first visit. Nothing
from storage is trusted until every field has been checked.

*`src/core/memory.ts`, `src/ui/pauseControl.ts`*

### 10. It has to survive being left open

Hours on a second monitor is the intended use, not an edge case. That makes
battery, memory growth and long-run stability correctness concerns rather than
polish. A change that is fine for five minutes and bad for five hours is a
regression.

*`src/core/loop.ts` (suspends while hidden), `src/world/chunks.ts` (adaptive time
budget)*

---

## The test for a new idea

In order. The first no is the answer.

1. **Does it ask something of the person?** A decision to make, a thing to
   dismiss, a thing to keep track of. If yes, it is out.
2. **Does it still work if nobody touches it for four hours?** If not, it is out.
3. **Does it need a second art style, an asset file, or a new permanent control
   on screen?** If yes, it needs a very good answer, not just a good idea.
4. **Would seeing it every ninety seconds spoil it?** If yes, it has to be rarer
   than it wants to be — or it is scenery, not an event.
5. **Could it be understood without being explained?** If it needs a tooltip, a
   legend, or a line in the hints, look for a version that does not.

An idea that passes all five is probably right for this page. An idea that fails
one is not necessarily bad — it is probably a different project. That is what
happened to STARDUST, and that was the correct outcome, not a rejection.

---

## What this decides

Two items on the roadmap were deliberately held for this document.

**The scripted first minute** — a choreographed opening every new visitor sees:
rise to the sunlit surface, hang in the shafts, sink to the reef. It fails
refusal 3 and arguably refusal 2: for its length the ocean is a thing being
shown to you rather than one you are in, and the page's whole history is of
removing exactly that. **The recommendation is to cut it, not build it.** A
gentler version survives the test — opening a new swim near something worth
seeing, with full control from the first frame — because that is a good spawn
point rather than a performance.

**Colour variants per animal** — a second row in the picker. This passes all
five. It asks nothing, needs no new control, and adds no style. Its only real
risk is the palette going muddy, which has happened once before, and that is an
argument for building the palette check first rather than an argument against
the feature.

**The visual direction was settled on 2026-09-28.** `design-system/` is the
approved direction: faceted and toy-like, after TUNIC. It reverses the README's
"smooth stylised, not faceted low-poly" rule, and the README now says so and
defers to it. Refusal 6 is unchanged in force — *one* style, and this is the
one.

> **Two of these still need the owner's decision: the scripted opening and the
> colour variants.** Once decided, this notice goes and the decisions stand.

---

## Visual review notes

Any change that alters what the page looks like gets a short note in
`docs/reviews/`, named for the date and the change. A note is:

- the same view before and after, from a **fixed viewpoint in a fixed seed at a
  fixed time of day**, so the two pictures differ only by the change;
- one paragraph on what the change was trying to do;
- one paragraph on whether it did, written after looking rather than before.

The fixed viewpoints do not exist yet — they arrive with the benchmark tool,
which needs the same thing for timing frames. Until then a note names its seed,
time and rough position by hand, which is worse but is not nothing.

The reason for the format is that this look was tuned by argument with the
screen, and two of the rules in **Art direction** were learned by getting it
wrong first. Those lessons survived because somebody wrote down what the wrong
version looked like.
