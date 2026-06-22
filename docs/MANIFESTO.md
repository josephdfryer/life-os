# Life OS — A Manifesto

*What this project is, and why I am building it the way I am.*

> **This is the founding document for Life OS.** Read it before touching the data model, before designing a feature, before writing a query. Every decision in this project traces back to the beliefs stated here. When two options compete, this is what breaks the tie.

---

## I. The premise

Every AI product being built right now takes the **task** as its unit of analysis. Do the thing. Book the thing. Answer the question. Even the ones that talk about memory and personalization are really just trying to make individual tasks better.

That is not what I am building. My unit of analysis is **my life**.

The smog test is not a task — it is a signal that administrative debt is accumulating and quietly stealing energy from what I actually care about. The call I keep not making to my best friend is not a reminder — it is an intervention on behalf of a value I hold but keep deprioritizing. My sleep over the last week is not a health metric — it is a leading indicator of whether the version of me who shows up for my family tomorrow is the one I want to be.

Nobody is building *that*. So I am.

This is not, at its core, an AI product. It is a philosophy of living that happens to require AI to execute.

---

## II. Observation is not context

The current wave of "personal intelligence" devices and assistants are very capable **observers**. They see the world and gather data. But observation is only how you gather data — it is not what gives data meaning.

A system that watches me pick up my phone forty-seven times today knows something. But it does not know that I am trying to be more present with my family. It does not know that my relationship with my most stressful client is tied to a pattern that pre-dates the client by decades. It does not know that the reason I did not call my best friend this week is the same reason I did not call him last month, and that both instances represent a slow drift away from a relationship I have declared is one of the most important in my life.

Observation can tell you *what happened*. It cannot tell you *what it means*. Meaning requires a foundation — a structured, continuously updated model of who I am, what I care about, and where I am trying to go.

**That foundation is the work.** Everything else is plumbing.

---

## III. What context actually is

Context is not a pile of facts about a person. It is a structured understanding of how those facts relate to each other and to the life that person is trying to live. It has four layers.

- **The declared layer** — what I say I value, want, and intend. My goals, my principles, my vision for who I want to become.
- **The behavioral layer** — what I actually do, as recorded in the interaction log of my life. Who I spend time with, what I work on, how I spend money, how I sleep.
- **The relational layer** — the network of specific, named people, places, objects, and events that constitute my actual life. Not abstractions. The real ones.
- **The tension layer** — the gap between the declared and the behavioral. **This is where the most useful intelligence lives.** The places where my behavior diverges from my stated intent are exactly the places where I most need to be seen.

A system with true context does not just answer questions. It holds a living model of me and uses it to notice things I cannot notice myself, to surface the right observation at the right moment, and to intervene on behalf of the version of me I am trying to become.

The hardest thing this requires is **honesty**. The system has to take my declared values seriously *and* watch my actual behavior and tell me the truth about the gap. To be able to say: *you told me family presence matters most, but you've been in reactive work mode for eleven days straight and you haven't had one unscheduled hour with your kids.*

That is not a notification. That is a relationship. It is the difference between a tool and a counsel — and a counsel is what I am building.

---

## IV. The principles behind every decision

The data model is the unglamorous, hard, important part — the part most people skip. Every modeling decision traces back to a small set of beliefs. When two options compete, these are what break the tie.

### Derived over stored
Net worth, relationship health, equity, fulfillment, the duration of a state — none of these are fields. They are **queries**. The moment I store an aggregate, it starts lying to me the instant the underlying facts change. So I store the atomic truths and derive everything else on demand. A stored aggregate is a future inconsistency waiting to happen; a derived query is always current by construction.

### Semantic honesty over convenience
A primitive should never be overloaded with flags or convenience fields that misrepresent its true nature. When expected attendees on a Plan are just references to people, they are flat `Person` references — not `Interaction` edges — because nothing has actually happened yet, and pretending otherwise would corrupt the meaning of an Interaction. When a captured thought has no participants and no real-world occurrence, it is not an Event, no matter how convenient that would be. If a model name or shape starts to feel dishonest, that feeling is the signal to stop, not push through.

### Inference first, manual override available
The system should work out as much as it can on its own — group membership from co-occurrence at Events, presence assumed unless stated otherwise, entities resolved against existing nodes before new ones are created. But inference is never a cage. Where the data is incomplete, there is always a clean manual override so I am never fighting the model to record the truth.

### The raw/derived split
Raw files — audio, biometrics, photos of my notebook — archive on disk. Only the **derived signal** enters the graph: the transcript, the threshold crossing, the extracted entity. The graph stays clean and queryable; nothing is ever lost; and the node always carries a path back to the raw source. The graph is the meaning; the disk is the memory.

### Provenance is sacred
Every derivable node — Plan, Interaction, State, surfaced entity — carries a nullable link back to the Note it came from. I can always trace a conclusion back to the raw thing that produced it. A model of my life that I cannot audit is not one I can trust, and trust is the entire point.

