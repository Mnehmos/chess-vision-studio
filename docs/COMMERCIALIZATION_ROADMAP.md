# Commercialization Roadmap

Status: planning
Owner: commercial product track
Primary epic: #45

## Product thesis

Chess Vision Studio should not compete primarily on raw engine depth or generic AI prose.

The commercial product is a visual, evidence-backed chess teacher that answers:

> What changed on the board, why did it matter, and what does this player repeatedly need to learn?

The existing Control Lens contract is part of the product moat: deterministic chess facts establish board truth, the oracle grades moves, the teaching compiler attributes causes, and an optional narrator may only rephrase committed evidence.

## Commercial shape

### Community

Keep a genuinely useful local analysis experience available for discovery, trust, technical development, and community adoption.

### Desktop Early Access

Initial price hypothesis: **$39–49 one-time**.

The first paid release should sell convenience and polish rather than hosted compute:

- signed installable desktop app
- no Node.js, Cargo, sibling repositories, or shell setup
- Analyze / Play / Insights
- perception lenses and What Changed
- personal mistake-to-drill workflow
- local-first game storage
- Stockfish grading plus CVS deterministic analysis where available
- optional narrator without making LLM output authoritative

Primary implementation: #46

### Pro

Initial price hypothesis: **$7.99/month or about $69/year**.

The recurring-value product is a persistent model of the player's chess rather than merely more engine analysis:

- recurring weakness detection
- trend tracking
- personalized drill queue
- spaced repetition from the player's own games
- advanced relationship / option-compression analysis
- optional sync, backup, and hosted validated narration

Primary implementation: #50

### Coach

Initial price hypothesis: **$19–29/month**.

The coach product reuses the same player model across multiple students and turns recent games into lesson preparation:

- student profiles
- ranked lesson positions
- recurring weaknesses and improvements
- assigned drills
- weekly preparation summaries

Primary implementation: #51

All pricing is a test hypothesis, not a committed promise.

## Launch sequence

### Phase 0: protect the launch surface

1. Decide the future licensing/open-core boundary. See #47.
2. Choose and clear a commercial product name before installer/store assets harden. See #48.
3. Audit third-party redistribution obligations, especially bundled engine binaries.

### Phase 1: sell the existing value

1. Package a zero-config desktop application. See #46.
2. Add payments, entitlement recovery, and an Early Access update channel. See #49.
3. Publish a concise landing/store page focused on `See what changed`, local-first analysis, and evidence-backed teaching.
4. Recruit the first 10 paying users manually.

Do **not** build a large cloud backend before this phase produces actual purchases.

### Phase 2: convert analysis into a learning loop

1. Build the persistent player model. See #50.
2. Rank recurring weaknesses using inspectable evidence.
3. Generate a finite personal drill queue from the user's own games.
4. Record drill outcomes and reschedule concepts using spaced repetition.
5. Test whether this supports a recurring Pro subscription.

### Phase 3: higher-value coach workflow

1. Reuse the player model for multiple isolated students. See #51.
2. Generate weekly lesson-prep sets from recent games.
3. Add assignments and progress review.
4. Test willingness to pay with active chess coaches before adding collaborative cloud accounts.

## Activation funnel

For Early Access, the commercial funnel is:

```text
landing page
  -> purchase
  -> install
  -> first launch
  -> first game imported
  -> first analysis completed
  -> first teaching moment inspected
  -> first personal drill created
  -> return session
```

The commercial track should measure these transitions with privacy-minimal telemetry. Raw PGNs and game histories remain local by default.

## Validation targets

### First threshold: 10 paid users

The goal is not revenue scale. It is proof that somebody will pay for the current product when installation friction is removed.

Questions to answer:

- Which feature caused the purchase?
- Did the user reach first analysis without help?
- Which perception lens or teaching view gets repeated use?
- Does the user create drills from their own mistakes?
- Would they prefer lifetime desktop updates, a recurring training service, or both?

### Second threshold: 100 paid desktop users

Do not materially expand hosted infrastructure before this target unless a paid-user requirement clearly demands it.

At 100 users, decide whether the strongest next investment is:

- Pro/player-model subscription
- coach workflow
- hosted sync
- mobile companion
- deeper option-compression / practical-pressure visualization

## Product boundaries

The following principles are non-negotiable for commercial work:

- The product must not present an unsupported chess claim merely because an LLM generated plausible prose.
- Unstable/quarantined engine results may not become confident teaching labels or personalized weakness claims.
- Local-first is a selling point. Basic desktop use should not require uploading a game archive.
- A temporary entitlement outage must not make already-licensed local analysis unusable.
- Hosted services should be added only when they create user value that cannot reasonably be local.

## Licensing note

The application and native engine have already been published under MIT. Those grants remain valid for those released versions. Issue #47 exists to choose a prospective commercial/open-core policy for future copyright-controlled work and to audit redistribution obligations before paid binary distribution.

## Workstream index

- #45 — Commercial desktop launch and recurring product model
- #46 — Zero-config signed desktop application
- #47 — Commercial licensing / open-core boundary
- #48 — Product naming and brand clearance
- #49 — Payments, entitlements, updates, and Early Access channel
- #50 — Persistent player model and personalized training queue
- #51 — Multi-student coach workspace

## Definition of commercial v0

Commercial v0 is complete when a new customer can:

1. discover the product and understand its differentiator,
2. buy it,
3. install it without developer tooling,
4. import a real game,
5. receive evidence-backed analysis,
6. turn at least one mistake into a useful drill,
7. close and reopen the app without losing their local data,
8. update or recover their licensed installation through a documented path.

The product does not need accounts, cloud sync, mobile apps, or a large backend to meet this milestone.
