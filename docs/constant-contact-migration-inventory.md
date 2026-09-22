# Constant Contact migration inventory

Read-only baseline checked 22 September 2026 and updated after the user confirmed that Constant Contact lists will **not** be migrated. This is the first step of the [email marketing platform plan](email-marketing-platform-plan.md). Counts describe connected accounts and the database at the time of the checks; no contacts, lists, campaigns, or credentials were changed.

| Item | Current finding | Migration implication |
| --- | --- | --- |
| Connected accounts | Salesforce and Constant Contact both authorized | Keep existing integrations through cutover |
| Salesforce audiences in ForceMultiplier | 3 | Reuse and validate their source definitions |
| Active ForceMultiplier sync schedules | 0 | Check for sending and sync schedules managed outside this app |
| Recorded Constant Contact deliveries | 2 | Retain as history; they are not a complete send history |
| Constant Contact lists | 101 across two API pages | Historical context only; **do not copy memberships** into Resend |
| Constant Contact custom fields | 35 | Check old campaign merge tags; define new marketing fields from Salesforce/Funraisin sources |
| Sum of list membership counts | 118,849 | Historical context only; this is **not** a unique-contact count or a Resend target |
| Constant Contact unsubscribe writeback | Disabled in this app | Import current opt-outs before Resend sends; confirm the Salesforce field and policy |
| Constant Contact campaign archive access | Reauthorization succeeded; full read-only listing returned 3,185 unique campaign records, including 3,130 Done | Build the [historical sent-email archive](template-archive-strategy.md), including each sent A/B variant |
| Resend API key and domain | Local key configured; one domain verified for sending | Domain check passed; account plan limits still need dashboard review |
| Funraisin API | Key and base URL work with read-only Bearer requests | Add entrant audiences after archive and first sending workflow |
| Funraisin scale | 166,914 participant-event entries, 136,999 participants, 160 events | Use complete paginated extraction; entry count is not unique email count |
| Resubscription database tables | Migration applied and database schema verified on 22 September 2026 | Feature can use its tables; validate a real job separately before relying on it |

The original token was used only for list/custom-field catalog reads and one denied campaign-list probe. After reauthorization with `campaign_data`, the connected account passed campaign reads and the sample activity checks recorded in the [archive strategy](template-archive-strategy.md). The account owner still needs to identify any automations, signup forms, landing pages, surveys, SMS, or preference-center workflows that must be replaced. The 101 lists will not be copied into Resend.

Funraisin was queried only for a one-record JSON page from `participantsevents`, `participants`, and `events`; no personal values were printed or stored. Its participant schema includes opt-in and opt-out field names, but the account-specific meaning and precedence of those fields have not been established. Do not send to entrants solely because a registration exists.

Resend's [Usage API](https://resend.com/docs/api-reference/usage/retrieve-usage) is currently a private beta, so compare the unique eligible-contact count, necessary segment count, and peak send volume against the actual account plan in the Resend dashboard before choosing the migration batch size.

## Next evidence to collect

1. Build the [immutable sent-email archive](template-archive-strategy.md) from the now-accessible campaigns; compare sample copies with Constant Contact's web view and inventory any active automation/form/preference workflow separately.
2. Export current unsubscribed, bounced, and complained states with provenance and a recovery copy. Do not export CC list memberships for migration.
3. Define Salesforce-built audiences and required marketing fields. Confirm which Funraisin events and entrant states are wanted, then verify identity and email-preference rules.
4. Review Resend account limits in its dashboard and run the planned test-address contact and segment proof after the consent baseline is ready.

No Constant Contact sending or sync was disabled during this inventory.
