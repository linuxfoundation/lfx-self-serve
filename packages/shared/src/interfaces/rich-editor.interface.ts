// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface RichEditorToolbarButton {
  id: string;
  icon: string;
  label: string;
  command: 'h2' | 'h3' | 'bold' | 'italic' | 'underline' | 'strike' | 'bulletList' | 'orderedList' | 'link' | 'clear';
  activeKey?: string;
  activeAttrs?: Record<string, unknown>;
  divider?: boolean;
}
