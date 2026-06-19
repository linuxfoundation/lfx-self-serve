// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { NewsletterBlock } from '@lfx-one/shared/interfaces';

/**
 * Client-side declarative renderer for the newsletter block-composer preview.
 *
 * Mirrors the gatewaze declarative format (the same one the server parses into
 * MJML at send time): a small HTML-ish template — an element tree of
 * allowlisted tags with `{{field}}` bindings and `if` / `each` control-flow —
 * is parsed and bound against a block's content into a browser HTML string.
 *
 * This is ONLY the editor's visual. The server MJML render stays the source of
 * truth for the final SENT email; the two formats share the declarative
 * templates and the shared block classes (eyebrow / title / card / …) so the
 * canvas reads like the real email.
 *
 * Trust boundary: the produced HTML is injected via
 * `DomSanitizer.bypassSecurityTrustHtml` in the canvas component. The content
 * being rendered is the AUTHENTICATED author's OWN newsletter (the same trust
 * boundary the repo already documents for `body_html` / email chrome — "no
 * sanitizer, trust boundary = UI"). The template tags are additionally
 * constrained by the allowlist below, so the only HTML that can ever be emitted
 * is the inert subset the renderer maps to.
 *
 * SSR-safe: parsing uses `DOMParser`, a browser-only API. Nothing here touches
 * the DOM at module load; the public `render*` methods early-return an empty
 * string on the server and the component only calls them browser-side.
 */
@Injectable({ providedIn: 'root' })
export class NewsletterRendererService {
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Render a single block: parse its template, bind its content, and recurse
   * into child blocks for any `<slot>`. Returns '' on the server or when the
   * block has no template.
   */
  public renderBlock(template: string | undefined, content: Record<string, unknown>, children: NewsletterBlock[] = [], templateOf?: (blockType: string) => string | undefined): string {
    if (!isPlatformBrowser(this.platformId) || !template) {
      return '';
    }
    const nodes = parseTemplate(template);
    const ctx: RenderCtx = { content, children, templateOf };
    return nodes.map((node) => this.renderNode(node, ctx)).join('');
  }

  /**
   * Render the full newsletter: the wrapper chrome with all top-level blocks
   * assembled into its `<slot name="body" />`. `wrapperContent` carries runtime
   * fields the wrapper template binds (e.g. `edition.date`). Returns the bare
   * body when no wrapper template is supplied.
   */
  public renderNewsletter(
    wrapper: string | undefined,
    blocks: NewsletterBlock[],
    templateOf: (blockType: string) => string | undefined,
    wrapperContent: Record<string, unknown> = {}
  ): string {
    if (!isPlatformBrowser(this.platformId)) {
      return '';
    }
    const body = blocks.map((block) => this.renderBlock(templateOf(block.block_type), block.content, block.blocks ?? [], templateOf)).join('');
    if (!wrapper) {
      return body;
    }
    const nodes = parseTemplate(wrapper);
    const ctx: RenderCtx = { content: wrapperContent, children: [], templateOf, bodySlot: body };
    return nodes.map((node) => this.renderNode(node, ctx)).join('');
  }

  /**
   * Render the wrapper chrome split around its `<slot name="body" />` so the
   * composer can keep a LIVE CDK drop list between the header and footer (the
   * body slot can't be a static HTML blob — it has to host the draggable
   * blocks). Returns `{ header, footer }`; both '' when no wrapper / on server.
   */
  public renderWrapperChrome(wrapper: string | undefined, wrapperContent: Record<string, unknown> = {}): { header: string; footer: string } {
    if (!isPlatformBrowser(this.platformId) || !wrapper) {
      return { header: '', footer: '' };
    }
    const nodes = parseTemplate(wrapper);
    const slotIndex = nodes.findIndex((n) => n.kind === 'element' && n.tag === 'slot' && (n.attrs['name'] ?? '') === 'body');
    const ctx: RenderCtx = { content: wrapperContent, children: [], templateOf: undefined };
    if (slotIndex === -1) {
      // No body slot at the top level — render everything as the header.
      return { header: nodes.map((n) => this.renderNode(n, ctx)).join(''), footer: '' };
    }
    const header = nodes
      .slice(0, slotIndex)
      .map((n) => this.renderNode(n, ctx))
      .join('');
    const footer = nodes
      .slice(slotIndex + 1)
      .map((n) => this.renderNode(n, ctx))
      .join('');
    return { header, footer };
  }

  // === Private rendering ===

