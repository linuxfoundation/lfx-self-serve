// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the spec-driven Marketing OS artifact key helpers. The key
// layout is a security surface (partitions are storage boundaries), so the
// validation gates are asserted as hard behaviour, not as documentation.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MKTG_ARTIFACT_SPECS } from '../constants/mktg-artifact.constants';
import { buildBrandKitObjectKey } from './brand-kit.utils';
import { buildMktgArtifactObjectKey, buildMktgArtifactPartitionPrefix, extractMktgArtifactKeySha } from './mktg-artifact.utils';

const BRAND_KIT = MKTG_ARTIFACT_SPECS['brand-kit'];
const FOUNDATION_MESSAGE = MKTG_ARTIFACT_SPECS['foundation-message'];
const ICP = MKTG_ARTIFACT_SPECS['icp'];

const sha = createHash('sha256').update('doc', 'utf8').digest('hex');

describe('MKTG_ARTIFACT_SPECS', () => {
  it('gives every registered agent a distinct key prefix so partitions never collide', () => {
    const prefixes = Object.values(MKTG_ARTIFACT_SPECS).map((spec) => spec.keyPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('keys every entry by its own agentKey — a spec passed alone still names its agent', () => {
    for (const [key, spec] of Object.entries(MKTG_ARTIFACT_SPECS)) {
      expect(spec.agentKey).toBe(key);
    }
  });
});

describe('buildMktgArtifactObjectKey', () => {
  it('derives the content-addressed key per agent spec from validated fields', () => {
    expect(buildMktgArtifactObjectKey(BRAND_KIT, 'proj-uid-1', sha)).toBe(`brand-kit/proj-uid-1/${sha}.md`);
    expect(buildMktgArtifactObjectKey(FOUNDATION_MESSAGE, 'proj-uid-1', sha)).toBe(`foundation-message/proj-uid-1/${sha}.md`);
    // Adding an agent is an entry in the spec table — no new implementation.
    expect(buildMktgArtifactObjectKey(ICP, 'proj-uid-1', sha)).toBe(`icp/proj-uid-1/${sha}.md`);
  });

  it('throws on an unvalidated partition or sha (never client-supplied paths)', () => {
    expect(() => buildMktgArtifactObjectKey(BRAND_KIT, '../escape', sha)).toThrow();
    expect(() => buildMktgArtifactObjectKey(BRAND_KIT, 'proj/uid', sha)).toThrow();
    expect(() => buildMktgArtifactObjectKey(BRAND_KIT, 'proj-uid-1', 'not-a-sha')).toThrow();
  });

  it('keeps the Brand Kit key byte-identical through its own binding — migration changed no key', () => {
    expect(buildBrandKitObjectKey('proj-uid-1', sha)).toBe(buildMktgArtifactObjectKey(BRAND_KIT, 'proj-uid-1', sha));
    expect(buildBrandKitObjectKey('proj-uid-1', sha)).toBe(`brand-kit/proj-uid-1/${sha}.md`);
  });
});

describe('buildMktgArtifactPartitionPrefix', () => {
  it('lists exactly what the write path writes into — a stored document is never invisible to its project', () => {
    const prefix = buildMktgArtifactPartitionPrefix(FOUNDATION_MESSAGE, 'proj-uid-1');
    expect(prefix).toBe('foundation-message/proj-uid-1/');
    expect(buildMktgArtifactObjectKey(FOUNDATION_MESSAGE, 'proj-uid-1', sha).startsWith(prefix)).toBe(true);
  });

  it('throws on an unvalidated partition', () => {
    expect(() => buildMktgArtifactPartitionPrefix(FOUNDATION_MESSAGE, '../escape')).toThrow();
  });
});

describe('extractMktgArtifactKeySha', () => {
  const prefix = buildMktgArtifactPartitionPrefix(BRAND_KIT, 'proj-uid-1');

  it('returns the sha of a content-addressed document key', () => {
    expect(extractMktgArtifactKeySha(`${prefix}${sha}.md`, prefix)).toBe(sha);
  });

  it('returns null for anything else sharing the partition', () => {
    expect(extractMktgArtifactKeySha(`${prefix}notes.txt`, prefix)).toBeNull();
    expect(extractMktgArtifactKeySha(`${prefix}not-a-sha.md`, prefix)).toBeNull();
    expect(extractMktgArtifactKeySha(`brand-kit/other-project/${sha}.md`, prefix)).toBeNull();
  });
});
