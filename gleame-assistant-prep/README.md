# Gleame Assistant — Interview Prep Kit

Prep for the **Technical Deep Dive** (Neo / Foothill Labs, Rohan Desai) on the Gleame chat assistant. Target: complete by **July 5, 2026**.

## The three files

| File | What it's for | How to use |
|---|---|---|
| **`slides.html`** | The presentation. 21 slides, every diagram baked in as SVG (no whiteboard needed). | Open in a browser → **F** fullscreen. **← →** navigate. Keys: **S** speaker notes · **O** overview/jump · **T** start/pause 20-min timer · **R** reset timer · **#** type a number to jump. **Cmd-P exports a PDF backup with notes.** |
| **`DEEP_DIVE.md`** | The giant teaching doc — everything the assistant does, with diagrams, design defenses, the 15-question Q&A bank, and anchor sentences. | Study end-to-end. This is the source of truth; the slides map 1:1 to it. |
| **`VERIFIED_FACTS.md`** | The numbers cheat-sheet. Every constant extracted from code + adversarially verified (57/57 confirmed). Includes the **cost rule** and **pricing tiers**. | Skim the morning of. Memorize §3 (cost) and §5 (do-not-claim). |

## The 60-second strategy
1. Reframe: *"This is a CRO system; the AI is the engine, I built the car."*
2. Walk one shopper through the architecture (slide 5–6).
3. Land the two hard problems: the **latency·cost·quality triangle** + **cold-start recommendation**.
4. Close on the honest data arc: **build → measure → diagnose → iterate** — desktop wins, mobile loses, the photo step is the 66% leak, "the AI works; the mobile friction is the bug."

## Before the room (5 to-dos)
- [ ] **Book the slot** (Calendly) — don't let scheduling slip.
- [ ] **Swap the demo slide (slide 4)** — replace the schematic SVG storyboard with a real 15-sec screen recording or 3 real screenshots. A real before→after is the strongest frame in the deck. (Look for the `TODO` comment in `slides.html` above slide 4.)
- [ ] **Fill in the per-image AI cost** from the provider rate card → compute `cost = 3 × img + 1 × classify`. (Never quote a $ you didn't measure — it's not in the code.)
- [ ] **Export a PDF backup:** open `slides.html`, **Cmd-P** → Save as PDF. The print stylesheet linearizes all 21 slides *with speaker notes* — keep it on disk in case the laptop/browser misbehaves in the room.
- [ ] **Rehearse twice with notes on (S), once with them off, using the timer (T).** No AI in the interview, so the system path must be muscle memory.
