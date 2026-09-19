# ForceMultiplier: Salesforce → Constant Contact replacement plan

Prepared 18 September 2026. This is an implementation plan, not a claim that the new integration is built or connected.

## Confirmed scope and recommended defaults

Replace the current Cazoomi contact-sync workflows using this app and the existing Supabase project where recoverable. Keep the useful Salesforce report browsing/preview code. Build dedicated Salesforce and Constant Contact settings, list creation/management, saved SOQL, Campaign, report and list-view sources, related-object discovery, custom-field mapping, scheduled sync, and operational history.

**Updated source strategy (19 September):** use SOQL as the primary extraction engine, supporting both directly authored queries and supported saved report definitions translated from metadata. This lets users maintain audiences in Salesforce's report builder without depending on its result-row limit. Campaigns and list views remain convenient alternatives. See [Salesforce audience sources and optimization](salesforce-audience-sources.md) for the report translator, query contracts, examples, and staged optimization. This is a plan update; these source adapters are not yet implemented.

The user confirmed **Constant Contact → Salesforce should write back unsubscribes only**, configurable in settings. Salesforce remains the source for outbound contact details. Creating Salesforce contacts from Constant Contact, general inbound field changes, campaign creation/sending, and engagement reporting are outside this initial scope.

Proposed starting assumptions: one internal workspace, one production Salesforce org, one Constant Contact account. Start with Contact records; confirm whether Leads, Person Accounts, or custom objects representing people are also required. Contact volume, number of lists, schedule, and example related objects remain to be confirmed. Use configurable schedules with quota estimates; determine the actual interval after measuring representative runs.

## Current repository and reconnection findings

| Area | Evidence and decision |
| --- | --- |
| App | Next.js App Router, TypeScript, React Query, Prisma/Postgres. Retain the shell and useful report UI; move the old prerelease Next/React stack to a supported stable combination before deployment. |
| Salesforce OAuth | Authorization code flow already includes state and PKCE. Retain the concept; replace the unsigned Salesforce-user-ID session cookie with proper app authentication and workspace authorization. |
| Report extraction | `lib/salesforceClient.ts` discovers reports and parses fact maps. It currently reads formatted labels, selects only fact-map keys ending in `!T`, and does not check completeness. Test/rework parsing for supported report formats. |
| Contact imports | `app/api/salesforce/sync-report/route.ts` deletes all rows for a report, then recreates them one by one. Replace this with stable identities, staged snapshots, and resumable upserts. Cascading deletes can also remove downstream sync history. |
| Mapping | `lib/reportMapping.ts` guesses fields from names/labels. Useful only for suggestions. Persist explicit API field paths, raw typed values, and approved mappings. |
| Data model | Existing connector/list-sync tables are scaffolding. Contacts lack durable Salesforce identity; token rows lack org/workspace ownership; source membership needs its own model. |
| Access control | `/api/contacts` currently has no application authorization check. All eight public tables have RLS disabled, verified read-only after resume; actual Data API grants still need inspection. Protect routes, background job entrypoints, and exposed tables before deployment. |
| Settings | Current page is a placeholder. No Constant Contact connector, list-view support, or metadata relationship browser exists. |
| Migrations | No migration files in the checkout; `.gitignore` excludes `prisma/migrations`. The live database has no `_prisma_migrations` table. Inspect the live schema, baseline it, and start tracking migrations before schema changes. |
| Local recovery completed | Corrected TypeScript module resolution and React Query mutation state; regenerated the Prisma runtime for this Mac. `tsc --noEmit --incremental false` passes. |
| Supabase | **Reconnected after the user resumed the paused project.** A complete read-only check succeeded using the saved settings: eight public tables, 1,577 contacts, one Salesforce token row, one sync job, and zero integration accounts. An initial interrupted connection recovered on retry. CLI has no management login. No database data/schema was changed. |
| Saved Salesforce environment | The saved token belongs to `mito--mito.sandbox.my.salesforce.com`, issued 9 November 2025. Its read-only identity request returned HTTP 404, so a working Salesforce connection is not established. Local OAuth settings currently point to the production login endpoint. Model environment per connection and deliberately authorize production rather than reusing the sandbox record. |
| Credentials | Replaced a credential-looking database URL in tracked `.env.example` with placeholders and documented `DIRECT_URL`. If that credential was real or reused, rotate it; changing the example does not erase earlier copies/history. |

