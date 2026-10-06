# Audited marketing resubscriptions

The **Marketing resubscriptions** screen records a staff-assisted, explicit request from the person and reconciles ForceMultiplier, Salesforce and Resend. It restores **all workspace marketing across brands**. Do not use it for consent limited to one brand or list. A donation, registration, imported record or cleared Salesforce checkbox is not sufficient evidence.

The older Constant Contact tool remains under a separate, collapsed legacy section. This workflow does not change Constant Contact permissions or list memberships. Disable legacy Constant Contact unsubscribe writeback and let its worker finish before using the new workflow.

## What happens

1. Staff record the address, actual consent time, source, evidence/reference and an explicit scope attestation. The authenticated staff member, request time, original block and provider identities are retained in the audit record.
2. The application holds a local marketing suppression throughout reconciliation. It requires healthy consent readiness and obtains the existing Salesforce sync and Resend cleanup leases. These staff-assisted requests are serialized; campaign selection does not make these provider calls for each recipient.
3. Exactly one matching Salesforce Contact is required. An opted-out Contact modified at or after the consent time requires review. Salesforce is updated conditionally using `If-Unmodified-Since`, so a conflicting change rejects the write.
4. Resend delivery suppressions are checked and never removed. An existing contact is updated by its captured ID. A contact removed by retention is recreated **unsubscribed**, then explicitly reconciled. The workflow spaces its Resend calls; a shared-account rate limit still leaves the address blocked.
5. Both provider identities and flags are read back. The local block is cleared only if the suppression revision is unchanged, no newer/late-arriving opt-out was observed, consent readiness is still healthy and the provider account bindings still match. Completion and release are one database transaction.
6. Refresh the audience before selecting the contact for a new campaign. Historical audience snapshots and existing campaign recipient sets are not rewritten. A snapshot containing `optedOut=true` still excludes the contact. Completed consent can supersede an older legacy unsubscribe record for modern campaign selection; the original record is retained.

Local delivery blocks, explicit campaign exclusions and Resend delivery suppressions continue to apply. The workflow only restores marketing consent; it does not determine the eligibility of service notices.

## Recovery

- Repeating the same HTTP request ID returns the existing result without repeating provider writes. Reusing an ID for different evidence is rejected.
- **Retry checks and reconcile** is available only if no provider mutation was marked as started. It uses the original evidence and repeats all checks, including revision and newer-opt-out checks.
- Once a provider mutation may have started, **Verify result** only reads the providers. It can complete an uncertain request if the original contacts are both subscribed and all local checks still pass. It never replays an opt-in write.
- A partial or ambiguous result stays locally blocked. If verification cannot complete, investigate the recorded error. A new explicit request is needed before starting another write attempt; the original consent timestamp cannot be recycled.
- A terminated request may show `processing` until staff verify it. Its block remains in place, and leases expire after five minutes. There is no automatic opt-in retry worker.
- Rotating the Resend API key while a request is incomplete prevents its verification because the request is bound to the original key fingerprint. No key is exposed in the UI/API audit result.

## Scenarios checked

