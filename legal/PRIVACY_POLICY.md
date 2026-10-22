# Privacy Policy

**Effective Date:** [INSERT DATE]
**Last Updated:** [INSERT DATE]

This Privacy Policy describes how [COMPANY LEGAL NAME] ("**Gleame**," "**we**," "**us**," or "**our**") collects, uses, shares, and protects information in connection with the Gleame Shopify app, the Gleame quiz that merchants add to their storefronts, the Gleame website, and related services (together, the "**Service**").

Gleame lets Shopify merchants add a product-match quiz to their online store. Shoppers answer a few questions and get products recommended to them. Depending on how the merchant sets up the quiz, a shopper may also choose to give a first name, an email address or a phone number. On a small number of stores where the Gleame team has switched it on, the quiz can also use a photo the shopper provides (see Section 5).

This Policy covers two groups of people:

1. **Merchants**: Shopify store owners and their staff who install and use the Gleame app.
2. **Shoppers**: people who use a Gleame quiz on a merchant's store.

Each merchant is the data controller for the personal data of its own shoppers and customers, and Gleame processes that data on the merchant's behalf. If you are a shopper, please also read the privacy policy of the store you used.

---

## 1. Information We Collect

### 1.1 From Merchants

When a merchant installs or uses the Gleame app, we collect:

- **Shopify account data** from Shopify OAuth: shop domain, store name, contact email, plan, currency, and the access scopes granted to the app.
- **Catalog data** through the Shopify Admin API: product titles, descriptions, product types, tags, variants, prices, images, and availability, used to build the quiz and recommend products.
- **Quiz configuration**: questions, answers, matching rules, written guidance, text, styles, and images the merchant adds.
- **Theme data, only with the merchant's permission** (the optional `read_themes` scope): theme settings used to match the quiz to the store's look, and the store's page templates, read to check whether the Gleame Quiz block has been added.
- **Online Store pages and navigation, only with the merchant's permission** (optional scopes): when the merchant clicks Publish, Gleame creates a "Find My Match" page and, if the merchant chooses, adds it to the main menu. Gleame does not write code into pages or theme files; the quiz appears through Gleame's theme app extension block, which the merchant adds in the Shopify theme editor.
- **Order data** (see Section 1.3).
- **Billing data**: plan and subscription status. Charges are handled by Shopify. We never receive or store payment card numbers.
- **Support communications**: what you send us through in-app support chat or email.

### 1.2 From Shoppers Using a Gleame Quiz