### Supabase recovery runbook

The user resumed the project during this assessment and the connection now passes. Steps 1–3 are complete for the local checkout; schema baselining and deployed-environment validation remain.

1. Open [the existing project](https://supabase.com/dashboard/project/uiyanabcurejleftfbod) and inspect status. Resume it if paused and restorable. If the project is missing or outside the restoration window, recover the available backup into a replacement project rather than assuming the old data is accessible.
2. Copy current transaction/session pooler URLs from **Connect** into local `.env`; URL-encode the database password. Keep the app runtime URL separate from the migration connection. Do not post secrets in chat or commit them.
3. Run `node scripts/check-database.cjs`. This performs read-only checks and prints table names/counts, not contacts or tokens.
4. Inspect schema, existing data, access policies, and migration history. Take a recoverable backup before applying additive migrations. Do not run `db push`, reset, or an initial migration against an unknown existing database.
5. Confirm the deployment's secret configuration separately. A local `.env` repair does not reconnect a deployed app.

Supabase documents restoration options for paused projects in [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing) and [backup restoration after an extended pause](https://supabase.com/docs/guides/troubleshooting/restore-project-after-90-days-pause). Use the status shown in the dashboard to choose the recovery path.

## Salesforce production connection and deployment

**Recommendation: create a Local External Client App directly in production for this internal integration.** Use a dedicated integration identity whose license, object/field permissions, and report-folder access support the actual reports. The app runs outside Salesforce; a Salesforce package is not necessary for a single-org deployment.

Salesforce restricts creation of legacy Connected Apps as of Spring ’26 and recommends External Client Apps for new integrations. Existing Connected Apps can still work; first establish whether the saved client exists in production. See [Salesforce's authorization guidance](https://developer.salesforce.com/docs/platform/api-rest/guide/intro-oauth-and-connected-apps.html).

Connection setup:

1. Create the production External Client App and register exact callback URLs. Use a stable HTTPS deployment URL; configure localhost only for development as permitted by the org.
2. Use server-side authorization code flow with PKCE, state, and the API/refresh-token scopes. Store secrets server-side and encrypt tokens at rest.
3. Authorize an appropriately licensed integration user. Initially give it read access to selected objects/fields and report folders; add update permission only for the chosen Contact unsubscribe field when writeback is enabled. Verify report execution using that identity.
4. Store org ID, user ID, instance URL, login/My Domain URL, environment, scopes, token expiry, refresh status, and connection owner. Key jobs by connection ID, independently of a browser session.
5. Show the actual org identity and production/sandbox status before enabling sync. Reauthorization to a different org must not reuse existing record links or jobs silently.
6. Add bounded refresh retries, a per-connection refresh lock, atomic credential updates, and a visible reconnect state when authorization is revoked. Redact HTTP headers and OAuth payloads from logs.

**Why sandbox refresh broke the connection:** local External Client Apps are not copied when a sandbox is cloned/refreshed. Salesforce says packaged ECAs are copied. The previous app's exact type has not been verified, so this is an explanation of the current platform behavior, not a confirmed diagnosis of the original failure. See [External Client Apps](https://help.salesforce.com/s/articleView?id=xcloud.external_client_apps.htm&language=en_US&type=5).

**When to package:** if reusable installation across orgs or sandbox provisioning is needed, use a managed package, preferably 2GP, created from a persistent development org, with the ECA and suitable permission metadata. Keep global OAuth secrets outside the package and configure subscriber policies. Packaging distributes app configuration; do not assume it preserves authorization tokens after refresh. Maintain separate production/test connections and reauthorize/revalidate restored sandboxes. [Salesforce packaging guidance](https://help.salesforce.com/s/articleView?id=sf.configure_packageable_external_client_apps.htm&language=en_US&type=5).

For unattended operation, stored refresh-token authorization is sufficient for the first release. Evaluate JWT bearer or client credentials only if the org's operating model requires them; they still require an app registration and permitted integration identity.

## Sources and related-object mapping

Separate **who belongs in a list** from **which data accompanies them**:

`Saved SOQL / Campaign / list view / report → stable Contact IDs → related-field queries → mapping preview → Constant Contact`

### Saved SOQL and Campaign sources

- Implement saved, versioned Contact queries with validation, metadata autocomplete, preview, schedule, and target-list selection first. Keep audience selection independent of field enrichment so a mapping change does not require editing every query.
- Use fully paginated REST queries initially; add Bulk API 2.0 for large compatible queries after measuring actual sources. Bulk and REST are execution methods for SOQL, not different audience definitions.
- Add a Campaign picker with explicit member-status filters and Contact resolution. Campaign membership is maintained separately in Salesforce; the app reads it and does not write Campaign records or statuses in this scope.
- Begin with complete scheduled membership snapshots and only write changed output to CC. Optimize Salesforce reads incrementally only after tracking relationship dependencies, deletions, and time-based criteria. Watching Contact changes alone is insufficient.

### Report sources

- Prefer **saved report criteria → SOQL** for supported report definitions. Read `/analytics/reports/{reportId}/describe`, resolve fields and report-type relationships, compile all membership-affecting filters/scopes into a validated query plan, and extract through the query API. The saved report definition remains editable in Salesforce. See the detailed translator design in [the source plan](salesforce-audience-sources.md#saved-report-criteria--soql).
- Implement an explicit supported subset and block unsupported semantics; report metadata does not supply a guaranteed complete underlying SOQL query. Cache versioned definitions, retranslate supported edits, and offer independent SOQL for exceptions. Validate equivalence using complete unique Contact-ID sets under the same identity/time context.
- The following raw-report extraction requirements apply to compatibility reads and translator validation; they are not limits on a separately executed generated SOQL query.
- Retain report search, folders, preview, and IDs; add pagination/discovery beyond the current 50-result query.
- Require a reliable Contact ID in supported report detail rows. Reports based on another object must explicitly select a relationship to the contact. Do not identify contacts using display names.
- Parse raw cell values and metadata, preserve report-only formula/bucket values separately, and deduplicate rows by Salesforce identity with a declared rule for conflicting report values.
- The Reports REST API returns only the first **2,000 rows**. An asynchronous report run does not remove this limit. Check `allData`, supported report format, detail availability, and complete extraction before any membership reconciliation. [Report API limits](https://developer.salesforce.com/docs/analytics/salesforce-analytics-rest-api/guide/sforce-analytics-rest-api-limits-limitations.html).
- For larger reports, use a supported extraction strategy: disjoint filter partitions only where completeness can be proved, or an explicitly reviewed equivalent SOQL source. Complex cross-filters, formulas, and joined reports must not be silently translated. If equivalence cannot be verified, mark the source unsupported and offer an actionable alternative.
- Prove large-report support against the actual Cazoomi sources before cutover. A report that happens to return 2,000 rows is not evidence of complete membership.

### List-view sources

- Browse Contact list views visible to the integration user. Read the selected view's Describe metadata and SOQL; execute with REST query pagination where supported, following every `nextRecordsUrl`.
- Revalidate visibility, view definition changes, and query support on refresh. Do not infer membership from the first screen of list-view results or silently remove a semantic limit.
- Keep unsupported/special views visibly blocked. Validate results against the same user's Salesforce view.
- Salesforce exposes the view's query through [List View Describe](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-listviewdescribe.html), and its [query APIs support retrieving subsequent pages](https://developer.salesforce.com/blogs/2024/04/accessing-object-data-with-salesforce-platform-apis).

### Field browser: a first-release requirement

Use object Describe metadata to build a searchable tree of fields and relationships. Discover API names and relationship names from metadata, rather than constructing them from labels. Respect the integration user's accessible fields and validate saved mappings after schema/permission changes. [Salesforce Describe metadata](https://developer.salesforce.com/docs/platform/api/guide/sforce-api-calls-describesobjects-describesobjectresult.html).

Example paths, illustrative until the real org schema is connected:

| Selection in the UI | Extraction/mapping behavior |
| --- | --- |
| Contact → Email | `Contact.Email` → email address |
| Contact → Account → Membership tier | `Contact.Account.Membership_Tier__c` → selected CC custom field |
| Contact → custom lookup → Region | Follow the discovered `__r` relationship and use its custom field |
| Contact → Owner → Name | Resolve the actual reference target/type and extract the owner's name |
| Contact → Memberships → Expiry | Require a filter plus a selection rule, e.g. active membership with latest expiry |
| Contact → related purchases → Amount | Aggregate, e.g. sum qualifying purchases, then format for the target field |

Parent/lookups usually yield one value. Child/junction relationships yield many records and require an explicit filter, aggregation, or deterministic selection: latest with a tie-breaker, maximum/minimum, count, sum, or sorted distinct join. Handle missing relationships explicitly. Bound depth and query cost; fetch related records in batches rather than one request per contact. Follow all child-query pages where relevant.

Each mapping stores source API path, cardinality, selection/aggregation, transform, null policy, target field ID/type, and validation version. Offer labels alongside API names, sample values, date/time formatting, picklist translations, and clear length/type errors. Default a missing value to “leave destination unchanged”; clearing is a separate explicit choice.

CC contact fields are account-wide, not list-specific. If two sync definitions map different values to the same CC field for the same person, enforce a declared source priority or block the conflict. Never let run order decide the value.

## Constant Contact connector and settings

### Salesforce settings

Connect/reconnect/disconnect, environment and org identity, callback instructions, credential configuration through a secure server-side path, connection/permission test, metadata refresh, API usage, last successful access, and unsubscribe writeback field/permission validation. Disconnect pauses dependent jobs while retaining audit history.

### Constant Contact settings

OAuth setup and callback instructions, connect/reconnect/disconnect, account identity, scopes, refresh health, API budget, custom-field catalog, list catalog, and a read-only connection test. Store secrets encrypted and display masked state only. Use server authorization and `contact_data`/`offline_access` scopes; add account scopes only when needed for the identity endpoint. CC currently starts newly created applications with private access for the creator; register with the intended account user and verify access. [OAuth overview](https://developer.constantcontact.com/api_guide/oauth2-authorization/auth-overview).

Refresh tokens must be handled using the actual app's token policy. Serialize refreshes and atomically save any replacement refresh token; revoked credentials pause jobs and trigger reconnect instructions.

### Lists and fields

- Browse, create, rename, and select lists in the app through the CC API. Store remote IDs and refresh cached names.
- Browse/create supported custom fields, map by ID, validate type/value constraints, and detect deleted/recreated target fields. Current documentation describes up to 100 account custom fields and multiple types; capability-test the account/API schema rather than hardcoding the older text/date-only model. [Custom fields](https://developer.constantcontact.com/api_guide/contact-custom-fields/custom-fields-overview).
- Expose add-only versus managed-membership reconciliation per sync. Default existing adopted lists to add-only; explicitly establish the membership baseline/ownership before allowing removals.
- Support several sources feeding one list as a union. Remove a member only when no active source still requires that app-managed membership. Keep unrelated lists intact and preserve subscriber list-preference changes observed in CC.
- Use dedicated add/remove membership activities. Treat “remove from this list,” “unsubscribe from all mail,” and “delete contact” as distinct operations.
- CC documents a maximum of 1,000 lists/account and 50 memberships/contact. Surface capacity errors before a run. [List API overview](https://v3.developer.constantcontact.com/api_guide/contact-lists/lists-overview).

### Unsubscribe settings and invariants

| Setting | Initial behavior |
| --- | --- |
| Write Constant Contact unsubscribes to Salesforce | On once the mapping and update permission are validated; user can switch off |
| Salesforce destination | `Contact.HasOptedOutOfEmail` proposed; selectable compatible field if the org uses a custom consent model |
| Other inbound field updates | Disabled and outside the first release |
| Create Salesforce records | Disabled and outside the first release |
| Re-subscribe automatically | Never performed by sync |
| When unsubscribe retrieval fails | Pause outbound runs until consent state can be refreshed |

Turning off Salesforce writeback does **not** disable local suppression or allow re-subscription. Mark opted-out contacts locally before queuing Salesforce updates; failed writes are retried and visible. Write `true` only for confirmed global opt-outs; never clear the field automatically on later CC state changes. Restrict writeback to validated record links, and quarantine ambiguous matches. A bounce or removal from one list is not a global unsubscribe.

Always honor existing Salesforce opt-out flags when selecting outbound eligibility. Any future propagation of Salesforce-side unsubscribe requests to CC must carry correct consent provenance; an administrator's import is not a subscriber sign-up action.

Poll changed CC contacts with `updated_after`, requesting relevant statuses/subresources and following pagination. Persist changes durably before advancing the watermark; use an overlap window and idempotent processing to cover timestamp boundaries. Begin with a full suppression baseline and periodically reconcile it. Do not depend on contact webhooks: the documented partner webhooks concern billing events. [CC sync guidance](https://developer.constantcontact.com/api_guide/contacts/contacts-sync), [partner webhooks](https://developer.constantcontact.com/api_guide/partner_webhook_overview.html).

Fetch current contact state before changing it. CC `PUT /contacts/{id}` overwrites omitted core fields with null, while omitted subresources are preserved. Preserve unmanaged core values and merge any supplied subresource; never send an incomplete contact replacement. Avoid the sign-up-form endpoint for routine CRM imports, and preserve actual permission state. [Update semantics](https://developer.constantcontact.com/api_guide/contacts/contacts-put), [unsubscribe behavior](https://developer.constantcontact.com/api_guide/contacts/contacts-re-subscribe).

## Durable sync architecture

Retain Next.js for the admin UI/API and Supabase Postgres for persistent configuration/state. Use Supabase Auth for app sessions and workspace roles. Run syncs in a separate durable worker, with a Postgres job table and leases/checkpoints; a scheduler enqueues due work. Browser requests return a run ID quickly. Final worker hosting depends on measured volume and available deployment infrastructure.

Keep connector credentials in a private server-only store with encrypted token fields. Use RLS for browser-accessible tables and explicit workspace checks for Prisma/server routes; a privileged database connection does not gain user isolation automatically. Keep encryption keys outside the database, with a documented rotation path.

Proposed additive model (names illustrative):

| Entity | Purpose/key |
| --- | --- |
| Workspace, Membership | Authenticated administrators/operators and role checks |
| Connection, Credential | Provider/account/org/environment, health, encrypted credentials |
| SourceDefinition | Source kind, saved SOQL/version or Campaign/report/list-view identifier, typed parameters, contact resolution, dependencies, definition hash |
| SyncDefinition | Source(s), target list, schedule, mode, field-map version |
| FieldMapping | Typed source paths, transforms, priorities, target IDs |
| ContactIdentity | Unique Salesforce connection + object type + 18-character record ID |
| RemoteContactLink | CC connection/contact ID, linked source identity, normalized email history |
| SourceSnapshot, SourceMembership | Complete source run and stable membership sets |
| ManagedMembership | Which definitions require each remote membership; baseline/manual exclusions |
| Suppression, ConsentEvent | Provider opt-out state, provenance, local enforcement, Salesforce writeback status |
| SyncRun, SyncItem, RemoteActivity | Checkpoints, payload hashes, attempts, remote async IDs, outcomes |
| SyncCursor, AuditEvent | Durable inbound watermarks and attributable configuration/run changes |

Resolve existing CC contacts by verified email during initial linking, then retain provider IDs. Use normalized email for matching, not the sole durable Salesforce key. Detect duplicate emails across Salesforce contacts, address changes, merges, and collisions. Quarantine ambiguous conflicts; do not create duplicate CC contacts or silently merge CRM people. Report-linked legacy rows may need reimport because current records lack reliable identity.

Run sequence:

1. Acquire a lease, freeze source/mapping versions, and verify both connections.
2. Import CC preference/consent changes and durably queue any unsubscribe writeback.
3. Extract source membership fully into a staging snapshot; validate completeness and count changes.
4. Enrich related fields; validate types, identities, consent, target capacity, and mapping conflicts.
5. Compute previewable create/update/add/remove/skip/error operations with payload hashes.
6. Execute bounded batches under a shared API-key rate limiter. Track CC async activity IDs, poll final status, and inspect item failures. An accepted request is not a completed sync.
7. Reconcile owned membership only from a complete snapshot, with configurable large-removal thresholds and review before applying surprising removals.
8. Verify outcomes, persist checkpoints/results, and release the lease. Retry only retryable work; resume after a crash without repeating confirmed operations.

CC's published default budget is 4 requests/second and 10,000/day per API key; verify the actual app allocation. Batch imports/memberships where payload semantics preserve data, back off on 429/5xx, and defer when the daily quota is exhausted. Share limits across workers. [Rate-limit documentation](https://qa.developer.constantcontact.com/api_guide/getting-started/rate-limits).

Use idempotent local operation keys and reconciliation after uncertain network outcomes. Do not assume the remote API supports arbitrary idempotency headers. Prevent concurrent writers to the same account/contact and coalesce compatible changes. Settings edits affect subsequent runs, and pause/cancel actions leave completed work and audit evidence intact.

## Delivery order and acceptance gates

| Phase | Deliverable | Acceptance gate |
| --- | --- | --- |
| 0. Reconnect and inventory | Recover Supabase, inspect old schema, inventory Cazoomi sources/mappings/schedules/consent behavior, stabilize runtime | Read-only DB check passes; actual report sizes and required related paths recorded; backup and migration baseline available |
| 1. Connections and security | Supabase Auth, workspace authorization, encrypted credentials, production Salesforce and CC settings | Correct org/account shown; report execution and CC reads succeed; refresh/revoke/reconnect tested; unauthenticated routes denied |
| 2. Source and mapping preview | Saved SOQL, supported report-metadata translation, Campaign/list-view adapters; completeness checks, related-field browser, mapping editor | Representative contacts/relationships match Salesforce; translated report membership matches complete reference sets; >2,000-row extraction verified; preview performs no provider writes |
| 3. Manual outbound sync | CC list/field creation, stable contact linking, queued jobs, membership ownership and run history | Repeat run is a no-op where unchanged; multi-source union and unmanaged fields/lists preserved; activity failures visible |
| 4. Unsubscribes and scheduling | Configurable writeback, inbound polling, retries/checkpoints, quota control, pause/alerts | Opt-outs remain suppressed through reimport; disabled writeback does not clear suppression; crash/retry/token expiry tests pass |
| 5. Cazoomi cutover | Shadow comparison, small pilot, per-list migration and recovery runbook | Selected workflow parity verified, differences resolved, old writer stopped before new writer enabled, sustained successful scheduled runs |

Tests must cover grouped report parsing, truncated/failed sources, duplicate Salesforce rows and email collisions, missing related records, deterministic child selection, deleted fields/permission changes, conflicting field ownership, null policies, expired/revoked tokens, rotating refresh tokens, API throttling, async partial failure, and worker interruption.

Especially test: the same contact in two sources for one list; removing it from only one source; CC list-preference changes; global unsubscribe versus bounce/list removal; unsubscribe writeback failure; email change after suppression; and a source suddenly returning zero rows. No incomplete or failed extraction may erase destination memberships.

### Cutover and recovery

Inventory the actual Cazoomi configuration and capture existing CC list IDs, field IDs, counts, mappings, unsubscribe behavior, and schedules. Compare full unique IDs/membership sets and mapped sample values, not counts alone. Keep CC-owned preferences intact when adopting lists.

Run previews/shadow comparisons while Cazoomi remains the writer. Pilot a separate test list with controlled contacts, checking any list-triggered automations before import. At cutover, stop Cazoomi writes for each migrated workflow before enabling ForceMultiplier writes to that list. Keep its configuration/export until scheduled runs and reconciliation establish parity. Do not cancel the service as part of planning.

Recovery means pause new jobs, inspect the operation ledger, repair/reconcile affected memberships or fields, and resume the previously configured writer only after confirming it will honor current suppression. Do not automatically roll back consent changes or blindly reverse remote writes that may have been edited since.

## Outstanding inputs

- Supabase database access is restored; management login is still needed if we need to automate backups or project settings.
- Production Salesforce domain and an administrator able to register/authorize the integration app; existing client validity is unverified.
- CC developer application/account authorization. No CC credentials are configured in this checkout.
- Approximate contact volume, sync/list count, cadence, and deployment host.
- Two or three representative SOQL audiences or existing Campaign/report/list-view sources and required related-object paths, including any reports over 2,000 rows.
- Whether standard Contacts cover the audience, and whether `HasOptedOutOfEmail` is the correct writeback destination.

Next concrete implementation milestone: baseline the restored database and deliver both authenticated connection settings pages with read-only identity, permission, and metadata checks. Build source/mapping previews before enabling contact writes.
