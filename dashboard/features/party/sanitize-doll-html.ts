import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

const tags = new Set(['div', 'span', 'img']);
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dimensions = new Set(['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'left', 'right', 'top', 'bottom', 'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'padding']);
const keywords: Record<string, readonly string[]> = {
  position: ['relative', 'absolute', 'static'], display: ['inline-block', 'block', 'inline', 'none'],
  overflow: ['hidden', 'visible', 'clip'], 'text-align': ['center', 'left', 'right'],
  'image-rendering': ['pixelated', 'crisp-edges', 'auto'], 'vertical-align': ['top', 'middle', 'bottom'],
};

function safeUrl(value: string): string | null {
  const url = value.trim();
  // Reject controls, embedded spaces, backslashes and protocol-relative URLs
  // before the browser can normalize them into another scheme or authority.
  if (/[\u0000-\u0020\u007f\\]/.test(url)) return null;
  if (/^\/(?!\/)/.test(url)) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? url : null; }
  catch { return null; }
}

function safeStyle(style: string): string {
  // Native sprite/sprite_image use crop geometry, display, opacity and pixel
  // rendering, not CSS resources. A value grammar avoids escaped/commented
  // url(), expression(), bindings and other executable CSS entirely.
  if (/[\\{}<>@]|\/\*/.test(style)) return '';
  return style.split(';').flatMap(declaration => {
    const split = declaration.indexOf(':');
    if (split < 0) return [];
    const name = declaration.slice(0, split).trim().toLowerCase(), value = declaration.slice(split + 1).trim();
    const number = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
    const length = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)?$/;
    const valid = dimensions.has(name) ? value.split(/\s+/).every(part => length.test(part)) :
      name === 'opacity' || name === 'z-index' ? number.test(value) :
      name === 'color' || name === 'background-color' ? /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i.test(value) :
      keywords[name]?.includes(value.toLowerCase());
    return valid ? [`${name}:${value}`] : [];
  }).join(';');
}

/** Parse into plain data, then rebuild only native doll tags and attributes.
 * parse5 never creates DOM nodes or requests resources; this also works during
 * server rendering. No raw game/player markup touches a live element.
 */
export function sanitizeDollHtml(html: string | null | undefined): string {
  if (!html || html.length > 100_000) return '';
  function render(node: DefaultTreeAdapterTypes.ChildNode, depth: number): string {
    if (depth > 128) return '';
    if (node.nodeName === '#text') return escape((node as DefaultTreeAdapterTypes.TextNode).value);
    if (!('tagName' in node) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !tags.has(node.tagName)) return '';
    const attributes = node.attrs.flatMap(attribute => {
      if (attribute.namespace || attribute.prefix) return [];
      const name = attribute.name;
      let value: string | null = attribute.value;
      if (name === 'src' && node.tagName === 'img') value = safeUrl(value);
      else if (name === 'style') value = safeStyle(value);
      else if (name === 'width' || name === 'height') value = /^\d{1,5}(?:px)?$/.test(value) ? value : null;
      else if (name !== 'class') return [];
      return value ? [` ${name}="${escape(value)}"`] : [];
    }).join('');
    const open = `<${node.tagName}${attributes}>`;
    return node.tagName === 'img' ? open : open + node.childNodes.map(child => render(child, depth + 1)).join('') + `</${node.tagName}>`;
  }
  return parseFragment(html).childNodes.map(node => render(node, 0)).join('');
}
