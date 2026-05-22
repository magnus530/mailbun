import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { ChevronDown, ChevronUp, Paperclip, Download } from "lucide-react";
import type { MessageBodyDto } from "@mailclient/shared";
import { formatAddress, formatAddressShort, formatBytes, formatFullDate, initials, colorFor } from "../lib/format";

// Strip known-dangerous tags. Inline HTML is allowed for layout but no scripts.
const SANITIZE_CONFIG = {
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "meta", "link"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "srcdoc"],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

// Open every link in an email body in a new tab. noopener+noreferrer stops
// the target page from accessing our window.opener (reverse-tabnabbing) and
// from learning the referer. Registered once at module load — DOMPurify is
// a singleton, so this applies to every subsequent sanitize() call.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function MessageBubble({
  message,
  defaultOpen,
}: {
  message: MessageBodyDto;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sender = message.from[0] ?? { name: null, address: "(unknown)" };
  const html = useMemo(() => {
    if (!message.bodyHtml) return null;
    return DOMPurify.sanitize(message.bodyHtml, SANITIZE_CONFIG) as unknown as string;
  }, [message.bodyHtml]);
  const text = message.bodyText ?? "";

  return (
    // overflow-hidden + min-w-0 keep wide HTML email content (tables, images,
    // long no-break URLs) from pushing the bubble past its container.
    <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-bg shadow-sm">
      <header
        className="flex cursor-pointer items-start gap-3 px-5 py-4"
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar address={sender.address} name={sender.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium text-fg">{formatAddressShort(sender)}</span>
            <span className="hidden truncate text-xs text-fg-subtle md:block">{`<${sender.address}>`}</span>
            <span className="ml-auto text-xs text-fg-subtle">{formatFullDate(message.date)}</span>
          </div>
          <div className="mt-0.5 text-xs text-fg-muted">
            to{" "}
            {message.to.map((a) => formatAddressShort(a)).join(", ")}
            {message.cc.length > 0 ? `, cc ${message.cc.map(formatAddressShort).join(", ")}` : null}
          </div>
          {!open && message.preview ? (
            <p className="mt-1 truncate text-sm text-fg-subtle">{message.preview}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="text-fg-subtle hover:text-fg"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </header>
      {open ? (
        <div className="border-t border-border px-5 py-4">
          {html ? (
            // overflow-x-auto for the rare wide table; the prose-mail rules
            // already cap images and break long words.
            <div
              className="prose-mail max-w-none overflow-x-auto text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : text ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-fg">{text}</pre>
          ) : (
            <p className="text-sm italic text-fg-subtle">(empty body)</p>
          )}
          {message.attachments.length > 0 ? (
            <div className="mt-4 space-y-1">
              <div className="text-xs font-medium text-fg-muted">
                <Paperclip className="mr-1 inline h-3.5 w-3.5" />
                Attachments
              </div>
              <div className="grid grid-cols-2 gap-2">
                {message.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/api/attachments/${a.id}`}
                    download={a.filename}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm hover:bg-bg-hover"
                  >
                    <Download className="h-4 w-4 text-fg-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-fg">{a.filename}</div>
                      <div className="text-xs text-fg-subtle">{formatBytes(a.size)}</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-2 hidden text-[10px] text-fg-subtle">{formatAddress(sender)}</div>
        </div>
      ) : null}
    </article>
  );
}

function Avatar({ address, name }: { address: string; name: string | null }) {
  const bg = colorFor(address);
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm"
      style={{ backgroundColor: bg }}
    >
      {initials({ address, name })}
    </div>
  );
}
