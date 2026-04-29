# Incident Response Runbook

Internal runbook for responding to security and data-protection incidents in Gleame. This document fulfills the 72-hour breach-notification commitment in [Terms §10.7](https://www.gleame.ai/terms) and the GDPR Article 33/34 obligations referenced in our [Privacy Policy](https://www.gleame.ai/privacy).

**Owner:** Founder (Incident Commander by default).
**Last reviewed:** 2026-04-25.

---

## 1. Roles

Gleame is currently a solo-founder operation. The founder serves as **Incident Commander (IC)** — owning detection, containment, comms, and post-mortem — until headcount changes.

If/when staff or contractors are added, this runbook must be updated with: a deputy IC, an on-call rotation, and named comms/legal contacts.

---

## 2. Detection Sources

Watch these channels daily; they are the early-warning surface:

- **Render application logs and alerts** — error spikes, restart loops, 5xx rate, deploy failures. Render's built-in email alerts are configured for the production service.
- **Supabase logs and audit log** — query errors, auth failures, unusual `service_role` usage, RLS denials, large/expensive queries.
- **Shopify Partner Dashboard** — failed webhooks, OAuth failures, app review escalations.
- **Hey Mantle webhooks** — billing-event failures.
- **External reports** — emails to `aaron@gleame.ai`, support inquiries, merchant complaints, social media mentions.
- **Sub-processor status pages** — Shopify, Supabase, Render, OpenAI, Google Cloud (subscribe to status RSS).

---

## 3. Severity Classification

Apply the highest matching tier:

| Severity | Examples | Response time |
|---|---|---|
| **SEV-1 — Critical** | Confirmed PII exposure; cross-shop data leak; active exploitation; full outage. | Begin response within 1 hour, 24/7. |
| **SEV-2 — High** | Suspected breach being investigated; partial outage; auth bypass not yet exploited; loss of merchant data without backup. | Begin response within 4 hours during business hours, 8 hours otherwise. |
| **SEV-3 — Medium** | Vulnerability reported with no evidence of exploitation; degraded performance; non-PII bug with security implications. | Triage within 1 business day. |
| **SEV-4 — Low** | Best-practice findings, missing headers without exploit, informational reports. | Triage within 5 business days. |

If the **72-hour GDPR clock** could plausibly apply (any incident that may involve personal data of EU/UK residents), treat as SEV-1 or SEV-2 until ruled out.

---

## 4. Response Steps

### 4.1 Identify (first 30 minutes)
1. Open a private incident note (date-stamped doc or GitHub issue in a private repo).
2. Record: who reported, when, what was observed, severity guess.
3. Capture logs *now* — Render and Supabase log retention is finite. Export relevant time windows to local storage.

### 4.2 Contain
Pick the smallest action that stops the bleeding:
- **Compromised credentials:** rotate the affected secret in Render, Supabase, Shopify Partner, OpenAI, Gemini, or Hey Mantle. Revoke old token.
- **Active exploit on a public endpoint:** ship a hotfix or, if necessary, temporarily disable the endpoint (`/api/storefront/transform-image`, `/api/storefront/track-event`) by responding 503.
- **Database integrity issue:** halt writes by scaling Render service to zero or by toggling Supabase to read-only at the project level; restore from the most recent point-in-time backup.
- **Cross-shop data leak:** add or tighten the shop-domain verification check; deploy; then assess affected shops via logs.

### 4.3 Assess
Within the first hours, answer:
- **What data was affected?** Cross-reference with the data inventory below.
- **Whose data?** Which shops, which shoppers, which countries.
- **How was it accessed/exposed?** Root cause hypothesis.
- **Is it ongoing?** Confirm containment.
- **Does GDPR Article 33 apply?** (Personal data of EU/UK residents involved → yes.)

### 4.4 Notify (the 72-hour clock)

The clock starts when Gleame **becomes aware** of a likely personal-data breach — not when investigation completes.

| Audience | Trigger | Channel | Within |
|---|---|---|---|
| **Affected merchants (data controllers)** | Confirmed or likely breach of merchant or shopper data they control. | Email to merchant contact on file; in-app banner if severe. | 72 hours of awareness. |
| **Affected shoppers** | High-risk breach (per GDPR Art. 34) — e.g., biometric/face-image exposure. | Coordinate with affected merchants; they notify. | Without undue delay. |
| **Supervisory authority (DPA)** | Breach involving EU/UK personal data not unlikely to result in risk. | Per the lead authority's portal. | 72 hours. |
| **Sub-processors / vendors** | If their platform was the vector or needs to assist forensics. | Vendor's incident channel. | Immediately. |
| **Shopify (App Trust)** | Any incident affecting merchants installed via the App Store. | partners@shopify.com / Partner Dashboard ticket. | 72 hours. |

A merchant-notification email template is in §6 below.

### 4.5 Recover
- Verify the fix in production (synthetic test of the affected path).
- Restore any deleted/corrupted data from Supabase backups; verify row counts.
- Lift any temporary mitigations (re-enable disabled endpoints).
- Monitor logs for 24-72 hours for recurrence.

### 4.6 Post-mortem (within 7 days)
Write a blameless post-mortem in `docs/postmortems/YYYY-MM-DD-<slug>.md`:
- Timeline (UTC) — detection, containment, notification, resolution.
- Impact — what data, how many merchants/shoppers, duration.
- Root cause and contributing factors.
- What went well, what went badly.
- Action items with owners and dates. File these as GitHub issues.

---

## 5. Data Inventory (for impact assessment)

What Gleame stores — used to scope what could be affected:

- **Persisted in Supabase:** shop domain + Shopify shop ID, merchant product/variant configurations, AI prompts, reference image URLs, analytics events (no shopper PII), conversion records (cart token + Shopify order/customer ID), Hey Mantle subscription status.
- **Persisted in Prisma (same Postgres):** Shopify OAuth session tokens.
- **Not persisted (in-memory only):** shopper-uploaded selfies, AI-generated previews, IP addresses (used transiently for rate limiting).

The "not persisted" list is a privacy strength — confirm it still holds when scoping any incident.

---

## 6. Merchant Notification Template

> **Subject:** Important security notice from Gleame
>
> Hello {{merchant_name}},
>
> We are writing to inform you of a security incident that may have affected your Gleame installation.
>
> **What happened:** {{plain-language summary, 1-2 sentences}}
> **When:** {{detection time, UTC}}. The issue was contained at {{time}}.
> **What data was involved:** {{specific fields and tables, or "no shopper personal data was involved"}}
> **What we have done:** {{containment + fix}}
> **What you should do:** {{action items, e.g., rotate API keys, review recent orders — or "no action required"}}
> **More information:** Reply to this email or contact aaron@gleame.ai. We will publish a post-mortem within 7 days at {{URL}}.
>
> We are sorry for the disruption. Protecting your data and your shoppers' data is the foundation of this product, and we take this seriously.
>
> — Gleame

---

## 7. Key Contacts

- **Founder / Incident Commander:** charlessgao2@gmail.com
- **Public security inbox:** aaron@gleame.ai
- **Shopify App Trust:** via Partner Dashboard ticket; partners@shopify.com
- **Supabase support:** dashboard ticket (priority depends on plan)
- **Render support:** dashboard ticket
- **Legal / DPA filing guidance:** retain counsel before first incident; contact [TODO: name + firm].

---

## 8. Quarterly Drill

Once per quarter, the IC runs a 30-minute tabletop exercise against this runbook using a fictional scenario (e.g. "leaked Supabase service-role key found in a public commit"). Update this document with anything that was unclear or missing.

Last drill: _none yet_ — schedule before 2026-07-31.