  /** Walk one parsed node into an HTML string within the given context. */
  private renderNode(node: TemplateNode, ctx: RenderCtx): string {
    if (node.kind === 'text') {
      return resolveBindings(node.value, ctx.content);
    }

    const { tag, attrs, children } = node;

    // Conditional: drop the element when the guarded field is empty.
    if (attrs['if'] !== undefined && !truthy(getPath(ctx.content, attrs['if']))) {
      return '';
    }

    // Loop: repeat this element (minus `each`) once per array item, binding the
    // item's fields inside.
    if (attrs['each'] !== undefined) {
      const arr = getPath(ctx.content, attrs['each']);
      if (!Array.isArray(arr)) return '';
      const rest = { ...attrs };
      delete rest['each'];
      return arr.map((item) => this.renderNode({ kind: 'element', tag, attrs: rest, children }, { ...ctx, content: mergeItem(ctx.content, item) })).join('');
    }

    // Slots: the wrapper's body slot assembles the top-level blocks; a block's
    // own slot recurses into its child blocks (each rendered with its template).
    if (tag === 'slot') {
      const name = attrs['name'] ?? 'children';
      if (name === 'body' && ctx.bodySlot !== undefined) {
        return ctx.bodySlot;
      }
      return ctx.children.map((child) => this.renderBlock(ctx.templateOf?.(child.block_type), child.content, child.blocks ?? [], ctx.templateOf)).join('');
    }

    // Rich text: emit the bound field's raw HTML (author's own content).
    if (tag === 'richtext') {
      const field = attrs['field'] ?? bindingKeyFromChildren(children);
      const value = field ? getPath(ctx.content, field) : undefined;
      const html = value == null ? '' : String(value);
      const open = openTag('div', mergedStyle(attrs), classList(attrs));
      return `${open}${html}</div>`;
    }

    const mapping = TAG_MAP[tag];
    const childHtml = children.map((c) => this.renderNode(c, ctx)).join('');

    // Unknown / inert-passthrough tags: keep the tag if it's an allowlisted
    // inert HTML element, otherwise drop the wrapper but keep its children.
    if (!mapping) {
      if (INTRINSIC_TAGS.has(tag)) {
        if (VOID_TAGS.has(tag)) return openTag(tag, mergedStyle(attrs), classList(attrs), passthrough(tag, attrs, ctx.content), true);
        return `${openTag(tag, mergedStyle(attrs), classList(attrs), passthrough(tag, attrs, ctx.content))}${childHtml}</${tag}>`;
      }
      return childHtml;
    }

    const htmlTag = mapping.tag;
    const style = mergedStyle(attrs, mapping.style);
    const classes = classList(attrs, mapping.className);
    const extraAttrs = passthrough(htmlTag, attrs, ctx.content);

    if (VOID_TAGS.has(htmlTag)) {
      return openTag(htmlTag, style, classes, extraAttrs, true);
    }
    return `${openTag(htmlTag, style, classes, extraAttrs)}${childHtml}</${htmlTag}>`;
  }
}

// ---------------------------------------------------------------------------
// Parser (ported from the gatewaze declarative format)
// ---------------------------------------------------------------------------

interface RenderCtx {
  content: Record<string, unknown>;
  children: NewsletterBlock[];
  templateOf?: (blockType: string) => string | undefined;
  /** Pre-rendered body HTML for the wrapper's `<slot name="body" />`. */
  bodySlot?: string;
}

type TemplateNode = { kind: 'element'; tag: string; attrs: Record<string, string>; children: TemplateNode[] } | { kind: 'text'; value: string };

const SCHEMA_RE = /<!--\s*SCHEMA:\s*[\s\S]*?-->/i;

/**
 * Parse a declarative template string into a node tree. Browser-only
 * (`DOMParser`); callers guard with `isPlatformBrowser` before reaching here.
 *
 * The JSX-style tags (Section / Row / Link / …) and self-closing forms don't
 * survive the HTML parser as-authored, so we normalise them first — exactly as
 * the gatewaze parser does — then collect the resulting DOM into a serialisable
 * node tree the renderer walks.
 */
function parseTemplate(source: string): TemplateNode[] {
  let body = source.replace(SCHEMA_RE, '');

  // Expand JSX-style self-closing tags (`<Img/>`, `<richtext .../>`) to open +
  // close so the HTML parser doesn't swallow following siblings as children.
  body = body.replace(/<([A-Za-z][\w-]*)\b([^>]*?)\/>/g, '<$1$2></$1>');

  // Custom tag names that collapse onto HTML5 void elements once lowercased
  // (most notably <Link> → <link>, which the parser treats as void and strips
  // of its children). Rewrite to dash-containing names the parser keeps as
  // generic elements; the tag map aliases them back.
  for (const Tag of ['Link', 'Track', 'Source']) {
    body = body.replace(new RegExp(`<(/?)${Tag}\\b`, 'g'), `<$1gw-${Tag.toLowerCase()}`);
  }

  const doc = new DOMParser().parseFromString(`<div id="__gw_root">${body}</div>`, 'text/html');
  const root = doc.getElementById('__gw_root');
  return root ? collect(root.childNodes) : [];
}

function collect(list: NodeListOf<ChildNode>): TemplateNode[] {
  const out: TemplateNode[] = [];
  for (const n of Array.from(list)) {
    const node = domToNode(n);
    if (node) out.push(node);
  }
  return out;
}

