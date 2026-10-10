# Salesforce Contact mirror and audience cutover plan

**Status:** Phase 1 is implemented but the mirror is off by default. This is the working plan for moving Salesforce Contacts and audience extraction toward Supabase while replacing Constant Contact. The broader product roadmap is the [email marketing platform plan](email-marketing-platform-plan.md); the current mirror's controls and recovery steps are in the [mirror runbook](salesforce-contact-mirror.md).

## Target design

Salesforce remains the CRM source of truth. Supabase holds a private, org-scoped copy of the Contact fields the application needs. A scheduled sync applies changed Contacts and deletions, with full reconciliation after a gap or permission change. An audience still has a saved definition and a complete, immutable membership snapshot for campaign review. The source of its membership depends on its criteria:

| Audience criteria | Membership source after cutover |
| --- | --- |
| Supported predicates using mirrored Contact fields only | Query the local Contact mirror. Support must be proven by parsing the saved query, not inferred from its text. |
| Related objects, parent fields, formulas, saved Salesforce sources with unsupported semantics, or fields not mirrored | Run a complete Salesforce membership query where an equivalent is supported, then join its Contact IDs to current local Contact rows. Fetch any required non-mirrored personalization fields explicitly. If equivalence cannot be proved, block that source rather than publish a partial audience. |
| Future Funraisin entrants | Use a separate Funraisin source and identity; link to Salesforce only through verified IDs. Do not treat an email match as identity or consent. |

The local mirror is **not** the consent authority. Marketing sends continue to require the suppression ledger, healthy Salesforce opt-out synchronization, Resend unsubscribe state, and the existing final eligibility checks. Neither a Contact import nor an audience refresh may clear an opt-out. An explicit, evidenced resubscription remains its own audited workflow.

## Sequence and gates

| Stage | Work | Gate before the next stage |
| --- | --- | --- |
| 1. Private mirror foundation — implemented | Minimal Contact fields, paged bootstrap, daily overlapping changes, deletion feed, rebuild path, authenticated controls, private database tables. No audience or send behavior changed. | Tests and database access controls pass; keep the mirror off until the production org and integration permissions are reviewed. |
| 2. Production shadow validation — next | Enable the mirror for the intended org. Compare its completed full-scan count and sampled IDs, email changes, opt-out flags, and deletes with Salesforce. Exercise a rebuild in a test org or schedule an off-peak production reconciliation; measure duration and API use. Verify an ordinary signed-in Supabase client cannot read the tables. | Complete coverage under the intended Salesforce user; no unexplained count or identity gaps; deletion coverage is current; recovery works without publishing partial audiences. |
| 3. Audience contract and parity | Classify existing audiences by dependency: Contact-only, parent/related object, time-relative, report, Campaign, list view, and custom fields. Build the minimum local Contact evaluator for a proven subset. Run old and proposed extraction side by side and compare complete Contact-ID sets and selected values. | Representative real audiences match by ID, not only count, including null, case, and date semantics. Unsupported criteria stay on Salesforce or are blocked. Changes to related objects and date-relative predicates change membership on schedule even when no Contact changes. |
| 4. Controlled audience cutover | Put the new extraction behind an explicit per-source switch. Keep the existing immutable snapshot/pull-run model and send safety checks. Reject stale mirror coverage, missing local IDs, incomplete Salesforce pages, changed source definitions, and unexpected large drops. Preserve the last complete snapshot when a pull fails. | Pilot audiences and campaigns produce the same eligible recipients and exclusions as the old path; no send occurs from an incomplete or stale source. Rollback to the previous extractor is available without changing consent state. |
| 5. Simplify and extend | Remove the redundant per-audience core Contact fetch once all callers use the shared base row. Keep deliberate Salesforce queries for related membership and non-mirrored fields. Retire old Constant Contact list/delivery schedules only after their individual workflows have moved and archive/recovery gates pass. Add Funraisin as its own source afterward. | No active caller depends on removed paths; historical snapshots and audit records remain readable; one workflow has only one active sender. |

## Decisions that govern implementation

- **Completeness before speed.** A changed Contact timestamp does not capture Account, Opportunity, Campaign, membership, formula, permission, or time-driven changes. Keep complete Salesforce membership queries for those audiences until a dependency-specific incremental method is proved equivalent. Never apply “created or modified since” to the qualifying result alone: that would miss people who stopped qualifying.
- **Freshness is explicit.** Store the mirror's completed coverage time and the audience snapshot's source coverage. Do not infer safety from “synced sometime today.” A stale or interrupted mirror blocks any audience path that requires it; consent has its own stricter readiness checks.
- **The old extractor remains during comparison, then is removed.** Do not maintain two permanent enrichment systems. Reuse the existing snapshot and campaign contracts, replace their source adapter, and delete obsolete Salesforce core-field re-fetching only after all its callers are accounted for.
- **Limit stored data.** Add Contact fields only for a reviewed segmentation or personalization need. Keep raw provider responses and secrets out of browser APIs. Preserve org boundaries, RLS, least-privilege integration access, and a documented retention/removal policy.
- **Measure before changing worker technology.** The current page-per-minute bootstrap tops out at 2,000 Contacts per minute. If actual volume or API cost makes that too slow, compare a compatible Salesforce Bulk export or a dedicated worker before expanding the mirror indiscriminately.

## Information needed for stage 2 and 3

Record the expected production Contact count visible to the integration user, approximate daily change/delete volume, and two or three real audiences: one Contact-only, one related-object query (for example Opportunities over a threshold), and one time-relative or report-defined source. For each, record the expected Contact-ID set or a reproducible Salesforce comparison, fields needed for personalization, and required freshness. These fixtures drive the parity gate and reveal whether the local-only path is worth implementing for the actual workload.
