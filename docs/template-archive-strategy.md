# Historical email archive and template import strategy

Updated 22 September 2026. This is the priority migration track in the [platform plan](email-marketing-platform-plan.md). The archive answers **what was actually sent**; the editable library answers **what can be reused to create a new email**. Keep these as separate records.

## Preserve sent emails first

Import each sent Constant Contact campaign activity as an immutable archive item with its source account, campaign ID, activity ID, name, subject, preheader when available, sender/reply-to, sent time, original HTML, plain text or extracted searchable text, source permalink, and import time. Store the original HTML as an object and a SHA-256 hash so a rerun can prove whether a source changed. Keep campaign-level send/report totals and any source list names/IDs as historical metadata when available; do not copy recipient memberships into the archive or create corresponding Resend segments. Use `account ID + campaign activity ID` as the unique import key and checkpoint each page and activity so imports can resume without duplicates.

Constant Contact documents a paginated [`GET /v3/emails`](https://developer.constantcontact.com/api_guide/email-campaigns/email-campaigns-collection), campaign activity IDs, and [`GET /v3/emails/activities/{id}?include=html_content,permalink_url`](https://developer.constantcontact.com/api_guide/email-campaigns/email-campaigns-activity-id). The campaign endpoints require `campaign_data` and `campaign:read`. An earlier read-only campaign probe returned **403** under the old scope. The app now requests `campaign_data` alongside its existing scopes and offers Reauthorize and Check campaign access on Connections. Reauthorize the same account without disconnecting; verify campaign access before the read-only archive pilot. The archive importer itself is still planned.

First run a **small read-only pilot**: list a few sent campaigns, retrieve their primary activity, confirm the actual HTML and sent-time fields available for this account, inspect one newsletter and one custom-code email, and compare them with their Constant Contact web versions. Some activities may not expose usable HTML. Record per-item completeness instead of silently treating a permalink as a full copy. If API access or source HTML is unavailable, accept a manual HTML file and metadata import for those exceptions. Keep a manifest of imported, missing, and reviewed campaigns before cancelling Constant Contact.

Archive previews must be safe to open: keep the untouched source HTML as the evidence copy, but create a separate preview that disables scripts, links, forms, and tracking requests. Mirror required image assets to stable managed storage where permitted, with an asset manifest and import warnings for images that cannot be fetched. Search by campaign name, subject, sent date, category, and extracted text; browse a thumbnail or safe preview. Restrict raw HTML download to trusted administrators. Do not confuse an old template ID with the exact content of a sent campaign.

## Turn selected examples into editable templates

Start with a small set of representative, high-value past emails and a clean brand base template. Use Templatical's [`@templatical/import-html`](https://docs.templatical.com/guide/migration-from-html) to make an **editable copy** of an archived HTML item, retain its conversion report, and review every approximated, fallback, or skipped block. Conversion is a starting point, not proof of visual or functional fidelity; Templatical documents HTML fallback blocks for layouts it cannot decompose. Compare the converted email with the archived original at desktop and mobile widths, check links, images, merge tags, footers, and text version, then send a test to internal addresses before publishing it. The archive item stays unchanged and linked as the source of the editable copy.

The reusable library stores Templatical JSON, a stable template ID, name/category/tags, author, draft revisions, one published revision, rendered HTML/text for that revision, and an optional source archive ID. A new campaign pins an immutable published revision; later edits create another revision. The archive can contain many one-off campaigns without forcing every old email into the editor. This lets staff browse history immediately while converting only designs worth reusing.

## Implementation order and gates

| Step | Deliverable | Acceptance check |
| --- | --- | --- |
| 1. Access and pilot | `campaign_data` authorization, read-only fetch of sample sent activities, available metadata/HTML recorded | A representative sample matches the Constant Contact web view; missing fields are listed |
| 2. Archive | Additive archive metadata table, private object storage, resumable read-only import, safe preview, search, and completeness manifest | Re-running import creates no duplicate; old HTML survives source unavailability; previews cannot trigger old links or tracking |
| 3. Editable library | Templatical editor, revisions, render/test pipeline, selective HTML conversion with review report | A copied example can be edited and test-sent without altering its archive source; published revision stays fixed |
| 4. Cutover evidence | Import manifest, sample visual checks, retained asset status, backup/export, and owner sign-off | Required historical campaigns are accessible after Constant Contact is retired |

No sending to marketing audiences depends on importing old recipient lists. Historical campaign content and previous unsubscribe/suppression state are the Constant Contact data that must be carried forward. If Funraisin's past automated emails also belong in the archive, assess their available export/API separately; their source and send semantics differ from Constant Contact campaigns.
