// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';
import {
  GW_EMBED_STYLESHEET_IMMUTABLE_MAX_AGE_S,
  GW_EMBED_STYLESHEET_MAX_AGE_S,
  GW_EMBED_STYLESHEET_STALE_WHILE_REVALIDATE_S,
} from '@lfx-one/shared/constants';
import { GwEmbedScopedStylesheet, GwEmbedStylesheetVariant } from '@lfx-one/shared/interfaces';

import { getGwEmbedStylesheetKey } from './gw-embed.helper';

// The response decisions for the scoped embed stylesheet, kept out of its controller
// (gw-embed-stylesheet.controller.ts), which only validates the request and writes the answer.

/**
 * The `Cache-Control` for a served sheet: the revalidating policy for the unkeyed form, `immutable`
 * for this server's own key, and `no-store` for any other key (see the controller).
 */
export function gwEmbedStylesheetCacheControl(key: string | undefined): string {
  if (key === undefined) {
    return `public, max-age=${GW_EMBED_STYLESHEET_MAX_AGE_S}, stale-while-revalidate=${GW_EMBED_STYLESHEET_STALE_WHILE_REVALIDATE_S}`;
  }
  // The theme was read moments ago to build the sheet, so this does not throw in practice; if it
  // did, the key cannot be vouched for, which is the same answer as a mismatch.
  let ownKey: string | null;
  try {
    ownKey = getGwEmbedStylesheetKey('gw_embed_stylesheet');
  } catch {
    ownKey = null;
  }
  return key === ownKey ? `public, max-age=${GW_EMBED_STYLESHEET_IMMUTABLE_MAX_AGE_S}, immutable` : 'no-store';
}

/** Brotli, then gzip, then the plain body, honouring the client's q-values (Express's negotiator). */
export function pickGwEmbedStylesheetEncoding(req: Request, sheet: GwEmbedScopedStylesheet): GwEmbedStylesheetVariant {
  const accepted = req.acceptsEncodings('br', 'gzip', 'identity');
  if (accepted === 'br') {
    return { encoding: 'br', body: sheet.br };
  }
  if (accepted === 'gzip') {
    return { encoding: 'gzip', body: sheet.gzip };
  }
  return { encoding: 'identity', body: sheet.identity };
}

/** `If-None-Match` is a list and its entries may be weak; the comparison is weak, as RFC 9110 has it for GET. */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (!header) {
    return false;
  }
  return header.split(',').some((entry) => {
    const candidate = entry.trim().replace(/^W\//, '');
    return candidate === '*' || candidate === etag;
  });
}
