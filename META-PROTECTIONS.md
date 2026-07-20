# Meta-Protections — the Kerckhoffs posture for Argus

Date: 2026-06-08 (merged from two independent audits of the same corpus)

> **Goal:** get to PGP-grade openness — publish the whole client and have it not
> matter — by moving every load-bearing trust decision onto a boundary the
> attacker cannot cross even with full source.
>
> Scope read: `~/Dev/ms-argus-attack-bots` (AI-generated red-team corpus,
> May–Jun 2026), `ms-argus-web-integrity`, `ms-argus-api`, `ms-argus-signal-lab`.
> The job is NOT to patch one more API surface — it's to identify protections
> that still work when the SDK, protocol, and attacker playbook are all public.

## Current plan (fix list, most → least important)

Snapshot 2026-06-08. Each item links to the detailed section below.

| #   | Fix                                                        | Why (short)                                                                                                                                                                                                                                                                                                | Repos                                                          |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | ✅ DONE 2026-07-20 — Close the `device.mac` absence window | Was: ingestion accepted a no-MAC payload (HTTP 200, `identification.verified=true`). Now: `absent`→HTTP 400 `device_mac_required` + legacy 22-slice removed (`worker_attest` mandatory). `direct-wire-mac-absence-regression` flips to `fixedAtBoundary`; clean SDK still 200.                             | `ms-argus-api`                                                 |
| 2   | `Verified<T>` fail-closed type boundary                    | Four bots are the same fail-open bug — server keeps attacker data after flagging it, a downstream read trusts it. A type wrapper makes the class impossible to reintroduce.                                                                                                                                | `ms-argus-api`                                                 |
| 3   | ✅ DONE 2026-06-08 — Remove iframe downgrade fallback      | SDK deleted the in-iframe `runArgusVm()` fallback (`index-iframe.ts`); Worker-block → no submission. `worker-downgrade-fallback-regression` flips to `fixedAtBoundary` (deployed dev-jw + e2e).                                                                                                            | `ms-argus-web-integrity`                                       |
| 4   | Hardware-root gate on high-value verdicts                  | Self-minted `device_identity` isn't proof of a real device. High-value decisions should require a WebAuthn/PAT assertion whose key never enters JS.                                                                                                                                                        | `ms-argus-api` + `ms-argus-pair` / `ms-argus-bio`              |
| 5   | Regression matrix + compat-fallback governance             | Prevents reintroduction — every signal tested across missing/tampered/stale/replayed, never "clean" on failure. Every legacy fallback needs an owner and removal date.                                                                                                                                     | `ms-argus-api` (+ adversarial e2e in `ms-argus-web-integrity`) |
| 6   | Worker capability sole-holder                              | Even on the happy worker path, keying material that seals a valid submission can be observed/derived from the page realm, so the cleartext-MITM class isn't fully retired. Only the worker should hold that capability.                                                                                    | `ms-argus-web-integrity` + `ms-argus-api`                      |
| 7   | Cross-realm toString gap                                   | RNG/UUID native-source snapshots are captured with iframe-realm `Function.prototype.toString`, but `status/index.ts` compares them with top-level `Function.prototype.toString.call(...)` — the exact primitive the WeakMap-toString attack replaces. Compare with an iframe-realm toString reference too. | `ms-argus-web-integrity`                                       |
| 8   | Generalize single-use (MP-4)                               | STUN and pair replay are closed, but other attestation types lack a single-use ledger. Hardening against future replay variants, not an open hole today.                                                                                                                                                   | `ms-argus-api`                                                 |

Detail: #1 → Gap 1 · #2 → MP-3 / Invariant 3 · #3 → Gap 2b · #4 → Gap 3 / MP-5 ·
#5 → Priority plan + Gap 2 · #6 → MP-1 · #7 → see
`project_argus_crossrealm_tostring_gap` · #8 → MP-4.

## Executive take

The bots are not winning by better navigator spoofing. They win whenever Argus
treats a **client-controlled, missing, stale, or tampered** artifact as
authoritative evidence. Their evolution is consistent:

1. Rebuild the wire protocol directly in Node.
2. Submit plausible-but-synthetic evidence.
3. Hunt for truthiness gates, omission paths, and rollout-compatibility skips.
4. If wire forgery is blocked, move earlier and patch the JS realm before the
   SDK captures supposedly-pristine references.
