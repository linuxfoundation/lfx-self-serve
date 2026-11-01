// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { LinkifyPipe } from './linkify.pipe';

describe('LinkifyPipe', () => {
  function render(value: string | null | undefined): HTMLDivElement {
    const html = TestBed.runInInjectionContext(() => new LinkifyPipe().transform(value));
    const result = document.createElement('div');
    result.innerHTML = TestBed.inject(DomSanitizer).sanitize(SecurityContext.HTML, html) || '';
    return result;
  }

  it.each([null, undefined, ''])('renders empty input %s as empty', (value) => {
    expect(render(value).innerHTML).toBe('');
  });

  it.each([
    'http://localhost/path?next[]=https://example.com then ',
    'http://localhost/path?next=https://example.com then ',
    'http://127.0.0.1/path?next[]=https://example.com then ',
  ])('links only the validated standalone occurrence after %s', (prefix) => {
    const url = 'https://example.com';
    const result = render(prefix + url);
    expect(result.textContent).toBe(prefix + url);
    expect(result.querySelectorAll('a')).toHaveLength(1);
    expect(result.firstChild?.textContent).toBe(prefix);
    expect(result.querySelector('a')?.getAttribute('href')).toBe(url);
  });

  it('handles duplicate and prefix-overlapping URLs without nested anchors', () => {
    const value = 'https://example.com https://example.com/page https://example.com';
    const result = render(value);
    expect(result.textContent).toBe(value);
    expect(Array.from(result.querySelectorAll('a'), (anchor) => anchor.getAttribute('href'))).toEqual(value.split(' '));
    expect(result.querySelector('a a')).toBeNull();
  });

  it('escapes prose and query parameters while preserving anchor attributes', () => {
    const url = 'https://example.com/?items[]=one&mode=two';
    const value = '<img src=x onerror="attack()"> &copy; ' + url;
    const result = render(value);
    expect(result.textContent).toBe(value);
    expect(result.querySelector('img, [onerror]')).toBeNull();
    const anchor = result.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe(url);
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor?.classList.contains('text-primary')).toBe(true);
  });

  it.each(['http://localhost/private', 'http://127.0.0.1/private', 'javascript:attack()', 'https://example.com/?topic=data:types'])(
    'retains the existing destination policy for %s',
    (value) => {
      const result = render(value);
      expect(result.textContent).toBe(value);
      expect(result.querySelector('a')).toBeNull();
    }
  );

  it('keeps punctuation outside links and uses offsets after escaped prose', () => {
    const value = '<placeholder> Read (https://example.com), then https://example.org.';
    const result = render(value);
    expect(result.textContent).toBe(value);
    expect(Array.from(result.querySelectorAll('a'), (anchor) => anchor.getAttribute('href'))).toEqual(['https://example.com', 'https://example.org']);
  });
});
