// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DROP_TAGS, STRIPPED_ATTRS, UNWRAP_TAGS } from '@lfx-one/shared/constants';

export function cleanPastedHtml(html: string): string {
  if (!html || typeof DOMParser === 'undefined') {
    return html ?? '';
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const { body } = doc;
  if (!body) {
    return '';
  }

  unwrapGoogleDocsWrapper(body);
  absorbListContinuationParagraphs(body);
  walkAndClean(body);
  collapseEmptyBlocks(body);

  return body.innerHTML;
}

function unwrapGoogleDocsWrapper(body: HTMLElement): void {
  const wrapper = body.querySelector<HTMLElement>('b[id^="docs-internal-guid"], b[style*="font-weight:normal"], b[style*="font-weight: normal"]');
  if (wrapper && wrapper.parentElement === body) {
    while (wrapper.firstChild) {
      body.insertBefore(wrapper.firstChild, wrapper);
    }
    wrapper.remove();
  }
}

// Google Docs models continuation paragraphs under a bullet as a top-level <p style="margin-left:36pt">
// sandwiched between two <ul>/<ol> blocks. Stripping style erases the indent, so the paragraph collapses
// to flush-left and loses its visual relationship to the bullet. Move such paragraphs into the last <li>
// of the preceding list while inline styles are still readable.
function absorbListContinuationParagraphs(body: HTMLElement): void {
  // Walk deepest list first. If we processed outer-then-inner and the outer absorbed a paragraph
  // into its last <li>, that paragraph would become a sibling of any nested inner list inside that
  // <li>, and the inner list's pass could re-absorb it. Processing inner first means an inner list's
  // nextElementSibling can only be its original sibling, never a paragraph the outer just moved in.
  const lists = Array.from(body.querySelectorAll<HTMLElement>('ul, ol')).reverse();

  for (const list of lists) {
    const lastItem = list.querySelector<HTMLElement>(':scope > li:last-child');
    if (!lastItem) {
      continue;
    }
    const listIndent = readMarginLeftPt(lastItem) || readMarginLeftPt(list);
    if (listIndent <= 0) {
      // Without an explicit indent on the list, we can't tell whether a following indented
      // paragraph is a bullet continuation or unrelated content. Skip.
      continue;
    }

    let cursor: Element | null = list.nextElementSibling;
    while (cursor) {
      if (cursor.tagName !== 'P') {
        break;
      }

      if (isEmptyInlineContainer(cursor)) {
        // Skip Google Docs spacer paragraphs; Pass B will drop them.
        cursor = cursor.nextElementSibling;
        continue;
      }

      const paragraphIndent = readMarginLeftPt(cursor);
      // Allow ~1pt tolerance for rounding across unit conversions.
      if (paragraphIndent + 1 < listIndent) {
        break;
      }

      const next = cursor.nextElementSibling;
      lastItem.appendChild(cursor);
      cursor = next;
    }
  }
}

// Read margin-left from an element's inline style and normalize to points so we can compare values
// across units. We only care about relative magnitude (does this paragraph sit at or beyond the list's
// indent), so the approximations are good enough.
function readMarginLeftPt(element: Element): number {
  const style = element.getAttribute('style');
  if (!style) {
    return 0;
  }
  const match = /margin-left\s*:\s*(-?[\d.]+)\s*(pt|px|em|rem|in|cm|mm|%)?/i.exec(style);
  if (!match) {
    return 0;
  }
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }
  // CSS requires a unit on every non-zero margin. A unitless non-zero value is malformed and
  // could come from quirky source HTML — treat it as no indent rather than guessing pixels.
  if (!match[2] && value !== 0) {
    return 0;
  }
  const unit = (match[2] ?? 'pt').toLowerCase();
  switch (unit) {
    case 'pt':
      return value;
    case 'px':
      return value * 0.75;
    case 'em':
    case 'rem':
      return value * 12;
    case 'in':
      return value * 72;
    case 'cm':
      return value * 28.3464567;
    case 'mm':
      return value * 2.83464567;
    case '%':
      return value;
    default:
      return value;
  }
}

function isEmptyInlineContainer(element: Element): boolean {
  if (element.textContent && element.textContent.replace(/[\s\u00A0]/g, '') !== '') {
    return false;
  }
  for (const child of Array.from(element.children)) {
    if (child.tagName === 'BR') {
      continue;
    }
    if (!isEmptyInlineContainer(child)) {
      return false;
    }
  }
  return true;
}

const EMPTY_BLOCK_TAGS = new Set(['P', 'H2', 'H3', 'LI', 'UL', 'OL']);