5. If mutation is blocked, drive honest Chrome and make the rest pure detection
   quality.

Durable defenses are therefore **server-verifiable provenance, completeness,
freshness, single-use, and fail-closed scoring** — not "detect every patched API."

## The fundamental ceiling (why "harden every API" never converges)

PGP/AES/TLS survive being open because the secret is a **key**, and the verifier
and the adversary sit on **opposite sides of a boundary the adversary can't
cross** (the private key; the server endpoint).

Client-side bot detection breaks that one assumption: **the adversary owns the
execution environment of the verifier.** No engineering makes a computation
trustworthy when it runs entirely inside the attacker's VM. Therefore:

> **Any signal whose computation AND trust both live in the client JS realm is
> evidence, never proof. With source disclosed it becomes a checklist the
> attacker emits exactly.** (The "prototype.map beat me with source" round was
> the empirical proof.)

The corollary that makes open-source viable:

> **Open-source anything whose security rests on a secret or root the attacker
> can't reach with full source. Move ALL trust onto those.**

Three such boundaries: **(1) server-side secret + server-side verdict, (2) a
hardware root (WebAuthn/passkey/PAT), (3) server-issued single-use freshness.**

Caveat the OAI audit calibrated better than the first draft: client-side
_signals_ are not uniformly dead on disclosure. A signal survives publication
when its **defeat is expensive to coordinate** (worker/SW lifecycle, target-attach
residue, cross-realm clock agreement), not when its existence is secret. The
filter for signal-lab promotion: **reject any probe whose defeat is a one-line
monkeypatch; keep the controller-side-effect signals.**

## The attack meta-classes

### Class A — "the client is optional" (wire-level), with three sub-primitives

`inline-probe-bypass`, `worker-scope-oracle-omission`, `direct-wire-h2-only`,
`direct-wire-mac-absence-regression`, `device-identity-mint-and-replay`,
`aws-cf-data-forgery`, `stun-replay`, `pair-projection-bypass`,
`pair-webauthn-bypass`, `pair-session-recycling`.

These don't run a browser. They reconstruct the wire protocol in Node
(ECDH + HKDF-SHA256 + AES-256-GCM + fibScramble — every parameter derivable from
source) and POST hand-authored payloads. **Encryption defeats nothing: they hold
both keys; they ARE the client.** The three distinct primitives:

- **Forgery** — author a field the server reads as trusted (aws_cf tamper-ignored).
- **Omission** — withhold an oracle the analyzer only checks when present
  (worker-scope ≥2 guard; **missing `device.mac`**). _Absence treated as clean._
- **Replay** — reuse a captured-once artifact across sessions (STUN, pair IDs,
  device-identity sig).

### Class B — in-browser MITM at the chokepoint

`cleartext-mitm-v1`. ONE hook on `SubtleCrypto.prototype.encrypt` reads cleartext
at the serialization chokepoint, defeating the whole encryption layer at once.
Wins because **(1)** Playwright `addInitScript` (CDP
`Page.addScriptToEvaluateOnNewDocument`) runs in _every_ document realm
**including the doubly-nested pristine iframes** — lifting `w2.crypto.subtle`
doesn't help because the method still resolves through the patched prototype —
and **(2)** source visibility handed it the exact pipeline.

### Class C — attacker-induced downgrade to the poisoned iframe path

Before the 2026-06-08 closure, the SDK normally ran the JSVM and submission
bridge inside a dedicated Worker but fell back to `runArgusVm()` in the iframe
after Worker creation, fetch, or startup failure. That fallback is deleted; this
class remains documented as a regression model.

The fix is policy, not more iframe hardening: for current SDK generations,
Worker failure must not fall through to a clean iframe-side submission. It
should either produce no submission, or submit a clearly degraded diagnostic row
that merchant projection cannot score clean.

## Current strong protections (keep and generalize)

Grounded in deployed `ms-argus-api` code:

- **Server-authoritative hydration.** `tcp_probe`/`h2` are deleted from client
  payloads and rehydrated only after token redemption; redemption throw → 503,
  not fallback to attacker data. Verification failure _removes authority_.
- **Authenticated CF gate.** `isAwsCfAuthenticallyHydrated()` counts `aws_cf`
  only when `tampered === false && expired === false` — closes the old
  `!!sigint.aws_cf` truthiness gate.
