# Salesforce Report Sync Starter

This project scaffolds a beginner-friendly SaaS-style dashboard that connects to Salesforce, lists available
reports, previews them, and syncs contact-style data into Supabase using Prisma. Everything is written in
TypeScript on top of the Next.js 15 App Router and styled with Tailwind CSS.

The goal is to help you understand the full flow end-to-end:

1. Authenticate with Salesforce via OAuth 2.0 (web server flow).
2. Browse and filter reports from your Salesforce org.
3. Preview a report, then sync the rows into Supabase.
4. View synced contacts in a dedicated dashboard page.

The codebase includes **generous comments, safe defaults, and explicit instructions** so you can follow along
without guessing.

---

## Quickstart Checklist

### 1. Create the project locally

```bash
npx create-next-app@latest salesforce-report-sync --typescript
cd salesforce-report-sync
```

> The repo already contains the generated structure, but running the command above locally ensures you have the
> right dependencies installed.

### 2. Install dependencies

```bash
npm install
```

The key dependencies are:

- `next@15` + `react@18` for the App Router setup
- `@tanstack/react-query` for data fetching and caching
- `@prisma/client` + `prisma` to talk to Supabase/PostgreSQL
- `axios` for Salesforce HTTP calls
- Tailwind utility components (see `components/ui/*`)

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in the blanks:

```bash
cp .env.example .env
```

| Variable | Why it matters |
| --- | --- |
| `DATABASE_URL` | **Required.** Paste the Supabase connection string (Project → Settings → Database). |
| `NEXT_PUBLIC_SUPABASE_URL` (optional) | Only needed if you call the Supabase client SDK from the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional) | Companion to the public URL above. |
| `SUPABASE_SERVICE_ROLE_KEY` (optional) | Only needed if you create admin-level Supabase server actions. |
| `SALESFORCE_CLIENT_ID` & `SALESFORCE_CLIENT_SECRET` | Created automatically when you set up the Salesforce Connected App that powers OAuth. |
| `SALESFORCE_REDIRECT_URI` | Must match the callback URL configured on that Connected App. |
| `NEXTAUTH_SECRET` | Placeholder for when you plug in NextAuth or another session library later. |

> ✅ Once the Connected App is configured, the OAuth flow will redirect you to the proper Salesforce login screen automatically—you do **not** need to hard-code any org-specific URLs beyond the optional sandbox override noted below.

### 4. Prepare Prisma + Supabase

