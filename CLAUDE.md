# Repo notes for ms-argus-web-integrity

Short operational notes that aren't in the README but matter when
working on this repo. Auto-loaded into the assistant's context every
session.

## Running e2e tests

**You MUST set `ARGUS_TEST_CPI` before any `npm run test:e2e` or
`npm run test:adversarial:*` invocation.** Without it the SDK
submits without the `x-argus-cpi` header and the API rejects with
HTTP 400.

```bash
export ARGUS_TEST_CPI=argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4
npm run test:e2e
```

Symptoms when missing:

- All `e2e/clean/loader.spec.ts` tests that drive a real submission
  fail with `argus: inner: http_400_error` (looks identical to an
  ECDH decrypt failure — don't chase that).
- `e2e/adversarial/*` similar.
- `destroy() rejects in-flight run` keeps passing because it never
  reaches the POST.

### Why

`ms-argus-api` commit `d683293` (2026-04-29) made `X-Argus-Cpi` a
hard requirement on `POST /v1/integrity-collect`. See auto-memory
`feedback_argus_unbound_cpi_removal.md` for the full backstory.

### Pick a CPI

Any unrevoked row in the `ms-argus-platform-dev-jw-merchant-keys`
DynamoDB table works. As of 2026-05-22 the newest test CPI is
`argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4` (created 2026-05-02). To
refresh the list / pick a different one:

```bash
aws dynamodb scan \
  --table-name ms-argus-platform-dev-jw-merchant-keys \
  --query 'Items[*].[cpi.S, createdAt.S, revokedAt.S]' \
  --output table
```

Only rows where `revokedAt` is `None` / `null` are usable.

### Persist it

Drop into your shell rc, an `.envrc` (direnv), or a git-ignored
`.env.local`. The repo intentionally has no committed `.env*` so
that test CPIs don't leak into Git.

## Build outputs

`npm run build:prod` produces the normal bundles plus a proxy-only pair in
`dist/`:

| Bundle                           | Role                                                             |
| -------------------------------- | ---------------------------------------------------------------- |
| `argus-loader.iife.js`           | thin loader exposed as `window.argus`; creates the srcdoc iframe |
| `argus-integrity-iframe.iife.js` | iframe-side host page that boots the VM                          |
| `argus-integrity.iife.js`        | the VM bytecode + bridge that runs inside the iframe             |
| `argus-proxy-loader.iife.js`     | same public loader API, pointed at the reduced proxy iframe      |
| `argus-proxy-iframe.iife.js`     | TLS/TCP/H2/WebRTC/client-id collection and encrypted submission  |

Loader is deterministic across builds; the other two contain
build-time-baked metadata so two consecutive builds produce
different SHA256s of those files even from identical source. Don't
chase a SHA divergence between two local builds — only the deployed
sha vs the build-that-deployed-it is meaningful.

## Deploy

`npm run deploy` runs `build:prod` then `cdk deploy` to the
personal dev stack `ms-argus-web-dev-jw`. Resulting bundles are
served from `https://static-integrity-dev-jw.argus.pw/`.

UAT / Prod go through the pipeline (`PipelineStack` in `bin/`),
which triggers off `main` via CodeStar / CodeBuild.

## Tests that hit real infra

- `e2e/clean/loader.spec.ts` posts to live `api.argus.pw` and reads
  DynamoDB directly. Needs `ARGUS_TEST_CPI` and AWS credentials in
  the runner's environment (default credential chain).
- `e2e/adversarial/*` same plus various proxy / network configs.
- Unit tests under `src/**/*.test.ts` are pure — no network or AWS.

If you're iterating on SDK code without touching the API contract,
`npx vitest run` is enough; defer e2e until you have a reason.

## Pre-commit + pre-push

`lefthook.yml` runs:

- pre-commit: prettier format + eslint --fix on staged TS files
- pre-push: coverage + duplication + cleanup line-count ratchets

Both are fast. If the pre-push fails on duplication, it's usually
copy-paste in newly added code — refactor or excerpt-tag the
intentional duplication.

## Where to find the hardening lore

If you're touching crypto, iframe lifting, or the bridge, read
[CASTLE-TO-ARGUS.md](../reading-list/CASTLE-TO-ARGUS.md) §3.
Specifically §3.11 (serialization-chokepoint MITM) and §3.14
(the audit that produced `src/utils/pristine-iframe.ts`).
