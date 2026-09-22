# Historical email archive and template import strategy

Updated 22 September 2026. This is the priority migration track in the [platform plan](email-marketing-platform-plan.md). The archive records **the campaign content and send history**; the editable library answers **what can be reused to create a new email**. Keep these as separate records. Constant Contact's preview does not resolve per-recipient dynamic content, so the archive must not claim to reconstruct each recipient's exact copy.

## Preserve sent emails first

Import each sent Constant Contact campaign activity as an immutable archive item with its source account, campaign ID, activity ID, name, subject, preheader when available, sender/reply-to, sent time, original HTML, plain text or extracted searchable text, source permalink, and import time. Store the original HTML as an object and a SHA-256 hash so a rerun can prove whether a source changed. Keep campaign-level send/report totals and any source list names/IDs as historical metadata when available; do not copy recipient memberships into the archive or create corresponding Resend segments. Use `account ID + campaign activity ID` as the unique import key and checkpoint each page and activity so imports can resume without duplicates.

Constant Contact documents a paginated [`GET /v3/emails`](https://developer.constantcontact.com/api_guide/email-campaigns/email-campaigns-collection), campaign activity IDs, [`GET /v3/emails/activities/{id}?include=html_content,permalink_url`](https://developer.constantcontact.com/api_guide/email-campaigns/email-campaigns-activity-id), [HTML previews](https://developer.constantcontact.com/api_guide/email-campaigns/email-campaign-activity-preview), and [send history](https://developer.constantcontact.com/api_guide/email_campaigns_sends_history.html). The campaign endpoints require `campaign_data` and `campaign:read`. The connected account now has working read access. The archive importer itself is still planned.

## Read-only pilot findings

On 22 September 2026, a complete seven-page campaign listing returned **3,185 unique campaigns**: 3,130 Done, 37 Draft, and 18 Initializing, with updates spanning 2018–2026. The listing contained 3,161 newsletters, 15 A/B tests, 8 custom-code emails, and 1 contacts-resubscribe record. These are campaign counts, not the number of sent activities or reusable templates. Only sent activities belong in the historical archive.

Sampled sent activities from a 2018 newsletter (format 3), a 2018 custom-code email (format 5), a recent newsletter (format 4), and a recent A/B test returned `html_content`, `preview_html_content`, a permalink, and `send_history.run_date`. The A/B test had both `experimental_email` and `primary_email` activities marked Done, each with send history. Source HTML and preview HTML differed in length; store both and label their roles. An early listing showed a custom-code Draft, so campaign type alone must not decide eligibility. The API's next-page link reset `limit` to 50 even when the first request used 500; pagination must follow the returned cursor to completion and deduplicate by source ID.

Next compare representative archive copies with their Constant Contact web versions at desktop and mobile widths. Some activities may not expose usable HTML; record per-item completeness instead of silently treating a permalink as a full copy. If API access or source HTML is unavailable, accept a manual HTML file and metadata import for those exceptions. Keep a manifest of imported, missing, and reviewed campaigns before cancelling Constant Contact.

Archive previews must be safe to open: keep the untouched source HTML as the evidence copy, but create a separate preview that disables scripts, links, forms, and tracking requests. Mirror required image assets to stable managed storage where permitted, with an asset manifest and import warnings for images that cannot be fetched. Search by campaign name, subject, sent date, category, and extracted text; browse a thumbnail or safe preview. Restrict raw HTML download to trusted administrators. Do not confuse an old template ID with the exact content of a sent campaign.

## Turn selected examples into editable templates

Start with a small set of representative, high-value past emails and a clean brand base template. Use Templatical's [`@templatical/import-html`](https://docs.templatical.com/guide/migration-from-html) to make an **editable copy** of an archived HTML item, retain its conversion report, and review every approximated, fallback, or skipped block. Conversion is a starting point, not proof of visual or functional fidelity; Templatical documents HTML fallback blocks for layouts it cannot decompose. Compare the converted email with the archived original at desktop and mobile widths, check links, images, merge tags, footers, and text version, then send a test to internal addresses before publishing it. The archive item stays unchanged and linked as the source of the editable copy.

The reusable library stores Templatical JSON, a stable template ID, name/category/tags, author, draft revisions, one published revision, rendered HTML/text for that revision, and an optional source archive ID. A new campaign pins an immutable published revision; later edits create another revision. The archive can contain many one-off campaigns without forcing every old email into the editor. This lets staff browse history immediately while converting only designs worth reusing.

## Implementation order and gates

| Step | Deliverable | Acceptance check |
| --- | --- | --- |
| 1. Access and pilot | `campaign_data` authorization and representative read-only sample completed; visual comparison remains | A representative sample matches the Constant Contact web view; missing fields are listed |
| 2. Archive | Additive archive metadata table, private object storage, resumable read-only import, safe preview, search, and completeness manifest | Re-running import creates no duplicate; old HTML survives source unavailability; previews cannot trigger old links or tracking |
| 3. Editable library | Templatical editor, revisions, render/test pipeline, selective HTML conversion with review report | A copied example can be edited and test-sent without altering its archive source; published revision stays fixed |
| 4. Cutover evidence | Import manifest, sample visual checks, retained asset status, backup/export, and owner sign-off | Required historical campaigns are accessible after Constant Contact is retired |

No sending to marketing audiences depends on importing old recipient lists. Historical campaign content and previous unsubscribe/suppression state are the Constant Contact data that must be carried forward. If Funraisin's past automated emails also belong in the archive, assess their available export/API separately; their source and send semantics differ from Constant Contact campaigns.
