# ForceMultiplier

A private workspace for connecting Salesforce and Constant Contact, defining Salesforce audiences, pulling complete contact lists into Supabase, and sending reviewed snapshots to Constant Contact lists. This rebuild replaces the previous report-sync prototype.

## Available now

- Supabase Auth sign-in using users managed in the Supabase dashboard.
- Separate Salesforce and Constant Contact connection settings, OAuth callbacks, encrypted credentials, automatic token refresh, connection testing, and disconnect/reconnect.
- Audiences from Contact SOQL queries, Contact list views, Salesforce Campaign members, and supported standard Contacts report filters.
- A metadata field explorer for Contact custom fields and parent relationships, including custom lookups. Selected fields are fetched separately from audience membership.
- A 25-contact preview and resumable, paginated full pulls, including audiences larger than 2,000 records. Completed snapshots are saved in Supabase and remain visible during subsequent pulls.
- Constant Contact list browsing, member inspection, empty-list creation, and custom-field catalog browsing.
- Search across pulled contact names, email addresses, and Salesforce IDs.
- Resumable Constant Contact delivery of names, email addresses, and mapped custom fields, with destination-list selection, Salesforce opt-out filtering, consent confirmation, managed-membership reconciliation, provider activity checks, and per-contact issue reporting.
- Per-audience scheduled syncs that run hourly, daily, or weekly through a secured Vercel Cron worker, with time-zone-aware scheduling, retries, pause/resume, and run history.
- CSV-driven Constant Contact resubscription jobs that preserve contact details and list memberships, process at most 2,500 requested contacts per UTC day, and can optionally match and prioritize Salesforce Contact fields.
- Pull and delivery history with progress and recoverable errors.

**This milestone supports manual and scheduled delivery of names, email addresses, and selected custom fields.** Each schedule saves its destination and field mappings, including fields reached through parent relationships. Successful deliveries remove previously managed list members who are no longer eligible for the audience; they do not send unsubscribes back to Salesforce. Keep Cazoomi running until unsubscribe return updates and a comparison/cutover exercise are complete. The next sync phase will make unsubscribe-only return updates configurable.

## Start locally

Use Node.js 22.12+ or a supported newer LTS release.

For this existing workspace, dependencies, local secrets, and the private Supabase schema have already been prepared. Start with:

```bash
npm run dev
```

Open **http://localhost:3000** and sign in with a user created under **Supabase → Authentication → Users**. In **Authentication → Sign In / Providers**, disable new-user signup for this private workspace. Then open **Connections** and configure both apps. Always use the same hostname as `APP_URL`; `localhost` and `127.0.0.1` are different OAuth/cookie origins.

### Fresh installation

```bash
cp .env.example .env
# Fill in the database, project URL, and publishable-key values from Supabase Connect.
npm install
npm run setup
npm run db:deploy
npm run db:check
npm run dev
```

`npm run setup` generates a missing encryption key and targets the `forcemultiplier` PostgreSQL schema. It preserves existing keys. Back up `APP_ENCRYPTION_KEY`: replacing it makes saved app secrets and tokens unreadable. Provider application keys are entered in Connections and stored encrypted in the database; legacy `SALESFORCE_CLIENT_*` environment variables are unused.

### Supabase Auth

1. In the Supabase project, click **Connect**, choose the Next.js app/framework view, and copy the **Project URL** and **Publishable key** into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env`.
2. Open **Authentication → Users**, choose **Add user**, and create or invite the trusted user who will administer this workspace.
3. Open the Authentication configuration and turn off **Allow new users to sign up**. The app has no signup screen, but disabling it also closes the public Auth signup endpoint.
4. Restart `npm run dev`, then sign in at `http://localhost:3000`.

Use only the publishable key (normally `sb_publishable_...`). A Supabase secret or legacy service-role key is unnecessary and must not be exposed to this app. For Vercel, add the same two Auth variables plus `DATABASE_URL`, `DIRECT_URL`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`, and the hosted HTTPS `APP_URL` under the project’s Environment Variables. Redeploy after changing them.

## Connect Salesforce

1. In the production org, create an **External Client App** with OAuth enabled. Use the web-server authorization-code flow, require the client secret, and enable PKCE.
2. Add `api`, `openid`, and `refresh_token` / `offline_access` scopes. Add the exact callback displayed in Connections:
   `http://localhost:3000/api/oauth/salesforce/callback` for local use.