- **Device MAC chain.** `device.mac` verifies structured device slices against
  session-bound material; **mismatch → HTTP 400 `device_mac_mismatch`**
  (`base-handler.ts:973-994`). Correct answer to in-flight cleartext substitution.
- **Worker self-attestation.** Worker injects `device.worker_attest` (slice 0x66)
  before the MAC, anchoring page-supplied navigator claims against a realm the
  page script can't trivially pre-patch.
- **Projection-level structural tampering.** Merchant projection scores worker
  divergence, engine hard-breaks, CF tamper/replay, kernel mismatch, WebRTC API
  tamper, device-history auth-tag failure as high-severity. (The merchant
  projection — not `identification.verified` — is the success criterion.)

## The five meta-protections

### MP-1 — The worker is the _sole_ holder of submission capability

`addInitScript` reaches every iframe realm but **cannot reach worker scope**.
Don't merely run crypto in the worker — give it a server-issued session
capability and let **only** the worker MAC/seal the payload. A page-realm
prototype hook then sees ciphertext only. Collapses "harden every crypto method"
into "protect one boundary the hook can't reach."
Status: worker isolation shipped 2026-05-26 (`worker_attest`). **Capability-
sole-holder step is the next increment** — and current SDKs must not silently
downgrade to iframe-side `runArgusVm()` when the worker path fails.

### MP-2 — One HMAC chain over the whole structured payload

The client MACs the entire payload with server-anchored material; the server
replays it. _Any_ Class-A field forgery fails in one check.
Catch: cleartext-mitm hooked `deriveKey`, so the MAC key must originate where the
page hook can't extract it → MP-1's worker capability. **MP-1 + MP-2 compose;
neither alone suffices.**
Status: current-only `device.mac` enforcement shipped 2026-07-20; missing MAC,
missing worker attestation, and the retired 22-slice order fail closed.

### MP-3 — Fail CLOSED server-side, enforced by types

`inline-probe-bypass`, `aws-cf-forgery`, `worker-scope-omission`,
`pair-projection-bypass` are **the same bug**: server kept attacker data after
its own check flagged it, and a downstream read accepted it. Don't patch each
gate. Make the field **inaccessible without unwrapping a `Verified<T>` only the
verifier can construct** — new code then physically can't reintroduce the class.
Status: individual gates closed; **type-level invariant not yet built — the
durable fix.** (See Invariant 3.)

### MP-4 — Bind every artifact to a server nonce + single-use

Replay bots reuse a captured-once artifact. One mechanism (server nonce +
single-use ledger/LRU) kills all replay variants.
Status: STUN single-use shipped 2026-05-25; pair device-trust IP-pinned.
**Generalize single-use to every attestation type.**

### MP-5 — Client transports attested evidence; the server decides

