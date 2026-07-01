// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Returns a deterministic palette class for a donor name, used to
 * color-code donor avatars consistently across crowdfunding components.
 */
export function getDonorAvatarClass(name: string, palette: string[]): string {
  if (palette.length === 0) return '';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
  }
  return palette[Math.abs(hash) % palette.length];
}
