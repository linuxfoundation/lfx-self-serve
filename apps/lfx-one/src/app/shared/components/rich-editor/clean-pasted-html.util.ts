// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const STRIPPED_ATTRS = ['style', 'class', 'id', 'dir', 'lang', 'align', 'face', 'color', 'size', 'width', 'height'];
const UNWRAP_TAGS = new Set(['SPAN', 'FONT', 'O:P']);
const DROP_TAGS = new Set(['META', 'STYLE', 'SCRIPT', 'LINK', 'TITLE']);

export function cleanPastedHtml(html: string): string {
  if (!html) {
    return '';
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