The deepest shift and the one that _enables_ the open-source goal. As long as the
client computes anything the server trusts, disclosure lets the attacker compute
it too. The client only **gathers** and **attests provenance** ("from a real
worker, signed by a hardware key, sealed with a server capability"). The server
does ALL scoring. Then the client holds no secret and makes no decision —
publish it whole.

## Bot → meta-protection → status

| Bot                                           | Class / primitive             | Retired by                                                     | Status                                                                                                                                                                                           |
| --------------------------------------------- | ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cleartext-mitm-v1 (READ)                      | B                             | MP-1 worker isolation                                          | CLOSED 2026-05-26                                                                                                                                                                                |
| cleartext-mitm-v1 (SUBSTITUTE)                | B                             | MP-2 HMAC chain                                                | CLOSED 2026-05-26                                                                                                                                                                                |
| inline-probe-bypass                           | A/forgery                     | MP-3 fail-closed flags                                         | CLOSED (sweep #4)                                                                                                                                                                                |
| aws-cf-data-forgery                           | A/forgery                     | MP-3 (`isAwsCfAuthenticallyHydrated`)                          | CLOSED                                                                                                                                                                                           |
| worker-scope-oracle-omission                  | A/omission                    | MP-3 (`WORKER_ORACLE_MAIN_ONLY`)                               | PARTIAL — soft tier-50 only                                                                                                                                                                      |
| pair-projection-bypass                        | A/forgery                     | MP-3 fail-closed lookup                                        | CLOSED 2026-05-26                                                                                                                                                                                |
| pair-webauthn-bypass                          | A/forgery                     | proof-of-life gate + projection fail-closed                    | CLOSED as cheap pair bypass; `fmt:'none'` remains accepted                                                                                                                                       |
| stun-replay                                   | A/replay                      | MP-4 single-use                                                | CLOSED 2026-05-25                                                                                                                                                                                |
| pair-session-recycling                        | A/replay                      | MP-4                                                           | CLOSED 2026-05-26                                                                                                                                                                                |
| device-identity-mint-and-replay (retired XOR) | A/replay                      | MP-4 payload-bound sig                                         | CLOSED — current-only contract                                                                                                                                                                   |
| **direct-wire-mac-absence-regression**        | **A/omission**                | **MP-2 enforcement (`absent`→400, `worker_attest` mandatory)** | **CLOSED 2026-07-20 — API rejects no-MAC at ingestion (HTTP 400 `device_mac_required`); bot `--expect fixed` passes, `fixedAtBoundary: true`. Clean current-SDK run still 200 (no regression).** |
| **worker-downgrade-fallback-regression**      | **C/downgrade + iframe MITM** | **MP-1 (no clean iframe fallback)**                            | **CLOSED 2026-06-08 — SDK deleted the iframe `runArgusVm()` fallback; Worker blocked → no submission, no plaintext. Bot `--expect fixed` passes, `fixedAtBoundary: true`.**                      |

## Highest-risk remaining gaps

> **✅ STATUS 2026-07-20: Gaps 1 + 2 + 2b CLOSED (clean break shipped).** SDK
> deleted the iframe `runArgusVm()` fallback (deployed dev-jw + e2e). API made
> `absent`→HTTP 400 `device_mac_required` and removed the legacy 22-slice
> fallback so `worker_attest` is mandatory (deployed dev-jw). Both regression
> bots flip to `fixedAtBoundary`; clean current-SDK run still 200. The detail
> below is retained as the rationale/record.
>
> **Gaps 1, 2, and 2b are one root cause: the legacy / no-`worker_attest`
> compatibility window.** No-MAC (Gap 1), legacy slice order without
> `worker_attest` (Gap 2), and worker→iframe downgrade (Gap 2b) all resolve to
> "ingestion accepts a submission that lacks an authentic `worker_attest`-bearing
> MAC." They collapse into **one rule, shippable as a clean break**:
>
> > Every submission must carry a valid `device.mac` that includes `worker_attest`;
> > anything lacking it cannot score clean.
>
> **Not in production yet → no migration constraint.** There are no real users on
> cached old bundles, so there is no need for a legacy exemption, a version gate,
> or a cutover date. Just **delete** the legacy 22-slice fallback
> (`device-mac.ts:241-247`), **delete** the iframe `runArgusVm()` fallback, and
> make `absent`/no-`worker_attest` a hard reject — in one coordinated change.
>
> (Historical design note: a _version_-gated policy exemption would have been
> spoofable because `x-argus-v` is client-controlled. As of 2026-07-20 the API
> accepts only the current v3 transport and rejects missing, v1, v2, and unknown
> values; the header selects no policy exemption and no legacy decoder remains.)
>
> One real wrinkle even in dev: **deploy ordering across the two repos.** Ship the
> SDK (always emits `worker_attest`, no iframe fallback) at/before the API tighten,
> or you reject your own current clients in the gap. Trivial with no real traffic —
> just do SDK-then-API (or accept a brief self-break).

### Gap 1 (CLOSED) — historical `device.mac` absence window

**Historical evidence from 2026-06-08.** The rest of this subsection describes
the pre-fix behavior in historical present tense. `verifyDeviceMac()`
(`src/helpers/device-mac.ts:220-250`) returns `{kind:"absent"}` when `device.mac`
is missing. `enforceDeviceMac()` (`base-handler.ts:973-994`) hard-rejects
`mismatch` (HTTP 400) but on `absent` only emits a `DeviceMacAbsent` metric and
**continues** — payload proceeds to scoring. The `x-argus-v` header
(`middleware.ts:52-74`) gates decryption only; **nothing gates MAC enforcement by
SDK version.** The legacy 22-slice fallback (`device-mac.ts:241-247`) also accepts
payloads _without_ `worker_attest`.

`direct-wire-mac-absence-regression` now verifies the threat live: no browser,
one authentic H2 token plus inert TCP/TLS placeholders to pass the probe-presence
middleware, synthetic device payload, payload-bound `device_identity`, and
**intentionally no `device.mac`**. On 2026-06-08 against `dev-jw` it returned
HTTP 200, wrote a row, and recorded `identification.verified=true` while
`device.mac` and `device.worker_attest` were both absent. Merchant projection
blocked the row (`device_tampering=100`, `verdict=block`), which is good, but it
does not close the lower boundary: ingestion still accepts the no-MAC
current-client shape. **A bot doesn't forge the MAC — it declines to send one.**

**Footgun:** the same run set `identification.verified=true` on a fully synthetic,
no-MAC payload. `identification.verified` is an identity-_resolution_ flag, NOT a
trust verdict — but any consumer (merchant integration, dashboard, downstream
service) that reads it as "this device is trustworthy" inherits the bypass.
Document it as not-a-trust-signal and audit consumers.

Resolution: `absent` is now a hard reject, `worker_attest` is mandatory, and the
legacy 22-slice fallback is deleted. The direct-wire regression must reach this
boundary and receive HTTP 400.

### Gap 2 (CLOSED) — compatibility fallbacks become bypass classes

The MAC verifier previously accepted the legacy slice order without
`worker_attest`. That branch is deleted; the negative regression remains because
"support old clients" must not silently return as "bots choose the old protocol."

### Gap 2b (CLOSED) — Worker failure downgrade into a poisoned iframe VM

The iframe launcher previously had a fallback: if `runViaWorker()` failed, it called
`runArgusVm()` in the iframe so the scan can continue. That was useful during
worker migration, but it is now a downgrade oracle. An attacker can force Worker
failure and regain the old chokepoint-MITM surface where Playwright
`addInitScript` has poisoned every iframe realm before `getPristineRefs()` lifts
its APIs.

`worker-downgrade-fallback-regression` now verifies this live against the
deployed dev SDK: a Playwright init-script blocks `new Worker(...)`, the SDK
falls back to iframe-side `runArgusVm()`, `/v1/integrity-collect` still returns
HTTP 200, the row is persisted without `device.worker_attest`, and the same
init-script reconstructs the pre-encryption payload by hooking document-realm
`SubtleCrypto.encrypt`. Merchant projection blocks the row as automation /
browser tampering, but the SDK boundary still downgraded into a normal
submission instead of hard-failing.

Policy for current SDKs:

- Worker succeeds + `device.mac` includes `worker_attest` → normal path.
- Worker unavailable / blocked / fetch failed / timed out → no clean verdict.
- Optional diagnostic submission must carry an explicit degraded/fallback flag
  and merchant projection must treat it as tampered/unknown, not clean.
- Delete the iframe `runArgusVm()` clean fallback outright — no production users,
  so no legacy path is needed (see the consolidated rule at the top of section).

Do not let attacker-induced fallback produce a normal clean-scored row.
Caveat the "no submission" branch: if Worker-failure yields _nothing_, an attacker
can force the failure to suppress the scan — safe only if the merchant treats a
missing Argus result as not-clean (Invariant 2).

### Gap 3 — valid self-signed identity is not a hardware root

The current `device_identity` contract is payload-bound (good for continuity), but a Node script
still mints its own P-256 key and signs synthetic evidence. For high-value
decisions the stronger roots are WebAuthn/passkey, PAT on Apple surfaces, or
server-issued source-bound single-use probe tokens. The self-minted key is one
evidence channel, **not the trust anchor.**

### Gap 4 — signal quality is the final load-bearing layer

Once mutation and replay are blocked, the bot drives honest Chrome and asks "what
catches me if I don't lie?" That's signal-lab's job — and only the
controller-side-effect signals survive disclosure (SW lifecycle, target-attach
residue, worker/module timing, cross-realm clock agreement, input/focus shape).

## Recommended invariants

1. **No authoritative field without provenance.** Every load-bearing field has a
   provenance state: `server_verified` / `client_reported` /
   `present_but_failed_verification` / `absent_expected` / `absent_legacy`. Only
   `server_verified` feeds clean verdicts. Failed verification and _expected_
   absence feed tampering/uncertainty. `client_reported` is never promoted to
   proof by a truthiness check. (Note: `absent_expected` ≠ `absent_legacy` is
   what powers the Gap-1 reasoning — model absence as first-class, not a binary.)
2. **Missing current-SDK evidence is not clean.** If the current SDK should emit a
   field, absence needs an explicit reason — especially for hard-to-forge fields:
   workers, MACs, server-issued cache, STUN sigint, worker-attest.
3. **Tampered objects cannot expose trusted accessors.** Server-side
   `Verified<T>` / `Rejected` boundary:
   ```ts
   type Verified<T> = { ok: true; value: T; source: 'server_verified' };
   type Rejected = {
     ok: false;
     reason: string;
     tampered?: boolean;
     expired?: boolean;
   };
   type VerificationResult<T> = Verified<T> | Rejected;
   ```
   Analyzers receive `Verified<AwsCf>`, never a raw object with `tampered` buried
   inside. Makes the `!!sigint.aws_cf` class structurally hard to reintroduce.
4. **Freshness + single-use are part of verification.** "Signature valid" is
   insufficient: also check network/session binding, freshness window, and a
   single-use/replay ledger where practical. (This is what made pair-recycling
   and STUN-replay stop being cheap.)
5. **The client transports evidence; the server decides.** The SDK can be open
   source iff it holds no durable secret and makes no final trust decision.

## Priority plan

- **✅ COMPLETE 2026-07-20 — Close the legacy MAC/`worker_attest` window (Gaps
  1 + 2 + 2b, one clean break).** Server requires an authentic
  `worker_attest`-bearing `device.mac` to score clean; **delete** the legacy
  22-slice fallback; `absent` → hard reject. SDK: **delete** the iframe
  `runArgusVm()` clean fallback (Worker-failure emits an error or a degraded row
  that can't score clean). No version gate, no cutover date. Deploy ordering:
  SDK-then-API (or accept a brief self-break) so current clients aren't rejected in
  the gap. Closes `direct-wire-mac-absence-regression` and
  `worker-downgrade-fallback-regression` in one coordinated change.
- **P0 — Audit `identification.verified` consumers.** It is true on synthetic
  no-MAC input; ensure nothing downstream treats it as a trust verdict.
- **P0 — Regression tests for absence + failed verification.** For every
  load-bearing signal test {valid current SDK / missing-current / legacy-missing /
  tampered / stale / replayed}. Expected outcome is **never "clean"** for failed
  verification.
- **P1 — Typed provenance wrappers (Invariant 3 / MP-3).** Move from raw nested
  objects+flags to explicit `VerificationResult<T>`. Start with `aws_cf`, then
  STUN/WebRTC sigint, PAT, device-history cache, device identity.
- **P1 — Worker capability sole-holder (MP-1).** Page requests a scan; it must not
  derive or handle the keying material that makes a submission authoritative.
- **P1 — Keep signal-lab aimed at controller side-effects (Gap 4).** Don't promote
  one-line-monkeypatch probes.
- **P2 — Hardware-root gate (Gap 3 / MP-5)** on high-value verdicts.
- **P2 — Generalize single-use (MP-4)** beyond STUN to every attestation type.

## Open-source posture

Open-sourcing the SDK is realistic only if the public client is not the trust
anchor.

**Safe to publish:** protocol shape, SDK collection logic, worker-isolation
strategy, MAC construction, server verification rules at a high level, the threat
model and known failure modes.

**Keep server-owned and rotatable:** scoring weights, active signal thresholds,
deployment rollout gates, abuse heuristics, merchant-specific policy.

This is boundary placement, not obscurity. In crypto the secret is the key; in
Argus the durable roots are **server-side verification, hardware-backed
assertions where available, freshness/single-use ledgers, and scoring that treats
client-controlled evidence as evidence rather than proof.**

## Bottom line

The strongest move is already underway: move trust from page JS into
worker-isolated, server-verifiable, MAC-bound evidence. The highest-leverage next
step is concrete and verified — **stop tolerating missing MACs for current SDKs.**
After that, the work is less about adding detectors and more about enforcing one
rule everywhere:

> No clean verdict may depend on data whose provenance is missing, failed, stale,
> replayed, or merely client-reported.
