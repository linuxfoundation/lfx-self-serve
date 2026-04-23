// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKS_CONFIG } from '../constants/links.config';

export function buildInsightsUrl(path: string = ''): string {
  if (!path) {
    return LINKS_CONFIG.INSIGHTS.BASE;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${LINKS_CONFIG.INSIGHTS.BASE}${normalizedPath}`;
}
