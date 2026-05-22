import type { SearchQuery } from "@mailclient/shared";

// Parses Gmail-style search syntax.
//   from:alice subject:report is:unread has:attachment "free text"
// Tokens: free text accumulates into `q`; field:value tokens map onto SearchQuery fields.
export function parseSearch(input: string): SearchQuery {
  const out: SearchQuery = {};
  const text: string[] = [];

  // Tokenize respecting quoted strings.
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) tokens.push(m[1] ?? m[2]);

  for (const tok of tokens) {
    const colon = tok.indexOf(":");
    if (colon === -1) {
      text.push(tok);
      continue;
    }
    const key = tok.slice(0, colon).toLowerCase();
    const val = tok.slice(colon + 1);
    switch (key) {
      case "from": out.from = val; break;
      case "to": out.to = val; break;
      case "subject": out.subject = val; break;
      case "tag":
      case "label": out.tag = val; break;
      case "has": if (val === "attachment" || val === "attach") out.hasAttachment = true; break;
      case "is":
        if (val === "unread") out.unread = true;
        else if (val === "starred") out.starred = true;
        else text.push(tok);
        break;
      default: text.push(tok);
    }
  }

  if (text.length > 0) out.q = text.join(" ");
  return out;
}
