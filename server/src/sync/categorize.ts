import type { ParsedMail } from "mailparser";
import type { AddressDto, MessageCategory } from "@mailclient/shared";

// Gmail-style inbox categorization, provider-agnostic. We classify each
// message as 'promotions' (bulk marketing) or 'primary' (everything else)
// from its headers at sync time. This is deliberately conservative: the cost
// of a false positive (a real email hidden in Promotions) is higher than a
// false negative (a promo left in Primary), so a message is only promotional
// when a bulk-sending signal is backed by an actual marketing signal.
//
// Transactional bulk mail — receipts, password resets, security alerts —
// often carries List-Unsubscribe too, so List-Unsubscribe alone is NOT enough
// to demote a message; it must be paired with a marketing marker.

// Localparts that overwhelmingly send broadcast rather than personal mail.
const MARKETING_LOCALPARTS =
  /^(newsletter|news|marketing|promo|promotions|deals|offers|sales|shop|store|hello|hi|team|updates|update|digest|weekly|daily|campaign|email|mail|community|social|notification|notifications)([.\-_+]|$)/i;

// Subject-line markers typical of promotional blasts.
const MARKETING_SUBJECT =
  /(\b\d{1,3}%\s*off\b|\bsale\b|\bdeal(s)?\b|\bcoupon\b|\bpromo(code)?\b|\bdiscount\b|\blimited time\b|\bblack friday\b|\bcyber monday\b|\bnewsletter\b|\bshop now\b|\bbuy now\b|\bfree shipping\b|\bunsubscribe\b|🎉|🛍|🔥)/i;

// ESP / bulk-sender header names. Presence of any is a strong marketing signal.
const ESP_HEADERS = [
  "list-id",
  "x-campaign",
  "x-campaignid",
  "x-mailchimp-id",
  "x-mc-user",
  "x-sg-eid", // SendGrid
  "x-sendgrid-id",
  "x-mailgun-sid",
  "x-marketing",
  "feedback-id", // Google bulk-sender categorization id
  "x-csa-complaints",
  "x-mailer-lid",
];

// mailparser's `headers` Map only holds a curated subset of headers — the bulk
// markers we rely on (List-Unsubscribe, X-Campaign, Feedback-ID, …) are absent
// from it and live only in `headerLines`. So resolve everything from
// headerLines, which carries every header verbatim.
function buildHeaderSet(parsed: ParsedMail): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of parsed.headerLines) {
    // h.line is the raw "Key: value"; strip the key to get the value.
    const idx = h.line.indexOf(":");
    map.set(h.key, idx >= 0 ? h.line.slice(idx + 1).trim() : "");
  }
  return map;
}

function localpartLooksMarketing(from: AddressDto[]): boolean {
  return from.some((a) => {
    const local = a.address.split("@")[0] ?? "";
    return MARKETING_LOCALPARTS.test(local) || /(^|[.\-_])(no-?reply)([.\-_]|$)/i.test(local);
  });
}

/**
 * Full-strength classification from a freshly parsed message. Used at sync
 * time, where every header is available.
 */
export function categorizeMessage(parsed: ParsedMail, from: AddressDto[]): MessageCategory {
  const headers = buildHeaderSet(parsed);
  const precedence = (headers.get("precedence") ?? "").toLowerCase();
  const hasListUnsub = headers.has("list-unsubscribe");
  const espMarker = ESP_HEADERS.some((h) => headers.has(h));
  const isBulk =
    hasListUnsub || precedence === "bulk" || precedence === "list" || espMarker;
  if (!isBulk) return "primary";

  // Bulk confirmed — now require a marketing signal to separate promotions
  // from transactional bulk (receipts, alerts).
  const subject = parsed.subject ?? "";
  const marketing =
    espMarker || localpartLooksMarketing(from) || MARKETING_SUBJECT.test(subject);

  return marketing ? "promotions" : "primary";
}

/**
 * Best-effort classification from only the fields we persist (sender +
 * subject). Used to backfill messages synced before headers were retained —
 * weaker than {@link categorizeMessage} but catches the obvious cases.
 */
export function categorizeFromFields(from: AddressDto[], subject: string): MessageCategory {
  // No headers to lean on, so demand both a marketing sender AND a marketing
  // subject — stays conservative to avoid burying real mail on a weak signal.
  const marketingFrom = localpartLooksMarketing(from);
  const marketingSubject =
    MARKETING_SUBJECT.test(subject) || /(newsletter|digest|weekly|deals|offers)/i.test(subject);
  return marketingFrom && marketingSubject ? "promotions" : "primary";
}