1. Sign in to [Supabase](https://supabase.com/) and create a new project.
   - **Region:** pick the one closest to you for the best latency.
   - **Database password:** enter a strong password and store it somewhere safe—you need it for `DATABASE_URL`.
   - **Security options → Connections:** leave the default **Data API + Connection String** enabled. This gives you
     both the REST Data API and the standard Postgres connection string used by Prisma.
   - **Data API configuration:** choose **Use public schema for the Data API** (default). The starter app does not
     rely on a dedicated schema.
   - **Postgres type:** keep **Postgres (default)** selected. Avoid the OrioleDB preview for production workloads.
2. Once the project finishes provisioning, copy the **Connection string** and paste it into `DATABASE_URL` in `.env`.
3. Create the database tables:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

The Prisma schema defines three tables:

- `Contact`: stores synced contact data.
- `SalesforceToken`: stores OAuth access/refresh tokens per Salesforce user.
- `SyncJob`: keeps a basic history of sync attempts.

### 5. Run the dev server

```bash
npm run dev
```

Visit `http://localhost:3000` and click **Connect to Salesforce**.

> If you see an OAuth error, double-check your Connected App callback URL and the client secret value.

---

## File Structure Overview

```
app/
  layout.tsx              # Global layout, React Query + Toast providers
  page.tsx                # Landing page with "Connect to Salesforce"
  (dashboard)/            # Authenticated dashboard routes
    layout.tsx            # Sidebar + topbar wrapper
    reports/page.tsx      # Report search, filters, preview modal
    contacts/page.tsx     # Supabase-backed contacts table
    settings/page.tsx     # Future ideas + roadmap placeholder
  api/
    salesforce/
      login/route.ts      # Redirect to Salesforce OAuth
      callback/route.ts   # Handle OAuth callback & store tokens
      reports/route.ts    # List available reports
      report/route.ts     # Preview a single report
      sync-report/route.ts# Sync report data into Supabase
      identity/route.ts   # Fetch org/user identity for the UI
    contacts/route.ts     # Fetch synced contacts from Supabase
components/
  sidebar.tsx, topbar.tsx, report-preview-modal.tsx, query-provider.tsx
  ui/                     # Lightweight Tailwind-based UI primitives
lib/
  prisma.ts               # Prisma singleton client
  auth.ts                 # Cookie helpers + token persistence
  salesforceClient.ts     # Axios client with automatic token refresh
  reportMapping.ts        # Simple heuristics to map report rows to contacts
prisma/schema.prisma       # Database schema
```

---

## Step-by-Step Feature Guide

### 1. Salesforce OAuth Flow

1. **`/api/salesforce/login`** builds the authorize URL, saves a short-lived `sf_oauth_state` cookie, and redirects
   the browser to Salesforce.
2. **`/api/salesforce/callback`** validates the state, exchanges the code for tokens, fetches the identity profile,
   and stores the access/refresh tokens in the `SalesforceToken` table. A persistent `sf_user_id` cookie keeps
   track of the Salesforce user for subsequent API calls.
3. Every API route uses `ensureSalesforceClient()` (in `lib/salesforceClient.ts`). The client automatically refreshes
   expired access tokens using the stored refresh token.

If anything goes wrong, the user is redirected back to `/` with a query parameter such as `?error=oauth_failed`.

### 2. Browsing Salesforce Reports

- `/reports` uses React Query to call `/api/salesforce/reports` with optional search text and folder filters.
- The table displays name, folder, and last modified date.
- Clicking **Preview** opens `components/report-preview-modal.tsx`, which fetches the report details, displays the
  first rows, and offers a **Sync report** button.

### 3. Syncing to Supabase

- `/api/salesforce/sync-report` downloads the raw rows, converts each row into a contact-like object using
  `lib/reportMapping.ts`, and stores the results with Prisma.
- Existing contacts for that report are cleared before inserting new rows to keep the data fresh.
- Every sync inserts a row into the `SyncJob` table with the status and record count.

### 4. Viewing Synced Contacts

- `/contacts` queries `/api/contacts` (optionally filtered by `reportId`).
- The page shows a Tailwind-styled table with Name, Email, Company, Phone, and Synced Date columns.
- The filter dropdown is populated based on the report IDs present in the data set.

### 5. Helpful UI Details

- **Sidebar / Topbar**: Provide navigation and display the connected Salesforce org + user.
- **Toasts**: A lightweight toast system (`components/ui/toaster.tsx`) surfaces success/failure feedback.
- **Skeleton loaders**: `components/ui/skeleton.tsx` gives instant visual feedback while data loads.

---

## Common Gotchas & Tips

- **Refresh tokens**: Salesforce sometimes omits the refresh token on repeated authorizations. If that happens,
  reset OAuth authorizations for the connected app and try again.
- **Sandboxes**: Add `SALESFORCE_LOGIN_BASE_URL=https://test.salesforce.com` to `.env` if you need to connect to a sandbox org.
- **Data volume**: The sync route currently fetches everything in one go. For very large reports, consider using
  Salesforce’s `async` report APIs or pagination.
- **Authentication**: This starter relies on the Salesforce session cookie. In production you should add proper
  user authentication (NextAuth.js, Supabase Auth, etc.) and map Salesforce tokens to your application user IDs.
- **Deployment**: Deploy the Next.js app to Vercel and plug in the same environment variables (without the quotes).
  Supabase hosts your Postgres database, so no extra setup is required.

---

## Next Steps for You

1. **Run `npm run dev` and complete the OAuth flow.** Make sure you can see reports and sync contacts.
2. **Inspect the database** via Supabase to verify new rows appear in `Contact` and `SyncJob`.
3. **Customize field mapping** in `lib/reportMapping.ts` to better match your Salesforce schema.
4. **Add background jobs** (Supabase Edge Functions, Vercel Cron) for automatic nightly syncs.
5. **Layer in authentication** so only signed-in users can start a sync.

> 💡 Pro tip: Commit your `.env` file to a password manager, never to git. The `.env.example` in the repo is safe to
> share because it does not contain real secrets.

Happy building! If you get stuck, read through the inline comments and console logs—they are written with beginners
in mind.