### Defer constraints deliberately
When usage should inform the design, I defer rather than over-specify. Plan typing is deferred until real use demands it. Predictive flagging is deferred in favor of getting the retrospective right first. This is not indecision — it is refusing to invent structure before I have earned the right to it.

### Minimalism as discipline
The model is **eight primitives and one edge type**: Person, Place, Item, Event, Plan, Group, State, Note — connected by Interaction. I resist every new primitive hard, and I only add one when the existing set genuinely cannot represent the truth without distortion. Each addition survived real pressure-testing before it earned its place. A minimal model is not a limited one; it is a model where every part means exactly one thing.

### Naming humility is fine
A primitive's name does not need to signal sophistication. `Note` is called Note because that is the word I naturally use for the thing. The humility of the name takes nothing away from the power of what it enables.

---

## V. The eight primitives and one edge

The complete primitive set, as pressure-tested and locked:

| Primitive | What it is |
|-----------|-----------|
| **Person** | A human in my life. Carries attributes, closeness, history, and attention signals. |
| **Place** | A location at any scale — Earth → Country → City → Home → Room → Shelf. Self-referencing hierarchy. |
| **Item** | A physical object I own. Carries acquisition, warranty, location, and assembly tree. |
| **Event** | Something that happened in the world. Exists independently of any one participant. |
| **Plan** | Declared intent — a goal, commitment, or calendar-backed prediction. Plans are the declared layer made queryable. |
| **Group** | A collective identity — family, team, company, community. Person is for humans only; Group is the node for collectives. |
| **State** | A timestamped condition on any entity — health status, relationship phase, project state. Always a point-in-time fact, never a mutable field. |
| **Note** | A raw captured thought, voice memo transcript, or observation. The entry point for unstructured input before it is resolved into structure. |

The one edge type is **Interaction** — the universal linker that connects any combination of the above, carries its own metadata (timestamp, type, emotional weight, outcome, notes), and constitutes the behavioral layer of the graph.

---

## VI. The keystone: Events vs. Interactions

The single most important structural insight in the whole model is the separation of **Events** from **Interactions**.

An Event exists independently in the world — a meeting, a dinner, a phone call. It happens once, and the things that belong to it once (notes, transcripts, recordings) live on it once. An **Interaction** is the edge that connects a *Person* to that Event, and it carries the personal layer: emotional weight, outcome, what it meant to me.

This is why a flat wiki of "one page per person" can never be enough. A page cannot natively express that two people were both at the same dinner, or that the same event landed differently on each of them. The Event/Interaction split is what lets the graph hold the actual texture of a life: shared events, individually felt.

Plans sit alongside Events as their mirror image — **Plans are predictions, Events are records of what actually happened.** The gap between a Plan and the Event that fulfills it is the tension layer made queryable.

---

## VII. The values that constrain how I build

How I build is as much a statement of belief as what I build. These are non-negotiable.

- **Local-first and Mac-native.** This runs on my machine. My Mac stays on overnight, so capture and synthesis can run on `launchd` with no cloud dependency. The most intimate model of my life should not live on someone else's server.
- **Plain-text-first.** Files stay portable plain text. The folder *is* the format. There is nothing to be locked into, because there is nothing proprietary in the way.
- **Zero recurring service cost.** I will not rent the right to access my own life. Gmail as an inbox, an iCloud drop folder for raw capture, `whisper.cpp` for local transcription — free, owned, and mine.
- **No lock-in.** Not to Obsidian, not to any vendor, not to any format I cannot walk away from. A system meant to outlast every tool I currently use cannot be built on top of one.

These constraints all point at the same thing: **sovereignty.** A foundational model of who I am has to be something I fully own, can fully read, and can carry forward no matter what happens to any company or app.

---

## VIII. How decisions get made

I do not commit to structure before I have pressured it. Every primitive in this model earned its place by surviving hard questions and strawman proposals argued from both sides. I would rather spend an hour deciding whether something is an Event or a Note than spend a year living with a model that quietly lies to me.

I push back cleanly when a direction feels semantically wrong, even when it is the convenient one — *especially* when it is the convenient one. I let real usage, not speculation, tell me where to add structure. And I end every design session with a concrete handoff, because a belief that never reaches implementation is just a daydream.

---

## IX. What this is ultimately for

I want to live intentionally. That includes the things we are all good at tracking — work, money, deadlines — and the soft goals we routinely overlook: being present with my family, building something that lasts, keeping the relationships that matter from quietly drifting away.

To do that I need a system with ultimate context: one that can look at my sleep and tell me I am running hot, look at my goals and prompt me to call my friend, tell me which customers cost me the most peace, and get a jump on the smog test so I do not pay the late fee again. Not because any of those tasks matter on their own, but because together they are the difference between drifting and choosing.

Every AI tool I will ever use starts from zero and forgets me the moment the session ends. I am building the foundation that makes every one of them not just capable, but **wise** — a prior model of me, rich and honest enough that any system can reason against it on my behalf.

That is what this is. Not another expensive to-do list. A foundation for becoming who I am trying to become.