| Scenario | Expected result |
| --- | --- |
| Both providers opted out; valid later consent | Reconcile, verify, release marketing block; retain evidence |
| Both provider flags already clear | Require evidence and all checks; no provider write needed |
| Duplicate HTTP submission or lost HTTP response | Return the same request; no repeat writes |
| Request ID reused for another address/evidence | Reject the conflicting submission |
| Salesforce Contact missing or duplicate email matches | Keep blocked; do not choose a Contact arbitrarily |
| Salesforce Contact changed after consent | Keep blocked for review |
| Salesforce rejects conditional update | Keep blocked; do not opt Resend in |
| Resend accepts update but response is lost | Keep blocked; read-only verification can finish |
| Provider read fails or rate limit is reached before mutation | Keep blocked; preflight retry is available |
| Provider mutation fails or has an uncertain result | Keep blocked; no mutation retry with the same request |
| Contact removed by retention | Recreate blocked, explicitly opt in, verify identity and state |
| Cleanup is active | Wait for cleanup; overlapping work is rejected |
| Old cleanup worker or Salesforce writeback loses its lease | Stop before another destructive/provider write |
| Salesforce sync is active | Reject overlapping resubscription work; retry when it finishes |
| Old outbound unsubscribe job is queued/failed | Supersede that job; preserve its audit history |
| Another unsubscribe arrives while already locally blocked | Increment revision; the resubscription cannot clear it |
| Unsubscribe arrives between final read and block deletion | Conditional deletion cannot remove the changed revision |
| Same Resend webhook is delivered twice | Record/apply once; a duplicate cannot undo later consent |
| Previously unseen, delayed unsubscribe webhook arrives | Conservatively block for review, even if its timestamp is older |
| Person unsubscribes again after successful resubscription | Block again; queue a new Salesforce opt-out generation |
| Person explicitly requests marketing again after that | A new audit request can reconcile the second cycle |
| Old consent is reused after another unsubscribe | Reject it; old completion cannot clear a new block |
| Older Constant Contact unsubscribe exists | Only a completed, later explicit request can supersede its selection block |
| Newer or late-discovered legacy unsubscribe exists | Keep blocked |
| Local bounce/complaint/other delivery block | Never clear it through marketing resubscription |
| Resend has a delivery suppression | Do not remove it or proceed with opt-in writes |
| Salesforce org, Resend key or contact identity changes | Keep blocked; do not reconcile different identities |
| Consent baseline/webhook setup/sync freshness is unhealthy | Keep blocked until readiness is restored |
| Future consent time, missing evidence or narrower scope | Reject the input |
| Old opted-out snapshot or prepared campaign | Leave it unchanged; refresh/rebuild as appropriate |
| Funraisin record/import or unsolicited `unsubscribed=false` webhook | Does not itself grant or restore local consent |

## Limits that remain important

Salesforce, Resend and this database do not provide a shared transaction. Resend's documented contact-update API has no conditional-write parameter. A provider-side unsubscribe can occur between a read and a write, and webhook delivery or Salesforce scanning can be delayed. The implementation blocks on every newer opt-out it has observed, rechecks before release, and retains the campaign's final suppression gate; it cannot promise instantaneous knowledge of an external change or recall a broadcast already submitted to Resend.

Do not send independently through provider dashboards while a consent request is partially reconciled: ForceMultiplier's local hold only controls ForceMultiplier sends. New integrations must preserve opt-out history and use explicit consent evidence; importing a newer row must not reset unsubscribe state.

A late, previously unseen opt-out is deliberately conservative: it may require another review or explicit request. Salesforce's last-modified time can reflect an unrelated edit, so that conflict can also require review. These choices favor retaining a block when chronology is uncertain.

Provider references: [Salesforce conditional requests](https://developer.salesforce.com/docs/platform/api-rest/guide/intro-rest-conditional-requests.html), [Resend contact update](https://resend.com/docs/api-reference/contacts/update-contact), [Resend suppression lookup](https://resend.com/docs/api-reference/suppressions/get-suppression).

## Verification

`npm test` exercises mocked provider calls and durable workflow state, including partial failures, write conflicts, revision races, identity changes, retries and repeated consent cycles. No live contacts are changed or emails sent.

The SQL check runs the migration and the actual queue/recipient-selection SQL in an isolated, in-memory PostgreSQL engine. PGlite is a temporary verification tool, not an application dependency:

```sh
npm install --prefix /tmp/fm-consent-check --no-save --ignore-scripts @electric-sql/pglite
PGLITE_MODULE=/tmp/fm-consent-check/node_modules/@electric-sql/pglite/dist/index.js node --import tsx scripts/check-marketing-consent-sql.ts
```

It verifies opt-out generations, resubscription holds, legacy history precedence, immutable opted-out snapshots and delivery blocks. It never connects to the workspace database. The production migration is applied by the existing `vercel-build` deployment command.
