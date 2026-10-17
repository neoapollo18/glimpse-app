/**
 * Phone values a GDPR customers/* payload may match in quiz_leads.phone.
 *
 * The lead step stores the phone as typed (separators stripped, '+' and
 * country code optional), while Shopify sends E.164. An exact match on the
 * payload alone misses every lead typed in national format, so the lookup
 * matches this candidate set instead. Write paths are untouched.
 */

// Remainders shorter than this are too likely to be someone else's number
// once a guessed country code is dropped. 8 still covers SG/HK/DK/NO.
const MIN_NATIONAL_DIGITS = 8;

export function phoneMatchCandidates(phone: string | null | undefined): string[] {
  const p = (phone ?? "").replace(/[\s().-]/g, "");
  // Stored phones always pass /^\+?\d{7,15}$/, so anything else can't match.
  if (!/^\+?\d+$/.test(p)) return [];
  const digits = p.replace(/^\+/, "");
  const out = new Set<string>([digits, `+${digits}`]);
  // Country codes never start with 0, so a leading 0 means the payload is
  // already national (or prefixed) and there is no code to strip.
  if (!digits.startsWith("0")) {
    out.add(`00${digits}`);
    // Codes are 1-3 digits. Each guess yields the bare national number and
    // its trunk-0 form (UK/DE/FR/AU shoppers type "07700 900123").
    for (let cc = 1; cc <= 3; cc++) {
      const national = digits.slice(cc);
      if (national.length < MIN_NATIONAL_DIGITS) break;
      out.add(national);
      out.add(`0${national}`);
    }
  }
  return [...out];
}
