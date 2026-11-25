// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHARE_KIT_SLUG_PATTERN } from '@lfx-one/shared/constants';
import { ShareKitContent, ShareKitLoadResult } from '@lfx-one/shared/interfaces';
import { validateShareKitContent } from '@lfx-one/shared/server';

import { logger } from './logger.service';

/**
 * Resolves `apps/lfx-one/content/events`. Both runtime layouts put this file three levels below
 * `apps/lfx-one/` (dev: `src/server/services/`, bundle: `dist/lfx-one/server/`), the same climb
 * `sitemap.route.ts` uses for `dist-docs`. The Docker runtime stage copies `apps/lfx-one/content`.
 */
export function resolveShareKitContentDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'content', 'events');
}

/**
 * Reads and validates every `<eventSlug>/share-kit.json` under `contentDir` once. Content is plain JSON
 * owned by the content team; a file that fails validation is logged with its slug and problems and
 * marked invalid, so one bad file never takes the others down.
 */
export function loadShareKits(contentDir: string): ShareKitLoadResult {
  const kits = new Map<string, ShareKitContent>();
  const invalid = new Set<string>();

  if (!existsSync(contentDir)) {
    logger.warning(undefined, 'load_share_kits', 'Share kit content folder not found; no share kits will be served', { content_dir: contentDir });
    return { kits, invalid };
  }

  for (const entry of readdirSync(contentDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SHARE_KIT_SLUG_PATTERN.test(entry.name)) {
      continue;
    }
    const file = resolve(contentDir, entry.name, 'share-kit.json');
    if (!existsSync(file)) {
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      invalid.add(entry.name);
      logger.warning(undefined, 'load_share_kits', 'Share kit content is not valid JSON', { event_slug: entry.name });
      continue;
    }

    const result = validateShareKitContent(raw, entry.name);
    if (result.ok && result.content) {
      kits.set(entry.name, result.content);
    } else {
      invalid.add(entry.name);
      logger.warning(undefined, 'load_share_kits', 'Share kit content failed validation', { event_slug: entry.name, problems: result.problems });
    }
  }

  logger.info(undefined, 'load_share_kits', 'Loaded share kit content', { loaded: kits.size, invalid: invalid.size });
  return { kits, invalid };
}

/** Serves share kit content loaded once at startup. */
export class ShareKitService {
  public constructor(private readonly loaded: ShareKitLoadResult = loadShareKits(resolveShareKitContentDir())) {}

  /** Public view of a kit: everything in the content file. Member-only fields (#6061) are never part of it. */
  public getShareKit(eventSlug: string): ShareKitContent | null {
    return this.loaded.kits.get(eventSlug) ?? null;
  }

  public isInvalid(eventSlug: string): boolean {
    return this.loaded.invalid.has(eventSlug);
  }
}
