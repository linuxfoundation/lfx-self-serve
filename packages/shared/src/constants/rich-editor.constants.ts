// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { RichEditorToolbarButton } from '../interfaces/rich-editor.interface';

export const STRIPPED_ATTRS = ['style', 'class', 'id', 'dir', 'lang', 'align', 'face', 'color', 'size', 'width', 'height'];
export const UNWRAP_TAGS = new Set(['SPAN', 'FONT', 'O:P']);
export const DROP_TAGS = new Set(['META', 'STYLE', 'SCRIPT', 'LINK', 'TITLE']);

// Block-level structural tags the editor renders with margin; treated as removable
// when empty so Google Docs blank-line spacers don't survive a paste cleanup.
export const EMPTY_BLOCK_TAGS = new Set(['P', 'H2', 'H3', 'LI', 'UL', 'OL']);

// Replaced/void/embedded leaf elements that carry visual content even when textContent
// is empty — keep paragraphs/list-items that hold these even if no text is present.
export const CONTENT_LEAF_TAGS = new Set([
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

// Paragraph-like containers where a <br> child is a legitimate hard break (not a
// block-flow spacer). Used to decide whether a pasted <br> should be preserved.
export const PARAGRAPH_LIKE_TAGS = new Set(['P', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION', 'PRE']);

export const RICH_EDITOR_TOOLBAR_BUTTONS: readonly RichEditorToolbarButton[] = [
  { id: 'h2', icon: 'fa-light fa-h2', label: 'Heading 2', command: 'h2', activeKey: 'heading', activeAttrs: { level: 2 } },
  { id: 'h3', icon: 'fa-light fa-h3', label: 'Heading 3', command: 'h3', activeKey: 'heading', activeAttrs: { level: 3 } },
  { id: 'bold', icon: 'fa-light fa-bold', label: 'Bold', command: 'bold', activeKey: 'bold' },
  { id: 'italic', icon: 'fa-light fa-italic', label: 'Italic', command: 'italic', activeKey: 'italic' },
  { id: 'underline', icon: 'fa-light fa-underline', label: 'Underline', command: 'underline', activeKey: 'underline', divider: true },
  { id: 'strike', icon: 'fa-light fa-strikethrough', label: 'Strikethrough', command: 'strike', activeKey: 'strike', divider: true },
  { id: 'bulletList', icon: 'fa-light fa-list-ul', label: 'Bullet list', command: 'bulletList', activeKey: 'bulletList' },
  { id: 'orderedList', icon: 'fa-light fa-list-ol', label: 'Numbered list', command: 'orderedList', activeKey: 'orderedList', divider: true },
  { id: 'link', icon: 'fa-light fa-link', label: 'Link', command: 'link', activeKey: 'link' },
  { id: 'clear', icon: 'fa-light fa-eraser', label: 'Clear formatting', command: 'clear' },
];
