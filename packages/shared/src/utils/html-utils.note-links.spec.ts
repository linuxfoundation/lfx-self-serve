// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { emailLinkMatchKey, extractHttpLinks, stripResourceLoadingHtml } from './html-utils';

describe('extractHttpLinks', () => {
  it('reads every address in the notes, without the punctuation that follows it', () => {
    const notes = [
      'Guide is out: https://acme.example/blog/guide/.',
      'Events (https://Acme.example/events) and a report: https://acme.example/report?year=2026&x=1#top,',
      'not links: ftp://acme.example/file, acme.example/bare',
    ].join('\n');

    expect(extractHttpLinks(notes)).toEqual([
      'https://acme.example/blog/guide/',
      'https://acme.example/events',
      'https://acme.example/report?year=2026&x=1#top',
    ]);
  });

  it('keeps a closing bracket the address itself opened, and drops one the prose opened', () => {
    expect(extractHttpLinks('Background: https://acme.example/wiki/Guide_(2026).')).toEqual(['https://acme.example/wiki/Guide_(2026)']);
    expect(extractHttpLinks('(see https://acme.example/wiki/Guide_(2026))')).toEqual(['https://acme.example/wiki/Guide_(2026)']);
    expect(extractHttpLinks('(see https://acme.example/plain)')).toEqual(['https://acme.example/plain']);
  });

  it('lists an address once, however its scheme and host are cased', () => {
    expect(extractHttpLinks('https://acme.example/a HTTPS://ACME.example/a https://acme.example/a/ https://acme.example/a#again')).toEqual([
      'https://acme.example/a',
      'https://acme.example/a/',
      'https://acme.example/a#again',
    ]);
  });

  it("keeps a delimited address's trailing punctuation, which open prose loses", () => {
    expect(extractHttpLinks(`Download <https://acme.example/d?token=abc!> or "https://acme.example/q?x=1." or 'https://acme.example/s?y=2;'`)).toEqual([
      'https://acme.example/d?token=abc!',
      'https://acme.example/q?x=1.',
      'https://acme.example/s?y=2;',
    ]);
    expect(extractHttpLinks('see https://acme.example/prose.')).toEqual(['https://acme.example/prose']);
  });

  it('refuses what canonicalHttpUrl refuses, so a note cannot vouch for a private host', () => {
    expect(extractHttpLinks('http://localhost:4200/x http://10.0.0.1/y https://acme.example/z')).toEqual(['https://acme.example/z']);
  });

  it('stops at the limit and answers [] for anything that is not text', () => {
    expect(extractHttpLinks('https://acme.example/1 https://acme.example/2 https://acme.example/3', 2)).toHaveLength(2);
    expect(extractHttpLinks(undefined)).toEqual([]);
    expect(extractHttpLinks('')).toEqual([]);
    expect(extractHttpLinks(42)).toEqual([]);
  });
});

describe('emailLinkMatchKey', () => {
  it('folds only the case of the scheme and host, and reads an empty path as "/"', () => {
    expect(emailLinkMatchKey('HTTPS://Acme.example/Events/#agenda')).toBe('https://acme.example/Events/#agenda');
    expect(emailLinkMatchKey('https://acme.example')).toBe(emailLinkMatchKey('https://acme.example/'));
  });

  it('keeps a trailing slash, the fragment and a slash inside the query, which can each name another destination', () => {
    expect(emailLinkMatchKey('https://acme.example/report')).not.toBe(emailLinkMatchKey('https://acme.example/report/'));
    expect(emailLinkMatchKey('https://acme.example/report#results')).not.toBe(emailLinkMatchKey('https://acme.example/report#invented'));
    expect(emailLinkMatchKey('https://acme.example/d?file=reports/')).not.toBe(emailLinkMatchKey('https://acme.example/d?file=reports'));
  });

  it('forgives only the order of query parameters, which campaign-service sorts when it sanitises an anchor', () => {
    expect(emailLinkMatchKey('https://acme.example/r?year=2026&format=pdf')).toBe(emailLinkMatchKey('https://acme.example/r?format=pdf&year=2026'));
    expect(emailLinkMatchKey('https://acme.example/r?year=2026&format=pdf')).not.toBe(emailLinkMatchKey('https://acme.example/r?format=pdf&year=2025'));
  });

  it('keeps the path case and the query, which can both be significant', () => {
    expect(emailLinkMatchKey('https://acme.example/events?id=1')).not.toBe(emailLinkMatchKey('https://acme.example/events?id=2'));
    expect(emailLinkMatchKey('https://acme.example/Events')).not.toBe(emailLinkMatchKey('https://acme.example/events'));
  });

  it("is '' for anything that is not a public http(s) address", () => {
    expect(emailLinkMatchKey('javascript:alert(1)')).toBe('');
    expect(emailLinkMatchKey('/relative')).toBe('');
    expect(emailLinkMatchKey(undefined)).toBe('');
  });
});

