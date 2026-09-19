# Salesforce audience sources and optimization

Plan updated 19 September 2026. The user is comfortable composing SOQL and wants to retain Salesforce reports as editable audience definitions where their criteria can be translated. This extends the [Cazoomi replacement plan](cazoomi-replacement-plan.md); it does not implement the new sources or change live data.

## Recommendation

Use SOQL as the primary extraction engine. Support both directly authored SOQL and a saved Salesforce report whose supported metadata is translated into an equivalent audience query. Retain Campaigns, list views, and raw report results as additional sources, all feeding the same identity, consent, mapping, and sync engine. Prioritize the query editor, report-definition translator, and related-field browser over a complete visual condition builder.

An audience answers “which Salesforce contacts qualify?” A mapping answers “which values should accompany those contacts?” A sync connects the audience to a CC list, with a schedule and membership policy. Several audiences can feed the same list; one audience can be reused for several lists without rerunning its extraction for each destination.

## Available approaches

| Method | Suitable use | Proposed role/tradeoff |
| --- | --- | --- |
| Saved SOQL | Precise rules using standard/custom fields, parent relationships, existence/nonexistence of related records | Primary source. Versioned and directly testable; query limitations still apply. |
| Salesforce Campaign members | A team curates people in Salesforce, or membership/status already represents a business audience | First-class source with Campaign/status picker. Read Contact members; do not assume Lead or Account members are Contacts. |
| Salesforce list views | Salesforce users maintain simpler reusable filters | Supported adapter; resolve the view's Describe query and retrieve all results where supported. |
| Salesforce report criteria → SOQL | Users maintain audiences in the Salesforce report builder | Recommended report integration for supported definitions. Translate metadata and run a fully paginated query. |
| Raw Salesforce report results | Compatibility and validating the translator | Limited to 2,000 returned report rows; use only when completeness is established. |
| Visual builder in this app | Users want relationship/field pickers rather than query text | Later authoring interface over the same query model. The relationship field browser is still needed immediately for mapping. |
| Salesforce-maintained eligibility fields or audience junction records | Complex business logic should be owned and visible inside Salesforce | Optional design: an admin-maintained field, Flow-maintained field, or membership object can provide a simple queryable source. Requires separate automation design for updates, deletions, and time-based changes. |
| Several queries combined | Complex logic is awkward or unsupported in one SOQL statement | Optional composition: union, intersection, and exclusion over complete Contact-ID sets in Supabase. No need to reproduce all of SOQL in SQL. |
| Selected Salesforce data replicated into Supabase | Many audiences repeatedly use the same large object sets, or segmentation needs general SQL joins/aggregations | Later optimization only if measured API/latency costs justify it. Requires ongoing replication, deletion handling, access boundaries, and explicit freshness guarantees. |