3. Put the consumer key and secret in Connections. Use `https://login.salesforce.com` or your production My Domain as the login URL. Save, then select **Connect account**.
4. Authorize a user with API access and read permissions for the intended Contacts, related objects, fields, reports, and list views. If the app uses admin-preauthorized policies, assign the appropriate access first.
5. Use **Test connection**, then create a SOQL audience and preview it.

Use `https://test.salesforce.com` or the sandbox My Domain for a sandbox. A refresh still requires reauthorization; production configuration avoids coupling the real integration to sandbox refreshes. Each audience is bound to its original org. Disconnect explicitly before switching orgs or application credentials.

The new app does not deploy Salesforce objects or Apex. A package is unnecessary for this milestone. ECA metadata and permission sets can be versioned/deployed later if you need installation across multiple orgs.

[Salesforce External Client Apps](https://developer.salesforce.com/docs/platform/external-client-apps/guide/eca-intro.html)

## Connect Constant Contact

1. Create an application in the [developer portal](https://app.constantcontact.com/pages/dma/portal/).
2. Register the exact callback from Connections:
   `http://localhost:3000/api/oauth/constant-contact/callback` for local use.
3. Save its API key/client ID and client secret in Connections, then select **Connect account**. The app requests `contact_data`, `account_read`, and `offline_access`.
4. Open **Constant Contact lists** to browse lists and members, inspect custom fields, or create an empty destination list. List creation immediately creates a real list in the connected account.

New private apps must be authorized by their creator; follow Constant Contact's public-app process if other account users need to authorize your app. Refresh tokens rotate and are stored after each refresh.

[Constant Contact authorization-code flow](https://developer.constantcontact.com/api_guide/server_flow.html)

## Run a resubscription job

Open **Resubscriptions** and upload a CSV with an `Email` or `Email Address` column. Choose the Constant Contact list that each successfully restored contact should join. Optional Salesforce filters match Contacts by email, require a selected field to have a value, and require an amount field to exceed a threshold; amount-filtered jobs process the largest values first.

After review, start the job. The secured worker performs an exact-email GET, skips contacts that are already subscribed or unsubscribed after the job was created, then PUTs the preserved core contact values with `update_source=Contact`, explicit permission, and all existing list memberships plus the selected list. All jobs sharing the Constant Contact application are capped at 2,500 contact attempts and 5,000 worker API calls per UTC day. A PUT whose outcome cannot be confirmed is flagged for manual review and is never automatically repeated.

## Build and pull an audience

A typical query is:

```sql
SELECT Id
FROM Contact
WHERE Email != null
  AND HasOptedOutOfEmail = false
  AND Account.BillingState = 'NSW'
```

Select related/custom fields through the explorer, such as `Account.Name` or a custom parent lookup's field. Save the audience and select **Pull audience**. The browser advances one page at a time; keep the page open. Closing the page stops further requests after the in-flight page. Resume from the audience page. If Salesforce expires a query cursor, cancel and start a new pull.

After a complete pull, search the saved snapshot by name, email address, or Salesforce ID. Select **Send to a list**, choose the Constant Contact destination, and confirm that the eligible contacts have permission to receive email. The delivery excludes Salesforce email opt-outs, missing emails, and invalid emails. Constant Contact's JSON import creates or updates contacts by email, preserves existing contacts' email permission state, and adds eligible contacts to the selected list. New contacts receive Constant Contact's default implicit permission, so do not send purchased, borrowed, or otherwise unconsented addresses. Deliveries are chunked, tracked, and resumable; keep the page open while it advances, or use **Resume delivery** later.

Delivery history separates locally excluded Salesforce rows from Constant Contact failures. Expand **issues** to see the contact, email address, reason, field-validation message, and Constant Contact opt-out reason when available. Provider activity summaries alone do not identify every rejected address, so ForceMultiplier also verifies which submitted addresses reached the destination list and checks the Constant Contact permission state for the first 25 failures in each delivery.

Contact-level issue details are retained for 90 days, then a daily secured Vercel Cron job deletes the names, email addresses, Salesforce IDs, and diagnostic text. Aggregate delivery totals and statuses remain available for long-term operational reporting.

Existing ForceMultiplier delivery history is used to establish the managed-membership baseline. If no prior delivery exists, the first successful delivery establishes that baseline and does not remove anyone. Later manual and scheduled deliveries remove only contacts that this audience previously managed and that no longer qualify, including Salesforce opt-outs and invalid or changed email addresses. Other members already on the Constant Contact list are preserved, and contacts are removed only from this list—not deleted from Constant Contact or unsubscribed. A Constant Contact list can be managed by only one audience, which prevents two audience filters from removing each other's members.

Select **Schedule sync** on an audience to choose the destination list, custom-field mappings, and a daily, weekly, or 1–168 hour recurrence. Scheduled times use the saved IANA time zone and account for daylight-saving changes. Vercel calls the secured worker once per minute; database leases prevent overlapping runs, and interrupted provider work resumes with backoff. Add the locally generated `CRON_SECRET` to Vercel Production environment variables before saving a schedule.

Supported queries have `Contact` as the root, include `Id`, and select scalar or parent fields. Semi-joins can select Contacts through Campaigns or child/custom objects. Mutating clauses, aggregates, child subqueries in the SELECT list, and OFFSET are blocked. If intentionally using LIMIT, also use a deterministic ORDER BY with an Id tie-breaker. Membership is deduplicated by Salesforce Contact ID, and outbound membership is reconciled by normalized email address.

Saved reports and list views are re-resolved before each new pull. The run records the query it actually used. Report translation supports the standard `ContactList` report type and custom report types rooted on Contact whose additional objects are optional joins, with organization-wide scope, All Time date range, and supported Contact/Account scalar filters and boolean logic. Required child joins, cross-filters, summary filters, relative dates, hierarchy scope, ambiguous field mappings, and unsupported operators require an independent reviewed SOQL query. Unsupported criteria do not silently disappear. Report extraction uses paginated SOQL, not the report-results API's 2,000-row response.

Current limits: 30 additional fields, four parent relationship hops, Contact records only, 150,000 records per manual pull. Polymorphic relationships and child-to-one reductions require reviewed SOQL/aggregation design. Fields follow the connected user's visibility. Salesforce records can change while a multi-request pull is running; a completed pull means all query-result pages were received, not a transactionally frozen Salesforce database.

## Database and operational notes

- Prisma connects server-side to Supabase PostgreSQL. Supabase Auth uses the browser-safe project URL and publishable key; no secret or service-role key is required.
- New tables live in the private `forcemultiplier` schema, with RLS enabled and schema/table privileges revoked from public API roles. Do not expose this schema through the Supabase Data API.
- The old `public` tables and their data remain as a rollback/reference archive. This app neither uses nor migrates their rows or old OAuth tokens.
- Use `npm run db:deploy`, which checks both URLs target the private schema. Do not run `prisma migrate reset` on the existing project.
- OAuth state is session-bound, expires, and is consumed once. Tokens/client secrets are encrypted with AES-256-GCM. Mutations require the configured origin. Token refresh, pull processing, deliveries, and scheduled runs use database leases.
- The app is a single-workspace deployment. Every enabled Supabase Auth user can administer it, so keep public signup disabled and create only trusted users.
- Pull snapshots are retained until a future retention feature is added. Monitor database size during large repeated pulls.
- A hosted deployment needs HTTPS `APP_URL`, persistent environment secrets, exact hosted OAuth callbacks, and a Node runtime. The included Vercel Cron job requires a Pro plan for its once-per-minute frequency and a Production `CRON_SECRET` environment variable.

## Verification

```bash
npm test
npm run typecheck
npm run build
npm run db:check
# With the local app running and Chrome installed:
npm run test:smoke
```

Unit tests cover OAuth state/replay/rotation, disconnect races, query restrictions, filter translation, encryption, pagination beyond 2,000, interrupted/truncated pulls, and outbound eligibility mapping. The browser smoke test verifies the login/configuration state without credentials. Set `SUPABASE_SMOKE_EMAIL` and `SUPABASE_SMOKE_PASSWORD` temporarily to include signed-in desktop/mobile pages and protected APIs. It never authorizes or writes to either provider. End-to-end provider authorization, Constant Contact imports, and org-specific report comparisons still require your real app credentials.

See [the overall replacement plan](docs/cazoomi-replacement-plan.md) and [Salesforce source design](docs/salesforce-audience-sources.md) for subsequent phases. Those documents describe the longer-term design; the implemented scope above is authoritative for this release.
