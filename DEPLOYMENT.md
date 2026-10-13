# Getting dram.zackwithers.com live: 0 → production checklist

All AWS resources are CDK-managed (cloned from `fit`, plus a real backend). Infra
deploys run locally with your credentials; CI only ships the web build. Until you run
`cdk deploy`, nothing exists in AWS. Until you enable Bedrock model access, the
recommender runs at **layer 1 (structured)** with `degraded:true` — the app is fully
functional without it.

## 1. One-time AWS setup

- [ ] Bootstrap the environment (only if it wasn't already for `fit`/interp — the same
      account/region is shared):
      ```sh
      npx cdk bootstrap aws://545628619410/us-east-1
      ```
- [ ] Deploy the stack from the repo root:
      ```sh
      npm run deploy -w infra
      ```
      This creates: the ACM cert (DNS-validated automatically against the
      `zackwithers.com` hosted zone), the private S3 bucket + CloudFront (OAC) +
      `dram` A/AAAA alias records, the Cognito user pool + web client, the DynamoDB
      table, the API Lambda, and the HTTP API with its Cognito JWT authorizer.
- [ ] Copy down the stack outputs — you need them in steps 2 and 4:
      - `ApiUrl` — the HTTP API base URL (e.g. `https://abc123.execute-api.us-east-1.amazonaws.com`)
      - `UserPoolId`, `WebClientId` — Cognito ids the web app signs in against
      - `BucketName`, `DistributionId` — for the web-deploy CI
      - `CiRoleArn` — the GitHub Actions deploy role
      - `TableName`, `Url` — informational

## 2. Enable Bedrock model access (one-time, unlocks layers 2 & 3)

The recommender degrades gracefully: with no Bedrock access it runs the structured
cosine layer and every response carries `degraded:true`. Turning on the text-embedding
and Haiku-narration layers is **two different tracks**, not one click — this asymmetry is
normal and expected:

- [ ] **Amazon → Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`) — used to
      embed each tasting note on write (512-dim vector, stored on the note item). Amazon
      first-party models are **enabled by default** in all commercial regions (given the
      AWS Marketplace permissions), so this typically shows as already granted with
      nothing to do. It embeds notes for layer 2 (the structured-cosine text layer).
- [ ] **Anthropic → Claude Haiku 4.5** — narration layer (layer 3). Invoked via the US
      cross-region **inference profile** `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
      Anthropic gates first-time access: before you can invoke, you must **accept
      Anthropic's EULA and submit a use-case form** (company/website — a GitHub or
      portfolio URL is fine — plus a use-case description). Open the **Amazon Bedrock
      console → Model access → Modify model access**, add the Anthropic model, and choose
      **Submit use case details**. This is a **one-time-per-account** gate (inherited by
      the whole AWS Organization, across all commercial regions), *not* per-model or
      per-region. Access is granted **immediately on successful submission** — no waiting
      period.
- [ ] The cross-region inference profile does **not** need access re-granted per routed
      region: the one account-level Anthropic agreement covers invocation through the
      profile in us-east-1 / us-east-2 / us-west-2. The Lambda's IAM already allows
      `InvokeModel` on the profile and its underlying foundation models in those regions.
      (Verified 2026-07-05: Titan embed and the Haiku US inference profile both invoke
      successfully from this account — layer 3 is live. No redeploy needed; the Lambda
      picks up access on the next call.)

**How degradation behaves after this:**
- Notes written *before* Titan was enabled have no embedding and are excluded from the
  text layer until re-embedded (write a fresh note, or re-save). New notes embed
  synchronously on write.
- `GET /bottles/{id}/recommendations` returns `basis:"narrated"` once Haiku is
  reachable, `basis:"text"` if only Titan is on, `basis:"structured"` at the floor.
  `degraded:true` means it fell back below the layer it tried to use because Bedrock
  was unavailable.

## 3. GitHub repo (web CI)

- [ ] Repo: `legendaryzoac/dram` (public — portfolio piece).
- [ ] Repo settings → **Secrets and variables → Actions**:
  - Variable `S3_BUCKET` — stack output `BucketName`
  - Variable `CLOUDFRONT_DISTRIBUTION_ID` — stack output `DistributionId`
  - Variable `VITE_API_BASE_URL` — stack output `ApiUrl`
  - Variable `VITE_COGNITO_USER_POOL_ID` — stack output `UserPoolId`
  - Variable `VITE_COGNITO_CLIENT_ID` — stack output `WebClientId`
  - Secret `AWS_ROLE_ARN` — stack output `CiRoleArn`

  (The workflow also hardcodes `VITE_USE_MOCK=false` so the production build talks to the
  real API instead of the in-browser mock — no repo variable needed for it.)

The last three feed the web build so the browser app knows where the API is and which
Cognito pool to authenticate against (see "How the web workspace consumes these"
below).

## 4. AWS: OIDC role for GitHub Actions (no long-lived keys)

- [ ] The `token.actions.githubusercontent.com` identity provider already exists in the
      account (from the adversarial-playground / fit setup) and is reused.
