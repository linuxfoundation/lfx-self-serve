// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ItOsChatNote, ItOsDnsRecord, ItOsPlanRowView, ItOsPlanView } from '@lfx-one/shared/interfaces';

// Small HTML builders for IT OS agent chat messages. Every value from data or the user goes through
// `esc`, and the result is rendered with [innerHTML], which Angular sanitizes again. Tailwind classes
// live here (inside Tailwind's `content`) so they are generated.

export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export const mono = (value: unknown): string => `<code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.92em] text-gray-800">${esc(value)}</code>`;

export const muted = (html: string): string => `<p class="text-xs text-gray-500">${html}</p>`;

export const plural = (n: number, word: string, words = `${word}s`): string => `${n} ${n === 1 ? word : words}`;

/** Up to three names in full, otherwise the first two and a count. */
export const listNames = (names: string[]): string =>
  names.length <= 3 ? names.map(mono).join(', ') : `${names.slice(0, 2).map(mono).join(', ')} and ${names.length - 2} more`;

const TONE_ICON: Record<string, string> = {
  ok: 'fa-solid fa-circle-check text-emerald-600',
  warn: 'fa-solid fa-triangle-exclamation text-amber-600',
  bad: 'fa-solid fa-circle-xmark text-red-600',
  info: 'fa-solid fa-circle-info text-blue-600',
};

export const toneIcon = (tone: string): string => `<i class="${TONE_ICON[tone] ?? TONE_ICON['info']}" aria-hidden="true"></i>`;

/** A tone icon with readable text beside it, for table cells where the icon alone would read as empty. */
export const toneLabel = (tone: string, label: string): string => `<span class="inline-flex items-center gap-1">${toneIcon(tone)}${esc(label)}</span>`;

export const htmlTable = (headers: string[], rows: string[][]): string =>
  `<div class="overflow-x-auto rounded-md border border-gray-200"><table class="w-full text-left text-xs"><thead class="bg-gray-50"><tr>${headers
    .map((h) => `<th class="px-2 py-1.5 font-medium text-gray-500">${h}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr class="border-t border-gray-100">${r.map((c) => `<td class="px-2 py-1.5 align-top">${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;

export const recordTable = (records: ItOsDnsRecord[]): string =>
  htmlTable(
    ['Type', 'Name', 'Value'],
    records.map((r) => [
      `<b>${esc(r.type)}</b>`,
      mono(r.name),
      `${r.prio !== undefined ? `<span class="text-gray-500">${r.prio}</span> ` : ''}${mono(r.content)}`,
    ])
  );

const NOTE_CLASSES: Record<string, string> = {
  ok: 'bg-emerald-50',
  warn: 'bg-amber-50',
  info: 'bg-blue-50',
};

export const notesHtml = (notes: ItOsChatNote[]): string =>
  notes
    .map(
      (n) =>
        `<p class="flex items-start gap-2 rounded-md px-3 py-2 ${NOTE_CLASSES[n.tone] ?? NOTE_CLASSES['info']}">${toneIcon(n.tone)}<span>${esc(n.text)}</span></p>`
    )
    .join('');

export const formatDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * Index of the one chat message whose controls are live: the newest message that has controls, unless it
 * was already used or its plan is no longer open. -1 when nothing is waiting on the user. Informational
 * replies in between don't retire it; a newer message with controls does.
 */
export const activeIndexOf = <T extends { fromUser?: boolean; used?: boolean; plan?: { state: string } }>(
  messages: T[],
  hasControls: (message: T) => boolean
): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.fromUser || !hasControls(message)) continue;
    return !message.used && (!message.plan || message.plan.state === 'open') ? i : -1;
  }
  return -1;
};

/** Builds what the chat shows for a plan, so the template reads values instead of calling methods. */
export const planView = <C extends { on: boolean }>(changes: C[], row: (change: C) => ItOsPlanRowView): ItOsPlanView => {
  const rows = changes.map(row);
  const on = changes.filter((c) => c.on).length;
  const approval = changes.filter((c, i) => c.on && rows[i].needsApproval).length;
  let confirmLabel = `Apply ${on === 1 ? '1 change' : `${on} changes`}`;
  if (on && approval === on) confirmLabel = 'Submit for approval';
  else if (approval) confirmLabel = `Apply ${on - approval}, submit ${approval}`;
  return { rows, on, approval, confirmLabel };
};

/** Autoscroll key for a conversation: the message count and the newest message's progress step. */
export const scrollKeyOf = (messages: { shown?: number }[]): string => `${messages.length}:${messages[messages.length - 1]?.shown ?? 0}`;
