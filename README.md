# dram — whisky / wine / coffee tasting log, recommender + pairing

A personal tasting log with a layered recommender, live at **dram.zackwithers.com**
*(once deployed)*. Log bottles and tasting notes from your phone; get ranked "bottles
like this" recommendations that get smarter as you add notes; and ask what to drink
with the steak, or with the cigar you're about to light.

The cabinet's type list is grouped the way a shelf is — whisky (scotch / Irish /
bourbon / rye / Tennessee / American / Japanese / Canadian / world), agave (tequila /
mezcal), cane (rum / cachaça), brandy (cognac / armagnac / calvados / pisco / brandy),
botanical & grain (gin / vodka / absinthe), liqueur & aperitif (liqueur / amaro /
vermouth), wine (red / white / rosé / sparkling / fortified / dessert), plus `other`
for anything else, described by its style field. Types are free-form on the wire; the
list lives in one table (`web/src/lib/types.ts` → `TYPE_GROUPS`) that drives the form
and the pairing engine. A sibling **coffee tab** (`#/coffee`) shares the same corpus,
eight tasting axes, and recommender. Recommendations rank within the target's family
and also surface **"across the aisle"** picks — which coffees echo a wine's profile,
and vice versa.

Every bottle carries a **status**: `cabinet` (on the shelf — the default, and what
anything logged before the field existed reads as), `finished` (drunk and gone, notes
kept), or `tasted` (tried at a bar or a friend's, never owned). The cabinet and coffee
pages open on the shelf, with a status filter beside the notes filter. Pairing's "what
to pour" and the hub's tonight's picks pour only from the shelf; "bottles like this",
the menu tips, and your palate draw on everything you've logged.

## Pairing (`#/pair`)

Its own section beside the cabinet and the coffee bar. Say what you're having — a dish
("ribeye", "oysters", "spicy green curry") or a cigar (brand and line optional; strength
and wrapper inferred from a table of ~80 marques, or set by hand) — and dram answers
two questions: **what to order** off a menu, and **what to pour** from your cabinet.

1. **Structured, instant, offline** (`web/src/lib/pairing.ts`) — the occasion resolves
   to a target profile on the eight shared axes plus per-type affinities; the cabinet
   is ranked by flavor similarity (45%), type affinity (40%), and your own ratings
   (15%). Menu tips are anchored to bottles you love ("you rated Caymus 8/10").
2. **Narrated** (`POST /pairings` → Claude Haiku) — reasons over the occasion and your
   *whole* cabinet, so it can confirm the shortlist or reach for a bottle the math
   missed. It runs **only when you submit a pairing** (never on load or while typing),
   needs a signed-in session, and fails soft to layer 1.

Sibling to [interp](https://interp.zackwithers.com) and the
[adversarial playground](https://playground.zackwithers.com) — same S3 + CloudFront +
CDK + GitHub-Actions-OIDC deploy pattern as [fit](https://fit.zackwithers.com), plus a
serverless backend.

## Architecture

| Layer | Tech |
|---|---|
| Frontend | React + Vite + Tailwind + D3 (radar charts), PWA — logs from a phone |
| API | API Gateway (HTTP API) + Lambda, Cognito-authed writes / public reads |
| Storage | DynamoDB single-table (bottles + tasting notes) |
| Embeddings | Bedrock Titan Text Embeddings v2 (on note write) |
| Recommender | (1) structured cosine · (2) note-text embedding cosine · (3) Claude Haiku narration |
| Pairing | client-side knowledge base + cosine ranking · Claude Haiku narration on request (`POST /pairings`, authed) |
| Infra | CDK (S3 + CloudFront + Cognito + DynamoDB + Lambda + API GW), cloned from `fit` |

## Recommender layers (ship in order)

1. **Structured** — feature-vector each bottle (region, type, 8 flavor axes, ABV) →
   cosine against your highly-rated bottles. Always works, no Bedrock needed.
2. **Note-text** — Titan embeddings of the free-text nose/palate/finish → similarity on
   what a bottle actually tastes like, not just its metadata. Being metadata-blind,
   this is also the layer that bridges coffee ↔ alcohol best.
3. **Narrated** — Claude Haiku reasons over tasting history and explains 2–3 next picks.

## Workspaces

- `web/` — frontend (deploys to S3 + CloudFront)
- `api/` — Lambda handlers + recommender logic
- `infra/` — CDK app

See `DEPLOYMENT.md` (created with `infra/`) for the 0→live runbook, including the
one-time Bedrock model-access enablement.