- [ ] The deploy role is **CDK-managed** (`GithubDeployRole` → role name
      `dram-github-deploy` in `infra/lib/site-stack.ts`): trusted only for
      `repo:legendaryzoac/dram:ref:refs/heads/main`, with S3 put/delete/list on the
      site bucket and `cloudfront:CreateInvalidation` on the distribution. Nothing to do
      by hand.

## 5. GitHub Actions workflow (web deploy)

`.github/workflows/deploy.yml` is present (mirrors `fit`/`interp`): on push to `main`,
`npm ci` → `npm run build -w web` with the `VITE_*` repo variables and `VITE_USE_MOCK=false`
exported into the build env, then `aws s3 sync web/dist …` and a CloudFront invalidation,
authenticating via the `AWS_ROLE_ARN` OIDC role.

- **Web changes**: push to `main` → Actions builds `web/` and syncs to S3 + invalidates.
- **Infra changes** (this workspace or `api/`): `npm run deploy -w infra` locally
  (`npm run -w infra diff` first to preview). Lambda code changes ship with the infra
  deploy — the API is bundled from `api/src/handler.ts` by CDK/esbuild.

### Contract changes: deploy the API first, then push the web

The two pipelines are independent, so a push to `main` ships the new web against
whatever Lambda is currently deployed. For changes that grow the wire contract (like
the 8-axis flavor expansion + coffee/`style`/`roast`/`process` fields), do it in this
order:

1. `npm run deploy -w infra` — the new Lambda accepts both old and new payloads
   (5-axis notes from stale PWA clients are still valid; new axes are optional).
2. Then push to `main` to ship the web.

Reversed, the window is read-safe but **write-lossy**: the old Lambda whitelists
request fields, so a coffee's `roast`/`process`, a spirit's `style`, and the three new
flavor axes on notes are silently dropped at write time (HTTP 200, value never stored,
unrecoverable after redeploy). The new web tolerates old-API *reads* (missing
`crossFamily`, 5-axis profiles) by design.

**New routes** follow the same order. `POST /pairings` (the pairing tab's narrated
layer) needs `npm run deploy -w infra` to exist: it adds the HTTP API route (behind the
JWT authorizer) and ships the Lambda that calls Haiku. Until then the web's pairing tab
still works fully on its client-side layer — the API returns 404 for the route, the
page shows "the narrated take isn't available right now", and the structured picks
stand. Pairing narration reuses the Haiku inference profile already granted in step 2,
so there is nothing new to enable in Bedrock.

`GET /notes` (every tasting note at once, for the hub) is the same: until the deploy the
web falls back to one read per bottle, a few at a time.

**New bottle fields** go API-first too. The bottle `status` (cabinet / finished /
tasted) is additive — every GET fills `cabinet` in for rows written before it existed —
but a Lambda built before the field would silently drop it on write, so the web that
sends it merges only after `npm run deploy -w infra` has shipped the API that keeps it.

## Inviting a user (you + a few friends)

No public sign-up. Create accounts by hand, substituting the deployed pool id:

```sh
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId from stack output> \
  --username friend@example.com \
  --user-attributes Name=email,Value=friend@example.com Name=email_verified,Value=true
```

Cognito emails a temporary password (built-in mailer, 50 emails/day cap). On first
sign-in the app walks them through choosing a real password (12+ characters). To revoke:
`aws cognito-idp admin-disable-user` with the same `--user-pool-id`/`--username`.

## How the web workspace consumes the API URL + Cognito ids

The frontend is a static SPA on CloudFront, so it needs these values baked in at build
time. They are **not secrets** (a Cognito app client id and a public API URL are safe to
ship in client JS; writes are still gated by a valid JWT). The web build reads them from
Vite env vars, wired from the repo variables in step 3:

| Vite env var                  | Stack output   | Purpose                                  |
|-------------------------------|----------------|------------------------------------------|
| `VITE_API_BASE_URL`           | `ApiUrl`       | base URL for `fetch` calls to the API    |
| `VITE_COGNITO_USER_POOL_ID`   | `UserPoolId`   | Cognito pool for sign-in                 |
| `VITE_COGNITO_CLIENT_ID`      | `WebClientId`  | Cognito app client (SRP auth)            |
| `VITE_USE_MOCK` (=`false`)    | —              | hardcoded in the workflow; use real API  |

For local web dev, put the same three in `web/.env.local` pointing at either the
deployed API or a local stub. Authenticated requests send the Cognito **access token**
as `Authorization: Bearer <token>`; the HTTP API's JWT authorizer validates it against
the pool/client before the Lambda runs. Public GET routes need no token. CORS on the API
allows `https://dram.zackwithers.com` plus `localhost:5173`/`:4173`.

## Data model note

Single DynamoDB table, on-demand billing. A bottle is `PK=BOTTLE#<id>, SK=META`; each of
its tasting notes is `PK=BOTTLE#<id>, SK=NOTE#<createdAt>#<id>`, so one Query by PK
returns a bottle and all its notes. `GET /bottles` is a filtered Scan (fine at personal
scale — dozens to low hundreds of bottles); no GSI is defined. Titan embeddings are
stored on the note item (a few KB, well under DynamoDB's 400KB limit) and are never
returned on the wire.