// Replaced/void/embedded leaf elements carry visual content even when textContent is empty —
// e.g. <p><img></p> is not an empty paragraph. Without this, isEmptyBlock would silently drop
// any future content type the editor learns to render (images, media, embeds, form widgets).
// HTML elements always uppercase their tagName, but namespaced elements (SVG, MathML) preserve
// case, so we normalize via toUpperCase() at the lookup site rather than maintaining both forms.
const CONTENT_LEAF_TAGS = new Set([
  'IMG',
  'IFRAME',
  'VIDEO',
  'AUDIO',
  'SOURCE',
  'PICTURE',
  'SVG',
  'MATH',
  'CANVAS',
  'EMBED',
  'OBJECT',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'HR',
]);

// Google Docs (and Word) inject empty <p style="height:11pt"><span></span></p> nodes as blank-line
// spacers between content blocks. After style/class strip, the editor's `p { margin: 0 0 0.75rem }`
// renders each as ~14px of dead space — multiple spacers stack into the gaps the user is reporting.
// Walk inside-out so that lists which contain only empty <li> children also drop.
function collapseEmptyBlocks(root: HTMLElement): void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('p, h2, h3, li, ul, ol'));
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!EMPTY_BLOCK_TAGS.has(node.tagName)) {
      continue;
    }
    if (!node.isConnected) {
      continue;
    }
    if (isEmptyBlock(node)) {
      node.remove();
    }
  }
}

function isEmptyBlock(element: Element): boolean {
  if (element.textContent && element.textContent.replace(/[\s\u00A0]/g, '') !== '') {
    return false;
  }
  for (const child of Array.from(element.children)) {
    if (child.tagName === 'BR') {
      continue;
    }
    if (CONTENT_LEAF_TAGS.has(child.tagName.toUpperCase())) {
      return false;
    }
    if (EMPTY_BLOCK_TAGS.has(child.tagName)) {
      // A list with all-empty children would have had its children removed earlier in the
      // inside-out walk, so reaching here means a non-empty descendant survived.
      return false;
    }
    if (!isEmptyBlock(child)) {
      return false;
    }
  }
  return true;
}

function walkAndClean(root: Element): void {
  // Walk a static snapshot so DOM mutations during the loop don't skip nodes.
  const nodes = Array.from(root.querySelectorAll('*'));

  for (const node of nodes) {
    const tag = node.tagName;

    if (DROP_TAGS.has(tag)) {
      node.remove();
      continue;
    }

    // Promote GDocs-style inline formatting (font-weight, font-style, text-decoration)
    // to semantic tags before the style attr gets stripped or the wrapper unwrapped.
    promoteInlineStyles(node);

    if (UNWRAP_TAGS.has(tag)) {
      unwrap(node);
      continue;
    }

    for (const attr of STRIPPED_ATTRS) {
      if (node.hasAttribute(attr)) {
        node.removeAttribute(attr);
      }
    }

    // Drop every data-* attribute (GDocs leaves data-pm-slice and friends) and any
    // inline event handler (on*) that could execute script from pasted content.
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('data-') || /^on/i.test(attr.name)) {
        node.removeAttribute(attr.name);
      }
    }

    if (tag === 'A' && node.hasAttribute('href') && !/^(https?:\/\/|mailto:)/i.test(node.getAttribute('href') ?? '')) {
      node.removeAttribute('href');
    }
  }

  removeComments(root);
}

function promoteInlineStyles(node: Element): void {
  const style = node.getAttribute('style');
  if (!style) {
    return;
  }

  const weight = /font-weight\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();
  const fontStyle = /font-style\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();
  const textDeco = /text-decoration(?:-line)?\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();

  const numericWeight = weight ? parseInt(weight, 10) : NaN;
  const isBold = weight === 'bold' || weight === 'bolder' || (!Number.isNaN(numericWeight) && numericWeight >= 600);
  const isItalic = fontStyle === 'italic' || fontStyle === 'oblique';
  const isUnderline = !!textDeco?.includes('underline');
  const isStrike = !!textDeco?.includes('line-through');

  if (!isBold && !isItalic && !isUnderline && !isStrike) {
    return;
  }

  if (!node.hasChildNodes()) {
    return;
  }

  const doc = node.ownerDocument;
  const tags: string[] = [];
  if (isBold) tags.push('strong');
  if (isItalic) tags.push('em');
  if (isUnderline) tags.push('u');
  if (isStrike) tags.push('s');

  let outer: Element | null = null;
  let inner: Element | null = null;
  for (const tag of tags) {
    const el = doc.createElement(tag);
    if (!outer) {
      outer = el;
    }
    if (inner) {
      inner.appendChild(el);
    }
    inner = el;
  }

  if (!outer || !inner) {
    return;
  }

  while (node.firstChild) {
    inner.appendChild(node.firstChild);
  }
  node.appendChild(outer);
}

function unwrap(node: Element): void {
  const parent = node.parentNode;
  if (!parent) {
    return;
  }
  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  parent.removeChild(node);
}

function removeComments(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  let current = walker.nextNode();
  while (current) {
    comments.push(current as Comment);
    current = walker.nextNode();
  }
  for (const comment of comments) {
    comment.remove();
  }
}
