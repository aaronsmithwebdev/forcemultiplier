# Constant Contact migration inventory

Read-only baseline checked 22 September 2026. This is the first step of the [email marketing platform plan](email-marketing-platform-plan.md). Counts describe the connected account and database at the time of the check; no contacts, lists, or credentials were changed.

| Item | Current finding | Migration implication |
| --- | --- | --- |
| Connected accounts | Salesforce and Constant Contact both authorized | Keep existing integrations through cutover |
| Salesforce audiences in ForceMultiplier | 3 | Reuse and validate their source definitions |
| Active ForceMultiplier sync schedules | 0 | Check for sending and sync schedules managed outside this app |
| Recorded Constant Contact deliveries | 2 | Retain as history; they are not a complete send history |
| Constant Contact lists | 101 across two API pages | Map active lists to Resend segments or retire them explicitly |
| Constant Contact custom fields | 35 | Map only fields needed for targeting and personalization |
| Sum of list membership counts | 118,849 | This includes people appearing in multiple lists and is **not** a unique-contact count |
| Constant Contact unsubscribe writeback | Disabled in this app | Import current opt-outs before Resend sends; confirm the Salesforce field and policy |
| Resend API key | Not configured locally | Read-only domain check and provider limit review await a key |
| Resubscription database tables | Latest committed resubscription migration is not yet applied to the connected database | Deploy and verify that existing migration before using the resubscription feature; do not infer migration success from the general database connection check |

The connected Constant Contact token was used only for list and custom-field catalog reads. The current scopes and app code do not establish which campaigns, automations, signup forms, landing pages, surveys, SMS, or preference-center workflows are active in Constant Contact. Those workflows need an account-owner inventory before the old account can be retired. The 101 lists also require an active/archived decision; copying all of them into Resend by default would create unnecessary segments.

Resend's [Usage API](https://resend.com/docs/api-reference/usage/retrieve-usage) is currently a private beta, so compare the unique eligible-contact count, necessary segment count, and peak send volume against the actual account plan in the Resend dashboard before choosing the migration batch size.

## Next evidence to collect

1. Export Constant Contact's active campaign, automation, form, template, and preference workflows and identify their owners and schedules.
2. Export current subscribed, unsubscribed, bounced, and complained contact states with consent provenance and a recovery copy.
3. Match each active list and required custom field to its Salesforce source and future Resend destination. Count unique normalized email addresses, duplicate addresses, and conflicting Salesforce identities.
4. Check Resend domain verification and account limits with the new read-only connection card, then run the planned test-address contact and segment proof.

No Constant Contact sending or sync was disabled during this inventory.
