# ForceMultiplier email marketing platform plan

Updated 22 September 2026. This is the target product scope and implementation plan. The [README](../README.md) describes what is running today. The earlier [Cazoomi replacement plan](cazoomi-replacement-plan.md) is retained as implementation history; its Constant Contact destination and exclusions on campaign sending no longer define the target.

## Product decision

**Replace our use of Constant Contact entirely.** ForceMultiplier will be the internal place to manage Salesforce-derived audiences, contact fields and preferences, email templates, campaigns, sending, and results. Resend will hold the sending contacts and deliver marketing email. Templatical will be the embedded email builder. Constant Contact remains available only for the controlled migration and historical reference, then its scheduled syncs and sending will be retired.

The first release is for one trusted internal workspace and one production Salesforce org. It covers Salesforce Contacts and permissioned marketing broadcasts. It does not require a public signup product, a generic automation journey builder, or replacing Salesforce as the source of CRM data. Leads, Person Accounts, non-Salesforce contacts, transactional mail, multichannel marketing, and complex automation can be evaluated after the broadcast workflow works end to end.

### Ownership and flow

| Concern | Owner in the target system |
| --- | --- |
| CRM identity, profile fields, and source criteria | Salesforce; retain its record ID and org ID as the durable identity |
| Audience definitions and complete membership snapshots | ForceMultiplier/Postgres, using the existing SOQL, report, Campaign-member, and list-view extraction |
| Marketing consent and suppression evidence | ForceMultiplier ledger plus Resend contact state; Salesforce opt-out is always an exclusion |
| Contact delivery copy, segments, topics, and broadcast execution | Resend |
| Editable templates, versions, assets, campaign drafts, and review history | ForceMultiplier/Postgres and private object storage for images |
| Email authoring | Embedded Templatical; save its editable JSON and render final HTML on the server |
| Delivery and engagement events | Resend webhooks, persisted and summarized in ForceMultiplier |

`Salesforce sources -> complete ForceMultiplier audience snapshot -> consent/field validation -> Resend contacts + segment -> approved campaign -> Resend Broadcast -> verified events/results`

