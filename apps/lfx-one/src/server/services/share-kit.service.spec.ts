// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateShareKitContent } from '@lfx-one/shared/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { loadShareKits, resolveShareKitContentDir, ShareKitService } from './share-kit.service';

const validKit = (slug: string) => ({
  eventSlug: slug,
  foundationSlug: 'example-foundation',
  foundationName: 'Example Foundation',
  title: 'Example Summit',
  tagline: 'A conference for people building example software.',
  startDate: '2027-04-28',
  endDate: '2027-04-29',
  venue: 'Example Hall',
  city: 'Example City',
  eventUrl: 'https://events.example.org/summit/',
  registration: { url: 'https://events.example.org/summit/register/', priceLabel: '$399' },
  posts: [{ id: 'invite', title: 'Invite your network', text: { linkedin: 'Join us.', x: 'Join us.', bluesky: 'Join us.' } }],
  newsletterBlurb: { text: 'Example Summit takes place in April.', url: 'https://events.example.org/summit/' },
  graphics: [],
});

describe('loadShareKits', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function writeKit(slug: string, body: string): void {
    mkdirSync(join(dir, slug), { recursive: true });
    writeFileSync(join(dir, slug, 'share-kit.json'), body);
  }

  it('keys valid kits by slug and marks invalid ones without serving them', () => {
    dir = mkdtempSync(join(tmpdir(), 'share-kits-'));
    writeKit('good-event', JSON.stringify(validKit('good-event')));
    writeKit('bad-event', JSON.stringify({ ...validKit('bad-event'), eventUrl: 'http://insecure.example.org/' }));
    writeKit('broken-json', '{ not json');
    writeKit('wrong-slug', JSON.stringify(validKit('another-slug')));

    const { kits, invalid } = loadShareKits(dir);

    expect([...kits.keys()]).toEqual(['good-event']);
    expect([...invalid].sort()).toEqual(['bad-event', 'broken-json', 'wrong-slug']);
  });

  it('returns nothing when the content folder is missing', () => {
    const { kits, invalid } = loadShareKits(join(tmpdir(), 'share-kits-missing-folder'));
    expect(kits.size).toBe(0);
    expect(invalid.size).toBe(0);
  });

  it('serves a kit by slug and reports unknown and invalid slugs', () => {
    dir = mkdtempSync(join(tmpdir(), 'share-kits-'));
    writeKit('good-event', JSON.stringify(validKit('good-event')));
    writeKit('bad-event', '{}');
    const service = new ShareKitService(loadShareKits(dir));

    expect(service.getShareKit('good-event')?.title).toBe('Example Summit');
    expect(service.getShareKit('unknown-event')).toBeNull();
    expect(service.isInvalid('bad-event')).toBe(true);
    expect(service.getShareKit('bad-event')).toBeNull();
  });
});

// Content PRs come from non-engineers: every committed content file must validate, so a bad file fails CI
// here instead of shipping and returning a 500.
describe('committed share kit content', () => {
  const contentDir = resolveShareKitContentDir();
  const slugs = readdirSync(contentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('every share-kit.json validates and its in-app graphics exist', () => {
    const publicDir = join(contentDir, '..', '..', 'public');
    for (const slug of slugs) {
      const raw = JSON.parse(readFileSync(join(contentDir, slug, 'share-kit.json'), 'utf8'));
      const result = validateShareKitContent(raw, slug);
      expect(result.problems, `${slug}/share-kit.json`).toEqual([]);

      const localImages = [...raw.graphics.map((graphic: { url: string }) => graphic.url), raw.ogImage?.url].filter(
        (url): url is string => typeof url === 'string' && url.startsWith('/')
      );
      for (const url of localImages) {
        expect(existsSync(join(publicDir, url)), `${slug}: ${url} is missing from apps/lfx-one/public`).toBe(true);
      }
    }
  });
});
