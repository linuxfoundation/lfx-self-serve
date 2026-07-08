// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { OrganizationSuggestion } from '../interfaces';
import { matchesOrgQuery, mergeOrgSuggestions, normalizeOrgKey } from './org.utils';

/** Builds an OrganizationSuggestion fixture, defaulting fields so tests set only what they assert on. */
function org(partial: Partial<OrganizationSuggestion>): OrganizationSuggestion {
  return {
    name: 'Acme',
    domain: '',
    ...partial,
  };
}

describe('normalizeOrgKey', () => {
  it('keys by domain when present, ignoring case, scheme, www, and trailing slash', () => {
    expect(normalizeOrgKey(org({ name: 'Example', domain: 'https://WWW.Example.com/' }))).toBe('domain:example.com');
    expect(normalizeOrgKey(org({ name: 'Different Name', domain: 'example.com' }))).toBe('domain:example.com');
  });

  it('falls back to the normalized name when there is no domain', () => {
    expect(normalizeOrgKey(org({ name: '  VelocityEngine ', domain: '' }))).toBe('name:velocityengine');
  });

  it('never collides a name key with a domain key', () => {
    expect(normalizeOrgKey(org({ name: 'example.com', domain: '' }))).not.toBe(normalizeOrgKey(org({ name: 'x', domain: 'example.com' })));
  });

  it('keys a scheme-less host with a path the same as the bare host', () => {
    expect(normalizeOrgKey(org({ name: 'x', domain: 'example.com/path' }))).toBe(normalizeOrgKey(org({ name: 'y', domain: 'example.com' })));
  });

  it('returns a deterministic key without throwing on an unparseable scheme value', () => {
    const key = normalizeOrgKey(org({ name: 'x', domain: 'https://[' }));
    expect(typeof key).toBe('string');
    expect(normalizeOrgKey(org({ name: 'x', domain: 'https://[' }))).toBe(key);
  });
});

describe('matchesOrgQuery', () => {
  it('matches by case-insensitive name substring', () => {
    expect(matchesOrgQuery(org({ name: 'VelocityEngine' }), 'velo')).toBe(true);
    expect(matchesOrgQuery(org({ name: 'VelocityEngine' }), 'ENGINE')).toBe(true);
  });

  it('does not match on an empty or whitespace query', () => {
    expect(matchesOrgQuery(org({ name: 'VelocityEngine' }), '')).toBe(false);
    expect(matchesOrgQuery(org({ name: 'VelocityEngine' }), '   ')).toBe(false);
  });

  it('does not match unrelated names', () => {
    expect(matchesOrgQuery(org({ name: 'Acme' }), 'velo')).toBe(false);
  });
});

describe('mergeOrgSuggestions', () => {
  it('returns local entries ahead of remote entries', () => {
    const local = [org({ name: 'VelocityEngine' })];
    const remote = [org({ name: 'Acme', domain: 'acme.com' })];
    expect(mergeOrgSuggestions(local, remote).map((o) => o.name)).toEqual(['VelocityEngine', 'Acme']);
  });

  it('drops a remote entry that duplicates a local one by domain, keeping the local casing and logo', () => {
    const local = [org({ name: 'Example Inc', domain: 'example.com', logo: 'https://logo/local.png' })];
    const remote = [org({ name: 'example', domain: 'https://www.example.com', logo: 'https://logo/remote.png' })];
    const merged = mergeOrgSuggestions(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(local[0]);
  });

  it('dedupes by name when neither entry has a domain', () => {
    const local = [org({ name: 'VelocityEngine' })];
    const remote = [org({ name: 'velocityengine' })];
    expect(mergeOrgSuggestions(local, remote)).toHaveLength(1);
  });

  it('passes remote through when local is empty', () => {
    const remote = [org({ name: 'Acme', domain: 'acme.com' }), org({ name: 'Beta', domain: 'beta.com' })];
    expect(mergeOrgSuggestions([], remote)).toEqual(remote);
  });

  it('returns local when remote is empty', () => {
    const local = [org({ name: 'VelocityEngine' })];
    expect(mergeOrgSuggestions(local, [])).toEqual(local);
  });

  it('collapses a domainless session org into the canonical domained one with the same name', () => {
    const local = [org({ name: 'Google', domain: '' })];
    const remote = [org({ name: 'google', domain: 'google.com', logo: 'https://logo/google.png' })];
    const merged = mergeOrgSuggestions(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].domain).toBe('google.com');
    expect(merged[0].logo).toBe('https://logo/google.png');
  });

  it('dedupes within the local list itself', () => {
    const local = [org({ name: 'VelocityEngine' }), org({ name: 'velocityengine' })];
    expect(mergeOrgSuggestions(local, [])).toHaveLength(1);
  });
});
