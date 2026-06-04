// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const STRIPPED_ATTRS = ['style', 'class', 'id', 'dir', 'lang', 'align', 'face', 'color', 'size', 'width', 'height'];
const UNWRAP_TAGS = new Set(['SPAN', 'FONT', 'O:P']);
const DROP_TAGS = new Set(['META', 'STYLE', 'SCRIPT', 'LINK', 'TITLE']);

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
  walkAndClean(body);

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

    // Drop every data-* attribute (GDocs leaves data-pm-slice and friends).
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('data-')) {
        node.removeAttribute(attr.name);
      }
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
