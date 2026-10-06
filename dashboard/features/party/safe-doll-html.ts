// Doll markup comes from the game's sprite() (characters/shared.js characterDollHtml and mapDollHtml).
// mapDollHtml covers every character in view, so other players' skin and cx values reach this
// dashboard. Script in this origin could drive /party-api with the pairing cookie, so the markup is
// rebuilt from an allowlist before it reaches the DOM (Ryan-Haines/adventureland-party-console#61).
//
// Ways this can fail, each handled below:
// - an event-handler attribute (onerror, onload, ...) or a non-doll tag (script, svg, iframe, a)
//   survives, or a tag's name is disguised by case;
// - quoting tricks: an attribute value with ">" or the other quote breaks out of its tag, or an
//   unterminated tag swallows the rest of the markup;
// - entity-encoded text or attribute values decode into markup after re-serialization;
// - src or a style url() names javascript:, data: or another scheme;
// - a style smuggles behavior through expression(), -moz-binding, @import or CSS escapes;
// - an unbalanced closing tag closes the wrapper element this markup is rendered into;
// - the sanitizer drops what a real doll needs: div/span/img nesting, inline layout styles,
//   absolute https sprite sheet URLs (shared.js dashboardDollHtml makes every src absolute).
// Rendering in a browser is the only proof that nothing runs; see the console E2E journey.

const TAGS = new Set(["div", "span", "img"]);
const ATTRIBUTES = new Set(["style", "src", "class", "width", "height"]);

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Only the entities the game's markup uses. Anything else stays literal and is escaped again, so a
// numeric entity can never become markup.
const decode = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function safeUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url.trim()) || /^\/[^/\\\s][^\s]*$/.test(url.trim());
}

// Doll styles are plain layout declarations and never load anything themselves.
function safeStyle(style: string): boolean {
  return !/[\\<>@]|url\s*\(|expression\s*\(|javascript:|vbscript:|behavior\s*:|binding\s*:|image-set|image\s*\(/i.test(style);
}

function attributes(source: string): string {
  let out = "";
  for (const match of source.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const name = match[1].toLowerCase();
    if (!ATTRIBUTES.has(name)) continue;
    const value = decode(match[3] ?? match[4] ?? match[5] ?? "");
    if (name === "src" && !safeUrl(value)) continue;
    if (name === "style" && !safeStyle(value)) continue;
    if ((name === "width" || name === "height") && !/^\d{1,5}(px)?$/.test(value.trim())) continue;
    out += ` ${name}="${escape(value)}"`;
  }
  return out;
}

/** Rebuilds doll markup from the div/span/img allowlist; safe for dangerouslySetInnerHTML. */
export function sanitizeDollHtml(html: string | null | undefined): string {
  if (!html) return "";
  const open: string[] = [];
  let out = "";
  // A tag (quoted values may contain ">"), the text between tags, or a stray "<".
  // Comments, doctypes and processing instructions are removed first.
  const source = String(html).replace(/<!--[\s\S]*?(-->|$)|<![^>]*>?|<\?[^>]*>?/g, "");
  for (const [whole, tagName, rest, text] of source.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g)) {
    if (text !== undefined) { out += escape(decode(text)); continue; }
    if (!tagName) continue;
    const tag = tagName.toLowerCase();
    if (!TAGS.has(tag)) continue;
    if (whole.startsWith("</")) {
      const index = open.lastIndexOf(tag);
      if (index < 0) continue;
      while (open.length > index) out += `</${open.pop()}>`;
      continue;
    }
    out += `<${tag}${attributes(rest || "")}>`;
    if (tag !== "img") {
      if (/\/\s*$/.test(rest || "")) out += `</${tag}>`;
      else open.push(tag);
    }
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
