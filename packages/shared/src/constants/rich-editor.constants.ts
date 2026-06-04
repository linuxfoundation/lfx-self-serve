// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { RichEditorToolbarButton } from '../interfaces/rich-editor.interface';

export const STRIPPED_ATTRS = ['style', 'class', 'id', 'dir', 'lang', 'align', 'face', 'color', 'size', 'width', 'height'];
export const UNWRAP_TAGS = new Set(['SPAN', 'FONT', 'O:P']);
export const DROP_TAGS = new Set(['META', 'STYLE', 'SCRIPT', 'LINK', 'TITLE']);

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
