// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { LinkifyHtmlPipe } from '@pipes/linkify-html.pipe';
import { describe, expect, it } from 'vitest';

import { VoteDescriptionPipe } from './vote-description.pipe';

describe('VoteDescriptionPipe', () => {
  function render(value: string | null | undefined, linkify = false): HTMLDivElement {
    const html = TestBed.runInInjectionContext(() => new VoteDescriptionPipe().transform(value));
    const result = document.createElement('div');
    result.innerHTML = linkify ? TestBed.runInInjectionContext(() => new LinkifyHtmlPipe().transform(html)) : html;
    return result;
  }

  it.each([null, undefined, ''])('renders empty input %s as empty', (value) => {
    expect(render(value).innerHTML).toBe('');
  });

  it.each(['Use <username> to sign in &copy;', '  First\n\n    Second &amp; &#169; <placeholder>', 'Literal &lt;strong&gt; and 2 < 3'])(
    'keeps plain text literal with or without linkification: %s',
    (value) => {
      for (const linkify of [false, true]) {
        const result = render(value, linkify);
        expect(result.textContent).toBe(value);
        expect(result.querySelector('span.whitespace-pre-wrap')?.children).toHaveLength(0);
      }
    }
  );

  it('links plain URLs without interpreting adjacent placeholders or entities', () => {
    const value = 'Use <username> &copy; at https://example.com/guide?items[]=one&mode=two';
    const result = render(value, true);
    expect(result.textContent).toBe(value);
    expect(result.querySelector('a')?.getAttribute('href')).toBe('https://example.com/guide?items[]=one&mode=two');
    expect(result.querySelector('username')).toBeNull();
  });

  it.each([
    { html: 'First\n<a href="https://example.com">Agenda</a>\nLast', text: 'First\nAgenda\nLast' },
    { html: 'Agenda:\n\n  - One\n  - Two\n<a href="https://example.com">Details</a>', text: 'Agenda:\n\n  - One\n  - Two\nDetails' },
    { html: '<strong>One</strong>\n\n  <a href="https://example.com">Two</a>', text: 'One\n\n  Two' },
  ])('preserves whitespace in text mixed with inline HTML: $html', ({ html, text }) => {
    for (const linkify of [false, true]) {
      const result = render(html, linkify);
      expect(result.querySelector('.whitespace-pre-wrap')?.textContent).toBe(text);
      expect(result.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
      expect(result.textContent).toBe(text);
    }
  });

  it('preserves a text/inline run without pre-wrapping adjacent HTML blocks', () => {
    const result = render('First\n  <a href="https://example.com">Agenda</a>\nLast<p>Block</p>\n<ul> <li>One</li> <li>Two</li> </ul>');
    expect(result.querySelector('.whitespace-pre-wrap')?.textContent).toBe('First\n  Agenda\nLast');
    expect(result.querySelector('.whitespace-pre-wrap p, .whitespace-pre-wrap ul, ul .whitespace-pre-wrap, p .whitespace-pre-wrap')).toBeNull();
    expect(result.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it.each(['del', 'ins', 'sub', 'sup', 'kbd', 'samp'])('retains the sanitized %s element instead of displaying literal tags', (tag) => {
    for (const linkify of [false, true]) {
      const result = render(`<${tag}>Old proposal</${tag}>`, linkify);
      expect(result.querySelector(tag)?.textContent).toBe('Old proposal');
      expect(result.textContent).toBe('Old proposal');
    }
  });

  it('retains rich structure and explicit breaks without a pre-wrap wrapper', () => {
    const result = render('<p>One<br>Two</p>\n<ul> <li>A</li> <li>B</li> </ul><pre>  code\n    next</pre>');
    expect(result.querySelector('p br')).toBeTruthy();
    expect(result.querySelectorAll('ul > li')).toHaveLength(2);
    expect(result.querySelector('.whitespace-pre-wrap')).toBeNull();
    expect(result.querySelector('pre')?.textContent).toBe('  code\n    next');
  });

  it.each([
    'http://127.0.0.1/',
    'https://localhost/private',
    '//10.0.0.1/private',
    'http://[::1]/private',
    'http://2130706433/private',
    'http://169.254.169.254/',
    'https://example.com.localhost/private',
    'https://',
  ])('removes blocked existing destinations before rendering: %s', (href) => {
    for (const linkify of [false, true]) {
      const result = render('<a href="' + href + '"><strong>Agenda</strong></a>', linkify);
      expect(result.querySelector('a')?.hasAttribute('href')).toBe(false);
      expect(result.querySelector('a strong')?.textContent).toBe('Agenda');
      expect(result.querySelector('a a')).toBeNull();
    }
  });

  it.each(['https://example.com/guide', '//example.org/guide', '/guide', '../guide', '#agenda', 'mailto:team@example.com', 'tel:+15555550100'])(
    'retains a supported destination: %s',
    (href) => {
      expect(
        render('<a href="' + href + '">Agenda</a>')
          .querySelector('a')
          ?.getAttribute('href')
      ).toBe(href);
    }
  );

  it('keeps HTML sanitization active', () => {
    const result = render('<p>ok</p><script>attack()</script><img src="x" onerror="attack()"><a href="javascript:attack()">bad</a>');
    expect(result.querySelector('script, [onerror]')).toBeNull();
    expect(result.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('uses the injected document for server-compatible parsing', () => {
    const detachedDocument = document.implementation.createHTMLDocument('server');
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: detachedDocument }] });
    expect(render('Use <username> &copy;').textContent).toBe('Use <username> &copy;');
    expect(render('<a href="//127.0.0.1/">Local</a>').querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(render('<a href="/guide">Guide</a>').querySelector('a')?.getAttribute('href')).toBe('/guide');
  });
});