Resend's current APIs expose contacts, contact properties, segments, topics, Broadcasts, and webhooks. Its legacy Audience endpoints are marked deprecated, so new work should use segments. Templatical provides optional backend hooks for save/load, version history, test email, and rendering; those stores and actions remain ours. See [Resend's API reference](https://resend.com/docs/api-reference/broadcasts/create-broadcast), [Templatical backend contracts](https://docs.templatical.com/backend/), and [Templatical rendering](https://docs.templatical.com/backend/render).

## Scope of the first usable release

1. **Audience and contact hub.** Reuse existing Salesforce connection, audience builder, related-field explorer, complete snapshots, scheduling, and run history. Show audience size, freshness, exclusions, duplicate email conflicts, and a searchable contact view. Keep source definitions separate from sending segments: a Salesforce audience answers who qualifies; a Resend segment is its delivery copy. Do not publish a partial or failed pull. Start with one audience per campaign; union/exclusion audiences can follow when their semantics and ownership are explicit.
2. **Custom fields and segmentation.** Keep a typed ForceMultiplier field catalog and explicit Salesforce-to-marketing mappings with preview, null rules, and field ownership. Publish only fields needed for personalization or Resend targeting as contact properties. Check provider-supported types and limits at implementation. Reconcile segment membership from complete snapshots; preserve unrelated memberships and never turn a previously unsubscribed contact back on during an upsert. Deduplicate by normalized email for delivery, while retaining every Salesforce identity and quarantining ambiguous collisions. See [Resend contact properties](https://resend.com/blog/new-contacts-experience) and [segment contact APIs](https://resend.com/docs/api-reference/segments/list-segment-contacts).
3. **Templates.** Embed Templatical in the app. Store editable JSON, template name/category, author, version, created/updated times, and a published revision in Postgres. Store uploaded images in managed storage and give email content stable public delivery URLs where required by email clients. Render MJML and final HTML server-side; keep a text version and render errors. Provide duplicate, preview at desktop/mobile widths, sample-contact merge preview, test send, and restore of a previous version. Freeze the rendered revision used by each campaign so later template edits cannot change an approved send. Resend's own templates need not be a second source of truth in this release. Templatical's [license FAQ](https://docs.templatical.com/license-faq) expressly allows embedding in an internal marketing tool; retain required license notices.
4. **Campaigns.** Create a draft from a published template and one audience. Set sender identity, reply-to, subject, preheader, optional topic, and send time. Show an explicit preflight: complete and fresh audience snapshot, eligible/excluded counts, duplicate/conflict counts, sample personalized output, working links, unsubscribe footer, sender/domain status, and estimated send usage. Require an authorized reviewer to approve the frozen content, target, and count before immediate or scheduled send. Editing any of these invalidates approval. Create an API-owned Resend Broadcast, store its ID and status, and prevent duplicate sends on retries. Resend says API-created broadcasts are edited and sent via the API rather than its visual editor, which fits ForceMultiplier-owned drafts. See [Broadcast API behavior](https://resend.com/blog/broadcast-api) and [Broadcast creation](https://resend.com/docs/api-reference/broadcasts/create-broadcast).
5. **Consent, preferences, and deliverability.** Import Constant Contact unsubscribes and other suppressions before first Resend send. Continue to honor Salesforce `HasOptedOutOfEmail`, or the approved org-specific field, alongside Resend global unsubscribe/topic preferences and local suppression history. A Salesforce refresh must never reactivate an unsubscribe. Include Resend's unsubscribe mechanism in every marketing email and expose topic preferences if multiple marketing categories are needed. Verify webhook signatures on the raw body, persist events idempotently, and reconcile missed events before sending again. Treat global unsubscribe, topic unsubscribe, hard bounce, complaint, and segment removal as separate states. Preserve the existing unsubscribe-only Salesforce writeback policy for **confirmed global** opt-outs once the Resend path is validated; never clear Salesforce opt-out automatically. See [Resend topics](https://resend.com/blog/unsubscribe-topics), [contact webhook events](https://resend.com/changelog/new-contact-webhooks), and [webhook verification](https://resend.com/changelog/managing-webhooks-via-api).
6. **Results and operations.** Show campaign status and recipient counts, deliveries, failures, bounces, complaints, unsubscribes, and available open/click data. Make open/click metrics directional because tracking can be blocked or inflated by mail clients and security scanners. Keep per-recipient detail behind internal access controls, define retention, and provide retry/reconciliation diagnostics. Add pause/cancel where the provider supports it. Review sender domain authentication, reputation, account limits, and actual sending capacity before pilot.

## Important delivery rules

- Publishing contacts or a complete audience snapshot does not authorize a send. Only an approved campaign can send.
- Before sending, reconcile the chosen snapshot, local suppressions, Salesforce opt-outs, and Resend preferences; fail closed when any required state is missing or stale. A sudden zero-member audience or large membership change requires review.
- Prefer a campaign-specific Resend segment populated from the approved recipient set so later audience syncs cannot change a queued campaign. Verify segment and scheduled-send timing against current Resend behavior in a small pilot. Record the resolved recipient IDs/count and provider segment ID. If provider behavior cannot guarantee the intended set, schedule preparation in ForceMultiplier and submit the Broadcast only after final reconciliation at dispatch.
- Freeze template revision, mappings, audience snapshot, sender, subject, and approval in the campaign record. Sending is a one-way action; uncertain API outcomes must be looked up by stored provider ID before any retry.
- Do not use individual transactional sends as a substitute for Broadcasts merely to avoid recipient management. Use Resend Broadcasts for marketing delivery, unsubscribe handling, and provider queueing.
- Keep the current Constant Contact integration read-only during final comparison, except for existing workflows deliberately left active until their individual cutover. No dual sending to the same recipients.

## Data and implementation shape

Extend the private `forcemultiplier` schema additively. Keep existing `Audience`, `PullRun`, and `AudienceMember`; introduce small, separate records for marketing field definitions/mappings, Resend contact links and segment membership, suppression/consent events, template revisions, campaigns/approvals, and provider events. Reuse the current encrypted connection and worker/lease patterns where they fit. Distinguish Salesforce IDs, normalized email, and Resend contact IDs; none alone proves two CRM records are the same person. Preserve historical Constant Contact runs for audit rather than relabeling them as Resend work.

Use server-only Resend credentials, verified sender domains, and a signed webhook endpoint. Templatical runs in a client editor, while saving, rendering, test sends, media uploads, and publishing require authenticated server routes. Escape or validate personalization values, render a real sample recipient before approval, and retain a plain-text alternative. The current one-workspace admin access should gain at least author/reviewer/send permissions before multiple staff can launch campaigns; keep audit records of who approved and sent each one.

Do not rebuild the Salesforce extractor. Its complete paginated snapshots and related-field mapping are the base. Replace the destination-specific Constant Contact delivery path with Resend contact/segment reconciliation behind new marketing tables, then add campaign sending. Do not rename or delete existing Constant Contact tables until migration is complete and recoverable.

## Delivery sequence and acceptance gates

| Phase | Deliverable | Gate before advancing |
| --- | --- | --- |
| 0. Inventory and migration baseline | Export Constant Contact lists, field mappings, templates, active schedules/campaigns, consent and suppression states; record contact counts, sender domains, and required functionality | Every sending workflow and unsubscribe source has a mapped destination; current data has a recoverable export |
| 1. Resend foundation | Secure API connection, verified domain, webhook endpoint, consent ledger, contact-property mapping, and audience-to-segment reconciliation | Test contacts match Salesforce identity/fields; opt-outs survive reimport; interrupted sync resumes without creating duplicate contacts or changing consent |
| 2. Builder and library | Templatical editor, save/load/versioning, media, server rendering, preview, and test send | Draft survives reload; published revision renders consistently; sample fields and unsubscribe footer render correctly on mobile and desktop |
| 3. Campaign workflow | Draft, review, preflight, approval, send/schedule/cancel, frozen revision and recipient set, Resend Broadcast integration | Internal seed campaign sends once, only to approved eligible recipients; duplicate requests and uncertain responses cannot trigger a second send |
| 4. Results and operational hardening | Verified webhook ingestion, campaign reporting, suppression reconciliation, alerts, roles, retention, and recovery tools | Unsubscribe, bounce, complaint, webhook replay, provider outage, stale snapshot, and changed audience all produce the expected safe state |
| 5. Constant Contact cutover | Shadow comparison, small live pilot, workflow-by-workflow migration, disable old sends/syncs, archive exports and runbook | Recipient sets, custom fields, suppression state, and campaign behavior match expected samples; no workflow has two active senders; several scheduled runs and campaigns complete cleanly |

Existing Salesforce audiences and Constant Contact code satisfy parts of the foundation, but none of phases 1–5 should be reported as complete until verified against Resend and Templatical. Do not cancel Constant Contact during planning or before the cutover gate.

## After replacement

Use the phase-0 inventory to prioritize any Constant Contact features that must move before cancellation. Once broadcasts are stable, likely extensions are a self-service preference center and signup forms, reusable multi-audience segments, recurring campaigns and simple triggered sequences, A/B tests, and richer engagement reports. Each should ship with its own consent and attribution rules. Add landing pages, surveys, or SMS only if current workflows actually need them. Resend now offers [Automations APIs](https://resend.com/blog/introducing-automations), but using a provider feature does not remove the need for ForceMultiplier to own trigger definitions, contact eligibility, and audit history.

## Decisions to confirm during phase 0

- Which Constant Contact features are actually used today: campaigns, automated sequences, signup forms, landing pages, surveys, SMS, templates, and preference center? These determine whether another replacement feature is needed before cancellation.
- Which brands/sender domains, monthly volume, peak campaign size, send frequency, and required approval roles apply? Check Resend's current plan limits and sending review with those numbers rather than assuming a tier.
- Which Salesforce objects beyond Contact, if any, and which fields should be available for segmentation and personalization? Which field represents authoritative opt-out in the production org?
- Should subscribers choose separate topics, or is a single global marketing preference sufficient for the first release?
- How long must template versions, recipient-level events, consent evidence, and campaign results be retained?

The first implementation task is the phase-0 inventory, followed by a read-only Resend account/domain/limit check and a narrow contact-plus-segment proof using test addresses. This resolves migration and provider behavior before any production sending code is enabled.