describe('stripResourceLoadingHtml — addresses vouched for one by one', () => {
  const notes = 'Guide: https://acme.example/blog/guide/\nReport: https://reports.example/2026?ref=nl';
  const links = extractHttpLinks(notes);

  it("keeps a link whose address the notes carry, whatever its host, and drops every other link's href", () => {
    const html =
      '<p style="color:red">Read <a href="https://acme.example/blog/guide/" style="color:blue">the guide</a>, ' +
      '<a href="https://reports.example/2026?ref=nl">the report</a>, ' +
      '<a href="https://acme.example/blog/invented-post" style="color:blue">a post</a>, ' +
      '<a href="https://acme.example/blog/guide">the guide without its slash</a> and ' +
      '<a href="https://linuxfoundation.org/elsewhere">an LF page</a>.</p>';

    const out = stripResourceLoadingHtml(html, [], '', links);

    expect(out).toContain('<a href="https://acme.example/blog/guide/" style="color:blue">the guide</a>');
    expect(out).toContain('<a href="https://reports.example/2026?ref=nl">the report</a>');
    // An invented path on a real site is the link a model writes when it was given none.
    expect(out).toContain('<a>a post</a>');
    // The notes give the guide WITH its trailing slash; "/blog/guide" is an address they do not carry.
    expect(out).toContain('<a>the guide without its slash</a>');
    // No host is vouched for on this path, an LF-owned one included.
    expect(out).toContain('<a>an LF page</a>');
  });

  it('is the whole rule when no host list is given: without it every http(s) link would be kept', () => {
    const html = '<a href="https://acme.example/blog/guide/">in</a><a href="https://elsewhere.example/x">out</a>';

    expect(stripResourceLoadingHtml(html, undefined, undefined, links)).toBe('<a href="https://acme.example/blog/guide/">in</a><a>out</a>');
    expect(stripResourceLoadingHtml(html)).toContain('href="https://elsewhere.example/x"');
  });

  it('an empty address list vouches for nothing', () => {
    expect(stripResourceLoadingHtml('<a href="https://acme.example/blog/guide/">x</a>', [], '', [])).toBe('<a>x</a>');
  });

  it('adds to a host list rather than replacing it', () => {
    const html =
      '<a href="https://events.example/register">register</a><a href="https://reports.example/2026?ref=nl">report</a><a href="https://evil.example/x">x</a>';

    expect(stripResourceLoadingHtml(html, ['https://events.example/register'], '', links)).toBe(
      '<a href="https://events.example/register">register</a><a href="https://reports.example/2026?ref=nl">report</a><a>x</a>'
    );
  });

  it('never keeps a scheme the canonical form refuses, even when the notes carry the same text', () => {
    expect(stripResourceLoadingHtml('<a href="javascript:alert(1)">x</a>', [], '', ['javascript:alert(1)'])).toBe('<a>x</a>');
  });
});
