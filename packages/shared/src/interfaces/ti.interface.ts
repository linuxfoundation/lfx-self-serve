// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface TiCacheEntry {
  url: string | null; // null = confirmed TI miss; still cached to avoid re-fetching
  expiresAt: number;
}

export interface TiContentItem {
  id: string;
  asset: string;
}

export interface TiContentResponse {
  contentItems: TiContentItem[];
}