- **Quiz answers and activity.** The answers a shopper chooses, which steps they reach, the products recommended to them, and the products they open or add to cart. These are recorded as analytics events with a random quiz-run ID (not linked to the shopper's identity), the device type (mobile or desktop), the store's cart token, and a timestamp.
- **First name (optional).** Some quizzes ask who the products are for, to personalize the results page. The name the shopper types stays in their own browser for that browsing session and is **not sent to Gleame's servers**. If the shopper is logged in to the store, the store may give the quiz the shopper's first name for the same purpose, also used only in the browser.
- **Email address and phone number (optional, with consent).** Only when the merchant turns on the quiz's email step and the shopper chooses to submit. We store the email and/or phone number together with a copy of the shopper's quiz answers, the products shown to them, the cart token, and the device type. The merchant writes the consent text shown at that step. A phone number is asked for only if the merchant enables it. Submitting may reveal a discount code the merchant offers.
- **Photos (only on stores where the Gleame team has enabled try-on, shade detection, or skin analysis).** See Section 5.
- **IP address.** Used briefly to rate-limit requests and prevent abuse. We do not store shoppers' IP addresses, user-agent strings, or device fingerprints.

### 1.3 Order Data

With the merchant's `read_orders` permission and Shopify's `orders/create` webhook, we record, for orders placed in the merchant's store: the order ID and number, cart token, totals and line items, the order-source summary Shopify provides (such as landing page, referring source, and UTM tags), and the buyer's Shopify customer ID and email address. We use these to show the merchant which orders came from shoppers who took the quiz, and to connect a quiz email sign-up to a purchase made with the same email within 60 days.

### 1.4 Information We Do Not Knowingly Collect

- We do not knowingly collect personal data from children (see Section 11).
- We do not ask shoppers for government identifiers, financial account numbers, health records, or precise location.

---

## 2. How We Use Information

1. **Running the quiz**: showing questions, recommending products, and returning results to the shopper.
2. **Product recommendations**: the merchant's matching rules decide results where they apply. Otherwise, the labels of the answers the shopper chose are sent with the merchant's product list to Google's Gemini API, which ranks the products. Names, email addresses, and phone numbers are never sent for ranking.
3. **Building quizzes for merchants**: when a merchant uses Gleame's AI tools (building a quiz from the catalog, "Build with AI", translation, matching suggestions), the merchant's catalog and instructions are sent to our AI providers (Section 4). These tools use merchant data only, never shopper data.
4. **Analytics for the merchant**: quiz completion, answers, recommended and added products, leads, and orders from quiz carts, shown in the merchant's Gleame dashboard.
5. **Lead capture**: delivering shopper sign-ups to the merchant, and to the merchant's Klaviyo account if the merchant has connected it (Section 3).
6. **Security and abuse prevention**: rate limiting, verifying that storefront requests come from the store they claim, and investigating misuse.
7. **Support and service messages** to merchants.
8. **Legal compliance**: meeting legal obligations and enforcing our Terms of Service.

We do not use shopper data to train AI models, and we do not use it for advertising.

### Legal Bases (GDPR / UK GDPR)

Where the GDPR or UK GDPR applies, the merchant, as controller, determines the legal basis for processing its shoppers' data. Gleame's own processing relies on:

- **Contract**: to provide the Service to merchants.
- **Legitimate interests**: to operate, secure, and improve the Service.
- **Consent**: for email and phone sign-ups through the quiz, and for any photo a shopper chooses to provide. A shopper can withdraw consent at any time (Section 9).
- **Legal obligation**: to comply with applicable law.

---

## 3. How We Share Information

**We do not sell personal information**, and we do not share it for cross-context behavioral advertising (as defined by the CCPA/CPRA).

- **With the merchant**: each merchant sees the quiz analytics, leads (which it can export), and order attribution for its own store. Gleame never shows one store's data to another.
- **With Klaviyo, at the merchant's direction**: if a merchant connects its own Klaviyo account, each quiz sign-up is sent to that account: email, phone number, quiz answers, products shown, and any discount code revealed. Gleame first checks Klaviyo for existing unsubscribes and never re-subscribes someone who opted out. Phone numbers are added for SMS only if the merchant has turned SMS consent on. In that account the merchant is the controller, under Klaviyo's terms.
- **With the merchant's own pixels, through Shopify**: the quiz reports its steps to Shopify's Customer Events as custom events (for example `gleame_quiz_start`). They carry the step, device type, and the names of recommended products, never names, emails, phone numbers, or answers. Shopify delivers them only to pixels the merchant has installed, and only as the shopper's cookie consent allows.
- **With Shopify**, as needed to run as a Shopify app.
- **With sub-processors** (Section 4).
- **With professional advisors** under confidentiality.
- **In a corporate transaction** such as a merger, acquisition, or sale of assets, subject to confidentiality protections.
- **To comply with law or protect rights**: to respond to lawful requests, enforce our Terms, or protect the safety of Gleame, our users, or others.

---

## 4. Sub-Processors

| Sub-processor | Purpose | Data processed |
|---|---|---|
| **Shopify Inc.** | App platform, OAuth, Admin API, webhooks, billing | Merchant, store, catalog, and order data |
| **Google LLC (Gemini API)** | Ranking products from quiz answers; AI quiz-building tools; photo processing where enabled | Answer labels and catalog data; merchant catalog and instructions; shopper photos, only while processing them |
| **Anthropic, PBC (Claude API)** | AI quiz-building tools in the merchant admin | Merchant catalog and instructions (no shopper data) |
| **OpenAI, L.L.C.** | Backup provider for try-on images, only on stores where try-on is enabled | Shopper photos, only while processing them |
| **Supabase, Inc.** | Database and file storage | Merchant data, quiz analytics, leads, order records, merchant images, skin-analysis photos (Section 5) |
| **Render, Inc.** | Application hosting | All data passing through the Service |
| **Resend** | Email to merchants | Merchant contact email |
| **Intercom, Inc.** | Support chat in the merchant admin only (never on storefronts) | Merchant identifiers and conversations |
| **[Hey Mantle]** | [Legacy subscriptions created before Shopify billing; remove once all are cancelled] | [Merchant billing metadata, no card data] |

We will update this list when sub-processors change. AI providers receive data through their paid API services, and Gleame does not opt in to having that data used for model training.

---

## 5. Photos

Most Gleame quizzes never ask for a photo. On stores where the Gleame team has switched these features on, a shopper may choose to provide one:

- **Try-on and shade detection.** The photo is resized in memory, sent over an encrypted connection to the AI provider to create a preview or detect a shade, and discarded when the request finishes. Gleame does not store these photos or the generated previews.
- **Skin analysis** (enabled for a few stores only). The photo, and a name if the shopper types one, are stored in private storage so the merchant can review the analysis. They are deleted when the merchant uninstalls the app, and on request.

We do not create faceprints, face templates, or any identifier from photos, and we do not use photos to identify anyone, for advertising, or to train AI models.

**Notice for Illinois, Texas, Washington, and other places with biometric privacy laws:** a face photo may be considered biometric information. It is used only for the purpose described above, kept only as described above, and never sold or disclosed except to the sub-processors listed in Section 4 or as required by law. The shopper is shown a notice before providing a photo, and providing one is their consent to this use. If you do not consent, do not provide a photo; the quiz works without one.

---

## 6. Browser Storage and Cookies

The Gleame quiz does **not** set cookies. It uses the browser's session storage to keep the shopper's progress, answers, and a random quiz-run ID while the tab is open, so a page refresh doesn't restart the quiz. Session storage is cleared when the tab is closed. To link a quiz to a later order, the quiz reads the store's own Shopify cart token. Gleame does not run third-party advertising cookies or cross-site trackers.

The Gleame merchant admin uses the cookies and storage that Shopify App Bridge, Shopify sign-in, and our support chat (Intercom) require. These do not appear on storefronts.

Merchants are responsible for any cookie banners their own store requires.

---

## 7. International Data Transfers

Gleame is operated from [COUNTRY / REGION], and our sub-processors are located in the United States and other countries. Where required, we rely on safeguards such as the European Commission's Standard Contractual Clauses and the UK International Data Transfer Addendum. Copies are available on request.

---

## 8. Data Retention and Deletion

- **Quiz analytics events**: kept while the merchant has the app installed, and deleted when the merchant uninstalls it or Shopify sends a `shop/redact` request.
- **Email and phone sign-ups**: kept while the merchant has the app installed, until the shopper asks for deletion (including through Shopify's `customers/redact`) or the merchant asks us to delete them. Deleted when the merchant uninstalls the app. Copies the merchant sent to its own Klaviyo account are managed by the merchant there.
- **Order records**: kept while the app is installed. On a `customers/redact` request, we remove the buyer's email and Shopify customer ID from that customer's orders.
- **Photos**: as described in Section 5.
- **Merchant account, catalog, and quiz configuration**: deleted when the merchant uninstalls the app or on `shop/redact`.
- **Billing records**: kept as financial record-keeping law requires.
- **Support conversations**: kept as long as reasonably needed to support the merchant.

We respond to Shopify's mandatory privacy webhooks. For `customers/data_request`, we report the quiz sign-ups and order records we hold for that customer. For `customers/redact`, we delete that customer's quiz sign-ups and remove their email and customer ID from order records. For `shop/redact`, we delete the store's data.

---

## 9. Your Rights

Depending on where you live, you may have the right to access, correct, delete, restrict, or port your personal data, to object to processing, to withdraw consent, and to complain to your local data protection authority. California residents also have the rights described in Section 13.

- **Shoppers**: please contact the store you used, since it is the controller of your data. You can also email us at **[PRIVACY EMAIL]** and we will help the store respond. To stop marketing emails or texts, use the unsubscribe link or reply STOP in the message; those messages come from the store.
- **Merchants**: email **[PRIVACY EMAIL]** from the address on your Shopify store.

We respond within the time limits the law requires (generally 30 days under the GDPR and 45 days under the CCPA). We may need to verify your identity first.

---

## 10. Security

We protect personal data with commercially reasonable measures, including:

- Encryption in transit (TLS) for all traffic, and encryption at rest through our hosting providers.
- Merchants' third-party keys (such as a Klaviyo API key) stored encrypted.
- Access controls that limit who at Gleame can reach production data.
- Storefront requests checked against the store's own domain, so one store cannot read another store's data.
- Rate limits on public endpoints.

No system is completely secure. If a breach affects personal data, we will notify the affected merchants, individuals, and authorities as the law requires.

---

## 11. Children

The Service is not directed to children under 13 (16 in the EEA and UK, unless local law sets a lower age), and we do not knowingly collect their personal data. If you believe a child has given us personal data, contact us and we will delete it.

---

## 12. Changes to This Policy

We may update this Policy. We will change the "Last Updated" date above, and for material changes we will give additional notice, such as an email to merchants or a notice in the app.

---

## 13. California Privacy Rights (CCPA / CPRA)

California residents have the rights described in Section 9, including the right to know, delete, and correct personal information, and the right not to be discriminated against for using them. In the past 12 months we have collected the categories of personal information described in Section 1 for the purposes described in Section 2. We have **not sold** personal information, and we have **not shared** it for cross-context behavioral advertising. To make a request, email **[PRIVACY EMAIL]**. An authorized agent may make a request on your behalf with proof of authorization.

---

## 14. Contact Us

**[COMPANY LEGAL NAME]**
Attn: Privacy
[STREET ADDRESS]
[CITY, STATE/PROVINCE, POSTAL CODE, COUNTRY]
Email: **[PRIVACY EMAIL]**

EU/UK representative or Data Protection Officer (if appointed): **[DPO / EU REP EMAIL, if applicable]**
