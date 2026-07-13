# dram — whisky / wine / coffee tasting log + recommender

A personal tasting log with a layered recommender, live at **dram.zackwithers.com**
*(once deployed)*. Log bottles and tasting notes from your phone; get ranked "bottles
like this" recommendations that get smarter as you add notes.

The cabinet covers whisky (scotch / bourbon / rye / Irish), agave (tequila / mezcal),
rum, gin, absinthe, brandy / cognac, and wine; a sibling **coffee tab** (`#/coffee`)
shares the same corpus, eight tasting axes, and recommender. Recommendations rank
within the target's family and also surface **"across the aisle"** picks — which
coffees echo a wine's profile, and vice versa.

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