function domToNode(n: ChildNode): TemplateNode | null {
  if (n.nodeType === 3) {
    const value = n.textContent ?? '';
    // Drop pure-whitespace text that carries no binding (formatting noise).
    if (value.trim() === '' && !value.includes('{{')) return null;
    return { kind: 'text', value };
  }
  if (n.nodeType === 1) {
    const el = n as Element;
    const attrs: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
    return { kind: 'element', tag: el.tagName.toLowerCase(), attrs, children: collect(el.childNodes) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tag + class mapping (declarative format → inert browser HTML)
// ---------------------------------------------------------------------------

interface TagMapping {
  tag: string;
  /** Extra inline style merged UNDER the template's own class/inline styles. */
  style?: string;
  /** Extra class appended (so the renderer's structural classes can attach). */
  className?: string;
}

/**
 * Allowlisted declarative tag (lowercased) → browser HTML element. Anything not
 * here and not in INTRINSIC_TAGS is dropped (children kept). Row/Column emit
 * flex so columns sit side-by-side like the email's table layout; Button emits
 * an anchor styled as a pill via the shared `.nl-button` class.
 */
const TAG_MAP: Record<string, TagMapping> = {
  section: { tag: 'div' },
  row: { tag: 'div', className: 'nl-row' },
  column: { tag: 'div', className: 'nl-column' },
  text: { tag: 'div' },
  heading: { tag: 'h2' },
  img: { tag: 'img' },
  button: { tag: 'a', className: 'nl-button' },
  link: { tag: 'a' },
  'gw-link': { tag: 'a' },
  a: { tag: 'a' },
  hr: { tag: 'hr' },
};

/** Inert HTML tags the renderer may emit verbatim (layout / inline formatting). */
const INTRINSIC_TAGS = new Set(['div', 'span', 'p', 'strong', 'em', 'b', 'i', 'u', 'br', 'ul', 'ol', 'li', 'small']);

/** Self-closing HTML elements (no children, no close tag). */
const VOID_TAGS = new Set(['img', 'hr', 'br']);

/** Attributes forwarded to the emitted element (after binding resolution). */
const PASSTHROUGH_ATTRS = ['href', 'src', 'alt', 'target', 'width', 'height', 'align'] as const;

/**
 * Shared declarative class names → the scoped preview CSS classes (see
 * newsletter-block-composer.component.scss, ported from the gatewaze
 * `_shared.ts` style objects). Anything not listed is passed through verbatim.
 */
const CLASS_MAP: Record<string, string> = {
  column: 'nl-column',
  card: 'nl-card',
  eyebrow: 'nl-eyebrow',
  title: 'nl-title',
  body: 'nl-body',
  link: 'nl-link',
  'brick-title': 'nl-brick-title',
  divider: 'nl-divider',
};

// ---------------------------------------------------------------------------
// Binding + serialisation helpers
// ---------------------------------------------------------------------------

function getPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[seg];
    return undefined;
  }, obj);
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return !!v;
}

/** Resolve `{{field}}` bindings in text, HTML-escaping each substituted value. */
function resolveBindings(text: string, content: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_, key: string) => {
    const v = getPath(content, key);
    return v == null ? '' : escapeHtml(String(v));
  });
}

/** Resolve `{{field}}` bindings for an attribute value (escaped for quotes). */
function resolveAttr(text: string, content: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_, key: string) => {
    const v = getPath(content, key);
    return v == null ? '' : String(v);
  });
}

function mergeItem(content: Record<string, unknown>, item: unknown): Record<string, unknown> {
  if (item && typeof item === 'object') return { ...content, ...(item as Record<string, unknown>), $item: item };
  return { ...content, $item: item };
}

/** Extract `field` from a single `{{field}}` text child (richtext shorthand). */
function bindingKeyFromChildren(children: TemplateNode[]): string | undefined {
  for (const c of children) {
    if (c.kind === 'text') {
      const m = c.value.match(/\{\{\s*([\w.$]+)\s*\}\}/);
      if (m) return m[1];
    }
  }
  return undefined;
}

/** Merge the template's inline `style` over an optional mapping base style. */
function mergedStyle(attrs: Record<string, string>, baseStyle?: string): string {
  const parts = [baseStyle, attrs['style']].filter((s): s is string => !!s && s.trim().length > 0);
  return parts.join('; ');
}

/** Map shared declarative classes to scoped preview classes; append an extra. */
function classList(attrs: Record<string, string>, extra?: string): string {
  const mapped = (attrs['class'] ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => CLASS_MAP[c] ?? c);
  if (extra) mapped.push(extra);
  return mapped.join(' ');
}

/** Resolve and serialise the passthrough attributes for an emitted element. */
function passthrough(_tag: string, attrs: Record<string, string>, content: Record<string, unknown>): string {
  const out: string[] = [];
  for (const a of PASSTHROUGH_ATTRS) {
    if (attrs[a] !== undefined) {
      out.push(`${a}="${escapeAttr(resolveAttr(attrs[a], content))}"`);
    }
  }
  return out.join(' ');
}

/** Assemble an opening tag with style / class / extra attrs. */
function openTag(tag: string, style: string, classes: string, extraAttrs = '', selfClose = false): string {
  const bits = [tag];
  if (classes) bits.push(`class="${escapeAttr(classes)}"`);
  if (style) bits.push(`style="${escapeAttr(style)}"`);
  if (extraAttrs) bits.push(extraAttrs);
  return `<${bits.join(' ')}${selfClose ? ' />' : '>'}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