Campaign membership and member statuses are standard Salesforce capabilities. The app would read them as a source; creating/sending marketing campaigns and updating engagement statuses remain outside scope. [Campaign members](https://trailhead.salesforce.com/content/learn/modules/campaign_basics/campaigns_basics_unit_3).

List views expose their SOQL through [List View Describe](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-listviewdescribe.html). Reports retain the [Reports API limits](https://developer.salesforce.com/docs/analytics/salesforce-analytics-rest-api/guide/sforce-analytics-rest-api-limits-limitations.html).

REST Query, Bulk API 2.0, and Change Data Capture are execution/change-detection mechanisms, not separate definitions of who belongs in an audience. Start with REST Query; use the others when needed. Full-text search (SOSL) is useful for finding records interactively, but is not our primary mechanism for complete repeatable audience extraction.

## Saved report criteria → SOQL

This is viable for a defined, tested set of report features. Read the report's definition, reproduce its membership semantics, then use the ordinary query API for extraction. The report-result ceiling does not limit that independent query.

```text
Saved report in Salesforce
  → Describe metadata + report-type/object metadata
  → validated audience definition
  → generated SOQL (or explicit multi-query plan)
  → complete unique Contact IDs
  → related-field mapping and consent checks
  → Constant Contact list
```

### APIs and metadata

`GET /services/data/vXX.X/analytics/reports/{reportId}/describe` exposes the saved report definition. Relevant properties include `reportFilters`, `reportBooleanFilter`, `standardDateFilter`, `standardFilters`, `scope`, and `crossFilters`. The response also supplies report-type information. The documented response is structured metadata; do not assume it includes a complete ready-to-execute underlying SOQL string. [Describe reference](https://developer.salesforce.com/docs/analytics/salesforce-analytics-rest-api/guide/sforce-analytics-rest-api-getbasic-reportmetadata.html).

Report-type metadata can map a report column using `entityColumnName` and describe custom-report object join types. Fetch `/analytics/reportTypes/{type}` and relevant sObject Describe metadata as necessary. An entity/field pair alone may be ambiguous: `User.Name` could represent different lookups. Require a proven relationship path or a recorded reviewed mapping; never guess from the display label. [Report Type reference](https://developer.salesforce.com/docs/analytics/salesforce-analytics-rest-api/guide/analytics-api-reporttypes-reference-reporttype.html).

### First supported subset

Start with a contact-based report type whose relationships are understood, all-records scope, ordinary field filters, supported parent-field filters, explicit boolean grouping, and tested date ranges. Build from real production report fixtures after authorization. Summary or matrix presentation can be compatible if grouping only changes presentation and does not change which underlying contacts qualify.

| Report feature | Proposed treatment |
| --- | --- |
| Field comparisons and AND/OR logic | Typed expression tree with validated operator/value/null semantics; preserve parentheses. |
| Parent standard/custom fields | Resolve actual relationship paths through report-type and object metadata. |
| Standard/date filters | Include them alongside custom filters; preserve user/org timezone, date vs datetime boundaries, and fiscal/calendar semantics. Reevaluate relative dates each run. |
| All/my/team scope, hierarchy, divisions | Include explicitly. Start with verified all-records scope; add other scopes only with equivalent behavior under the intended integration identity. |
| Custom report types with required/optional child records | Translate only after join semantics are established; missing children must behave the same way. |
| Cross-filters: with/without related records | Later supported subset using semi-/anti-joins or verified set operations; preserve subfilter grouping and SOQL restrictions. |
| Display-only grouping, chart, or formula | May be irrelevant to membership, but record why it can be omitted. Mapping a displayed formula value is a separate feature. |
| Bucket/formula filters, aggregate-based restrictions, field-to-field filters, top-N behavior | Require dedicated verified handling; block initially when they affect membership. |
| Joined reports, historical/trending snapshots, ambiguous Contact resolution | Unsupported initially; offer a separately reviewed SOQL audience. |

These are proposed implementation boundaries, not claims that Salesforce automatically converts those features.

For child filters, preserve same-record semantics. “A membership is active AND expires after today” must match one qualifying membership. Two independent existence tests could incorrectly use an active expired membership and a different inactive future membership. Test optional joins, negative filters, blank values, and duplicate report rows explicitly.

### Example

Given an ordinary Contacts report with all-records scope, all-time date range, Account Industry equal to Education, and Mailing Country equal to Australia, the audience query could be:

```sql
SELECT Id
FROM Contact
WHERE Account.Industry = 'Education'
  AND MailingCountry = 'Australia'
```

Validate actual field/value mappings against the org. If the report additionally limits creation dates or ownership, those restrictions must also appear in the generated plan. Apply email eligibility and opt-outs afterward in the common sync engine; show those exclusions separately from report-matching membership so users can explain count differences.

### Caching and report edits

Store the source report ID and connection, normalized metadata fingerprint, report-type/field mapping version, translator version, execution identity/time context, generated query, support diagnostics, and last validated snapshot. Refresh the saved report definition before a run. Cache metadata/compiled structure while valid, but resolve relative date windows anew.

Provide two explicit modes: **Follow saved report** (retranslate supported edits) and **Copy to independent SOQL** (detach from future report changes). Never silently retain stale query logic after a report edit. Pause when an edit introduces an unsupported feature, a changed report type, or ambiguous field mapping; preview significant membership reductions before applying them. Query edits made in the app should create a detached SOQL source unless a deliberate override model is designed.

### Validation and delivery

1. Inspect three representative production report definitions and classify every membership-affecting rule.
2. Build a read-only translator preview showing interpreted scope/filters, generated SOQL, support gaps, and contact identity resolution.
3. Compare full unique Contact-ID sets against complete report results for bounded fixtures under the same Salesforce user and time context. Counts alone are insufficient, and raw report row counts may include repeated contacts.
4. For reports above 2,000 rows, verify using a supported complete export or independently validated disjoint subsets whose report results are complete. Do not use the first 2,000 rows as the reference set or assume counts prove equivalence.
5. Run translated large audiences through paginated REST or compatible Bulk extraction, then the existing consent and mapping pipeline. Report-only values such as buckets/formulas are not automatically supplied by Contact enrichment.
6. Test saved filter changes, rolling dates, type changes, missing fields/permissions, same-child conditions, nulls, joined/unsupported cases, and failed pages. Every run pins one definition revision and publishes membership only when extraction is complete.

If translation is unsupported, show the exact reason and allow reviewed independent SOQL. Raw report execution is an alternative only where its complete result can be established; never fall back to truncated output for membership reconciliation.

## SOQL contract and examples

The first version accepts a single Contact-rooted SELECT returning `Id`. Additional scalar fields can be previewed, but production mappings remain independently configured. Do not accept an aggregate-only result as an audience. Later, a custom-object query can be supported with an explicit Contact lookup resolver and deduplication.

Example using standard fields:

```sql
SELECT Id
FROM Contact
WHERE Email != null
  AND HasOptedOutOfEmail = false
  AND Account.Industry = 'Education'
```

The mapping can then fetch `FirstName`, `LastName`, `Email`, `Account.Name`, and permitted custom paths without requiring those fields in the audience query. The sample picklist value must exist in the connected org.

Example of related-record criteria using a semi-join (custom object/field names are illustrative):

```sql
SELECT Id
FROM Contact
WHERE Email != null
  AND HasOptedOutOfEmail = false
  AND Id IN (
    SELECT Contact__c
    FROM Membership__c
    WHERE Status__c = 'Active'
      AND Expiry_Date__c >= TODAY
  )
```

This selects each Contact once even if several memberships qualify. It does not choose which membership's expiry should be copied to CC; that is a separate mapping rule such as latest expiry among active memberships. Validate actual metadata, semi-join support, and permissions before enabling the query. Salesforce documents [relationship join filters and corresponding SOQL](https://developer.salesforce.com/docs/platform/graphql/guide/filter-joins.html).

Query authoring workflow:

1. Name the audience, select the Salesforce connection, and enter SOQL.
2. Offer metadata-based object/field/relationship suggestions and reusable typed parameters for IDs, dates, and picklist choices. REST queries do not accept Apex bind variables; render parameters using validated type-aware encoding, never raw string concatenation.
3. Parse and validate a supported SELECT structure, root object, identity field, field access, and execution compatibility. Reject side-effect modifiers such as `FOR UPDATE`, `FOR VIEW`, or `FOR REFERENCE`; run through query APIs only. Block unsupported forms rather than rewriting them speculatively.
4. Run a bounded preview that is visibly labeled as a sample; preserve the saved production query separately. An explicit top-N audience requires deterministic ordering and a clearly documented meaning. Never reuse preview limits for a full sync or remove user limits silently.
5. Show complete unique membership counts after full extraction, sample mapped values, missing-email/opt-out exclusions, duplicate-email conflicts, and changes versus the last complete run. A sample count or query-plan estimate is not the final list size.
6. Save an immutable revision, select mapping/target/schedule, and run a dry comparison. Freeze that revision for an in-flight run.

Always enforce consent/eligibility in the shared sync engine even when the saved query omits the sample opt-out conditions. An audience query cannot override local suppression or CC subscriber preferences.

## Execution strategy

| Workload | Approach | Completeness requirement |
| --- | --- | --- |
| Preview and ordinary recurring audiences | REST `/query` | Follow `nextRecordsUrl` until `done = true`; don't use OFFSET to walk a full audience. |
| Large initial loads or large flat exports | Bulk API 2.0 when query-compatible | Wait for job completion, download all result pages/locators, and validate extraction before publishing membership. |
| Parent fields | Select supported paths such as `Account.Name` in enrichment queries | Handle null lookups and requested-field permissions. |
| Child/junction fields | Separate batched child queries keyed by parent/contact ID; aggregate in worker when appropriate | Page all child results, deduplicate, and apply explicit selection rules. |
| Several audiences sharing people | Reuse completed source snapshots within a declared freshness window; enrich their union | Keep source membership and output-field ownership distinct. |

REST Query returns up to 2,000 records **per response**, with a locator for remaining results. That differs from the report result ceiling. [REST Query](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-query.html).

Bulk API 2.0 does not support parent-to-child SELECT subqueries, GROUP BY, aggregate functions, OFFSET, or TYPEOF. It does support child-to-parent paths. Do not switch arbitrary SOQL to Bulk based on row count alone. Use capability checks and separate queries where needed. [Bulk query creation](https://developer.salesforce.com/docs/platform/api-asynch/guide/query-create-job.html).

Avoid a fixed universal “2,000 rows means Bulk” rule: REST pagination remains valid above that size, and Bulk introduces asynchronous overhead. Record latency, rows, bytes, and API usage for real queries; use those observations to choose a configurable execution threshold. REST aggregate queries also cannot paginate GROUP BY results with a query locator, so large aggregates require bounded partitions or local aggregation of completely extracted child rows. [GROUP BY considerations](https://developer.salesforce.com/docs/platform/salesforce-soql-sosl/guide/sforce-api-calls-soql-select-group-by-considerations.html).

## Optimization order

### 1. Complete reads, minimal writes

Start by recomputing complete audience membership each scheduled run. Fetch only required identity/mapping/dependency fields. Batch relationship reads, share enrichment across overlapping audiences, cache Describe metadata, and send only changed mapped values/memberships to CC using canonical payload hashes.

This already avoids redundant CC work while keeping membership correct. The 1,577 legacy stored contacts are a useful starting point, not a verified count of the current production audience. Benchmark against the actual org before introducing replication or event infrastructure.

Expose per-run unique contacts, eligible contacts, source requests, CC requests, bytes, extraction duration, total duration, and changes/no-ops. Configure schedules from measured load and required freshness. Stagger runs and enforce shared provider budgets; reserve capacity for preference polling and unsubscribe handling.

Use optional Salesforce query-plan feedback to identify costly scans and filter opportunities. Prefer selective positive criteria and available indexed fields where appropriate, but do not alter the intended audience simply to satisfy an index. Query-plan feedback is documented as Beta and should be advisory, not a runtime dependency. [Query performance feedback](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-query-performance-feedback.html).

### 2. Add incremental reads only for understood dependencies

Record all objects/relationships used in membership predicates and mapped outputs. A change to any of them may affect the audience or its payload.

| Change | Required handling |
| --- | --- |
| Contact changes | Reevaluate its membership and mapped values. |
| Account tier or other parent value changes | Find affected contacts, including contacts not previously in the audience; reevaluate them. |
| Membership/other child record created or changed | Reevaluate referenced contacts. A reparent must invalidate both old and new parents. |
| Child relationship deleted | Use stored relationship linkage or deletion history to find the former contact. |
| Contact deleted or merged | Reconcile identity links and owned memberships; do not delete the CC contact globally. |
| Date passes a threshold | Reevaluate on schedule even if no Salesforce record was edited. |
| Formula/predicate dependencies are opaque | Keep full refresh for that source. |
| Sharing/permission or query-definition changes | Revalidate access and rebuild a complete baseline; unexpected reductions need review. |

Where suitable, poll supported object `SystemModstamp` fields with overlap and a durable upper watermark, then re-evaluate affected IDs against the complete current audience predicate. Crucially, do **not** fetch changes only through that predicate: contacts that just stopped qualifying would disappear from the incremental result and remain incorrectly on the CC list. Track relevant deletions separately and periodically reconcile full membership.

`SystemModstamp` can be useful for indexed change extraction where available, but a Contact timestamp is not a complete change feed for related objects. [Timestamp performance guidance](https://developer.salesforce.com/blogs/engineering/2014/11/force-com-soql-performance-tips-systemmodstamp-vs-lastmodifieddate-2).

For arbitrary user-authored SOQL, dependency inference may be incomplete, especially for formulas. Default such queries to full membership refresh; only enable incremental mode where completeness is demonstrated. Date-relative predicates must have an explicit reevaluation cadence/timezone policy. Label the actual freshness in the UI.

### 3. Add events or a local replica only when justified

If low latency becomes necessary, evaluate Change Data Capture for supported dependency objects. Re-query affected contacts using the integration identity before updating audiences; events are triggers to reevaluate, not proof of current membership. Retain replay checkpoints, handle duplicates/gaps, and verify permissions/allocations before enabling.

Salesforce retains change events for three days. An expired replay window requires a rescan, and time-based conditions still need scheduled evaluation. [CDC retention](https://developer.salesforce.com/docs/platform/change-data-capture/guide/cdc-subscribe-delivery.html).

If many audiences repeatedly scan the same large datasets, replicate only the necessary objects/fields to Supabase and evaluate complex joins/aggregations there. Before adopting this, define how to bootstrap consistently, apply overlapping updates, detect deletions/reparenting, reflect permission changes, and rebuild after gaps. Display replica freshness and pause membership removals if it is incomplete. A local replica is an architectural option, not a first-release dependency.

## Source composition and related values

Support the following as a later, explicit feature if users need it:

`Final audience = (query A union Campaign B) minus exclusion query C`

Store immutable input snapshot IDs and evaluate only after every required input is complete and sufficiently fresh. A failed exclusion query must not become an empty exclusion set. Detect cyclic audience references and deduplicate by Salesforce connection + Contact ID before resolving CC identity.

For child-object sums, latest records, and combined values, prefer a small number of batched queries plus deterministic worker transforms. Avoid one query per Contact. Cache shared parent values for the run, track field origins, and keep deterministic priority rules when several audiences feed the same account-wide CC field.

## Implementation sequence and acceptance

1. **Saved SOQL + REST pagination:** connection-scoped query editor, metadata assistance, validation, sample preview, full extraction, versioned snapshots. Prove >2,000 records, empty results, a failed middle page, and deduplication; no partial snapshot may remove memberships.
2. **Mapping/enrichment + common sync engine:** parent and custom relationships, batched children, value transforms, consent gate, stable identities, and output hashes. Prove repeated unchanged runs create no redundant provider writes and shared people are enriched once per compatible run.
3. **Report-defined audiences and additional sources:** translate a tested subset of saved report metadata into SOQL; add Campaign/status and list-view adapters and retain complete raw report results for compatibility. Compare full membership sets under the integration identity and block unsupported semantics explicitly.
4. **Measurement-driven scale:** source metrics, source/enrichment reuse, optional query-plan advice, Bulk for compatible expensive queries. Benchmark before/after without changing audience semantics.
5. **Optional incremental/event modes:** dependency tracking, deletes/reparents, time predicates, replay recovery, and periodic full reconciliation. Prove they produce the same membership and mapped output as full reevaluation.

High-value regression scenarios: an Account change adds a previously excluded contact; an Account change removes a current member; a membership is deleted or reparented; expiry passes with no edits; a formula changes; a query revision changes eligibility; a filtered change query would miss exits; a failed exclusion source must stop publication; Bulk-incompatible queries use a valid strategy; and a CC unsubscribe remains protected regardless of query contents.

The existing unsubscribe-only Salesforce writeback setting, CC list ownership rules, and Cazoomi cutover gates are unchanged. No new Salesforce-side writes are introduced by these source options.
