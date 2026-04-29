# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in Gleame (the Shopify app, the storefront widget, or the public APIs at `gleame.ai`), please report it by emailing **aaron@gleame.ai**.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a proof-of-concept.
- Any logs, request/response samples, or screenshots that help us reproduce.

**Please do not** open a public GitHub issue, post to social media, or otherwise disclose the issue publicly until we have had a chance to investigate and remediate.

## Our Commitments

- **Acknowledgement:** within 2 business days of your report.
- **Initial triage:** within 5 business days, including a severity assessment and expected timeline.
- **Resolution:** we aim to fix High/Critical issues within 30 days, Medium within 90 days. We will keep you updated.
- **Coordinated disclosure:** we ask for a 90-day window before public disclosure. We are happy to credit you in our release notes if you wish.
- **Safe harbor:** we will not pursue legal action against good-faith security research that follows this policy and avoids privacy violations, service disruption, or destruction of data.

## In Scope

- The Gleame Shopify embedded admin app (`/app/*` routes).
- The public storefront APIs (`/api/storefront/*`) and the loader at `/widget-embed.js`.
- The Theme App Extension widget (`extensions/glimpse-widget/`).
- The marketing site at `gleame.ai`.

## Out of Scope

- Vulnerabilities in third-party platforms we depend on (Shopify, Supabase, Render, Google Gemini, OpenAI, Hey Mantle). Please report those directly to the vendor.
- Social engineering, physical attacks, and DDoS.
- Reports relying on outdated browsers, missing best-practice headers without a demonstrated exploit, or theoretical issues without impact.

## Sub-Processors and Their Certifications

Gleame's infrastructure runs on certified sub-processors:

| Provider | Use | Certifications |
|---|---|---|
| Shopify | OAuth, billing, webhooks | SOC 2 Type II, ISO 27001 |
| Supabase | Primary database (PostgreSQL) | SOC 2 Type II |
| Render | Application hosting | SOC 2 Type II |
| Google Cloud (Gemini) | Image generation | SOC 2, ISO 27001 |
| OpenAI | Image generation (fallback) | SOC 2 Type II |
| Hey Mantle | Subscription billing | SOC 2 Type II |

## Incident Response

Our internal incident-response runbook is documented at [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md). Per our [Terms of Service §10.7](https://www.gleame.ai/terms), we will notify affected merchants without undue delay and within 72 hours of becoming aware of a personal-data breach.

## Privacy

For data-handling and retention details, see our [Privacy Policy](https://www.gleame.ai/privacy).
