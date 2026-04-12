# Deploy Instructions — ms-argus-web-integrity

Browser fingerprinting library (+ integrity test demo page). Build output is `argus-integrity.iife.js` / `argus-integrity.esm.min.js` served from the S3 + CloudFront stack at **https://static-integrity-dev-jw.argus.pw**. Consumed by:

- `ms-argus-games/src/hooks/useScan.ts` and `useIntegrityGuard.ts`
- Any other argus property embedding the integrity flow

## Prerequisites

- Node 22.x (verified). Rollup + TypeScript build.
- AWS credentials loaded — `aws sts get-caller-identity` should return account `263318538229`, region `us-east-1`
- No `.env` required for a basic deploy — CDK context is read from `cdk.context.json` and `bin/config.ts`. The stack pulls runtime secrets (SIGINT AES key, ECDH key pair) from SSM/Secrets Manager at Lambda bootstrap, not at deploy time.

## Deploy

```bash
npm run deploy
```

This expands to `npm run build:prod && npx cdk deploy`:

1. `build:prod` — cleans `dist/`, compiles the VM bytecode (`scripts/compile-vm.ts`), then runs Rollup with `BUILD=prod` (terser minification, obfuscation, source maps). Outputs to `dist/`.
2. `cdk deploy` — uploads `dist/` to the static CDN bucket and updates CloudFront.

## What gets deployed

Single CDK stack: `ms-argus-web-integrity-dev-jw` (or similar — confirm with `npx cdk list`). Contains:

- S3 bucket serving the library bundles + `test-integrity.html` demo page
- CloudFront distribution fronting the bucket with the `static-integrity-dev-jw.argus.pw` alias
- Any ancillary Lambdas for integrity collection (if present)

Typical timing: CDK deploys for this repo are notably **slow — about 15–17 minutes** — because the `dist/` directory is large (obfuscated JS + source maps). Don't interrupt mid-upload.

## Useful commands

```bash
npm run cdk:synth   # preview CloudFormation without deploying
npm run cdk:diff    # see what would change
npm run cdk:deploy  # build + deploy (same as npm run deploy)
```

## Smoke test after deploy

```bash
curl -s -I https://static-integrity-dev-jw.argus.pw/argus-integrity.iife.js
# expect HTTP/2 200 with content-type: application/javascript
```

Or load a consumer site (e.g. https://arcades.click/scan) and watch the Network tab for the script fetch.

## Pre-deploy hooks

lefthook (`.lefthook.yml` — confirm before relying on exact names):
- Pre-commit: format, lint
- Pre-push: test, duplication

If a push is rejected, fix the underlying issue rather than using `--no-verify`.

## Running the adversarial test bots (not a deploy)

The `e2e/adversarial/` directory contains Puppeteer-based evasion bots that exercise the full integrity pipeline from a controlled client. They don't deploy anything; they test *against* whatever is already deployed. Example:

```bash
# SOAX residential proxy (Dallas)
PROXY_PASSWORD=<soax_pass> npx playwright test \
  e2e/adversarial/proxy-evasion-dallas.spec.ts --project adversarial

# Direct (no proxy)
npx playwright test e2e/adversarial/evasion-direct.spec.ts --project adversarial

# Bright Data ISP (Dallas)
PROXY_PASSWORD_BD=<bd_pass> npx playwright test \
  e2e/adversarial/evasion-bd-isp-dallas.spec.ts --project adversarial

# Bright Data Mobile — gated by BD KYC, will fail with CORS-looking errors until KYC is completed
PROXY_PASSWORD_BD_MOBILE=<bd_mobile_pass> npx playwright test \
  e2e/adversarial/evasion-bd-mobile.spec.ts --project adversarial
```

Proxy credentials are stored at:
- `~/Dev/ms-argus-bots/.env` — SOAX
- `~/Dev/brightdata-isp-proxy.txt` — BD ISP
- `~/Dev/brightdata-mobile-proxy.txt` — BD Mobile

## Troubleshooting

**Deploy appears to hang** — expected during the dist upload phase (large assets, 15+ min). Tail CloudFormation events in AWS Console to confirm progress.

**Source maps showing in production** — they ship deliberately for now; remove from the Rollup config if that ever needs to change.

**CDK bootstrap errors** — run `npx cdk bootstrap aws://263318538229/us-east-1` once per account/region.

> ⚠️ I have not personally verified this deploy path in this session. Commands above are derived from `package.json` and the CLAUDE.md notes. If something breaks in practice, update this doc with what you actually ran.
