// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const PERSON_AVATAR_PALETTE = [
  'bg-violet-600',
  'bg-cyan-600',
  'bg-amber-500',
  'bg-blue-700',
  'bg-emerald-600',
  'bg-red-600',
  'bg-indigo-500',
  'bg-slate-900',
  'bg-pink-700',
];

/** Initials from a name: first char of the first two tokens, uppercased; `'?'` when empty. */
export function computePersonInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/** Deterministic Tailwind bg class for a person avatar — same `personKey` ⇒ same colour. */
export function computePersonAvatarColorClass(personKey: string): string {
  let hash = 0;
  for (let i = 0; i < personKey.length; i++) {
    hash = ((hash << 5) - hash + personKey.charCodeAt(i)) | 0;
  }
  return PERSON_AVATAR_PALETTE[Math.abs(hash) % PERSON_AVATAR_PALETTE.length];
}
