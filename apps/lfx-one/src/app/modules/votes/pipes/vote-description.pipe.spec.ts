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

  it.each([
    'Use <username> &copy; <strong>Important</strong>',
    '<strong>Important</strong>\n\n  <USERNAME> &amp; &#169;',
    '<p>Use <placeholder/> &lt;value&gt;</p>',
    '<strong>Important</strong> </placeholder> &copy;',
    '<p>Dear <first_name></p>',
    '<p>Contact <alice@example.org></p>',
    '<p>Dear <FIRST_NAME/> &copy;</p>',
    '<p>Dear </first_name> &amp;</p>',
    '<p>Contact </alice@example.org></p>',
  ])('renders ambiguous placeholder/HTML input entirely literally: %s', (value) => {
    for (const linkify of [false, true]) {
      const result = render(value, linkify);
      expect(result.textContent).toBe(value);
      expect(result.querySelector('.whitespace-pre-wrap')?.children).toHaveLength(0);
      expect(result.querySelector('username, placeholder, strong, p')).toBeNull();
    }
  });

  it.each([
    '<p>One</p><!-- <strong>editor note</strong> -->',
    '<p>One</p><!-- <username> &copy; -->',
    '<p>One</p><!-- <strong>unclosed comment',
    '<p>One</p><script>Use <username> &copy;</script>',
    '<p>One</p><style>/* <username> */</style>',
    '<p>One</p><template><strong><username>hidden</strong></template>',
  ])('ignores hidden markup when detecting visible placeholders: %s', (value) => {
    for (const linkify of [false, true]) {
      const result = render(value, linkify);
      expect(result.querySelector('p')?.textContent).toBe('One');
      expect(result.textContent).toBe('One');
      expect(result.querySelector('.whitespace-pre-wrap')).toBeNull();
    }
  });

  it.each([
    { html: 'Vote now <!-- editor note -->', text: 'Vote now ' },
    { html: 'Use <first_name> &copy;<!-- editor note -->', text: 'Use <first_name> &copy;' },
    { html: '<!-- <strong>hidden</strong> -->', text: '' },
    { html: 'Vote now <!-- unclosed editor note', text: 'Vote now ' },
    { html: '<script>hidden</script>', text: '' },
    { html: '<style>hidden</style>', text: '' },
    { html: '<template><strong>hidden</strong></template>', text: '' },
    { html: 'Vote now <script>hidden', text: 'Vote now ' },
    { html: 'Vote now <style>hidden', text: 'Vote now ' },
    { html: 'Vote now <template><strong>hidden', text: 'Vote now ' },
  ])('keeps hidden markup out of descriptions without supported elements: $html', ({ html, text }) => {
    for (const linkify of [false, true]) {
      const result = render(html, linkify);
      expect(result.textContent).toBe(text);
      expect(result.querySelector('script, style, template, strong, first_name')).toBeNull();
    }
  });

  it.each([
    '<a href="https://example.com" title="Enter <username>">Help</a>',
    "<a href='https://example.com' title='Enter <first_name>'>Help</a>",
    '<a href="https://example.com" title="Contact <alice@example.org>">Help</a>',
    '<a href="https://example.com" title="Enter </first_name>">Help</a>',
  ])('does not treat angle-bracket text in attributes as a placeholder tag: %s', (value) => {
    for (const linkify of [false, true]) {
      const result = render(value, linkify);
      expect(result.textContent).toBe('Help');
      expect(result.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
      expect(result.querySelector('a')?.getAttribute('title')).toBeTruthy();
    }
  });

  it('does not expose hidden markup when a genuine visible placeholder needs the literal fallback', () => {
    const visible = '<p>Use <username> &copy;</p>';
    const value = `${visible}<!-- editor note --><script>hidden</script>`;
    for (const linkify of [false, true]) {
      const result = render(value, linkify);
      expect(result.textContent).toBe(visible);
      expect(result.querySelector('p, script, username')).toBeNull();
    }
  });

  it('still interprets entities in unambiguous supported legacy HTML', () => {
    for (const linkify of [false, true]) {
      const result = render('<p><strong>Important</strong> &copy; &amp; &lt;username&gt;</p>', linkify);
      expect(result.querySelector('p strong')?.textContent).toBe('Important');
      expect(result.textContent).toBe('Important © & <username>');
    }
  });

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

  it.each([
    { html: 'First<br>\nSecond', text: 'FirstSecond', breaks: 1 },
    { html: 'First\n<br>Second', text: 'FirstSecond', breaks: 1 },
    { html: 'First \r\n <br> \r\n  Second', text: 'First  Second', breaks: 1 },
    { html: '<strong>First<br>\nSecond</strong>', text: 'FirstSecond', breaks: 1 },
    { html: 'First<strong>\n<br></strong>\nSecond', text: 'FirstSecond', breaks: 1 },
    { html: 'First<br><strong>\n  Second</strong>', text: 'First  Second', breaks: 1 },
    { html: 'First<br>\n<br>\nSecond', text: 'FirstSecond', breaks: 2 },
    { html: 'Heading\n\n  First<br>\nSecond\n  Last', text: 'Heading\n\n  FirstSecond\n  Last', breaks: 1 },
    { html: 'First<br>  Second', text: 'First  Second', breaks: 1 },
    { html: 'Agenda<br>\n    - First\n    - Second', text: 'Agenda    - First\n    - Second', breaks: 1 },
    { html: 'Agenda<br>\n\t- First\n\t- Second', text: 'Agenda\t- First\n\t- Second', breaks: 1 },
  ])('does not duplicate explicit breaks with adjacent source line endings: $html', ({ html, text, breaks }) => {
    for (const linkify of [false, true]) {
      const result = render(html, linkify);
      expect(result.querySelectorAll('br')).toHaveLength(breaks);
      expect(result.textContent).toBe(text);
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

  it.each(['script', 'style', 'template'])('does not mistake a discarded %s subtree for a literal placeholder', (tag) => {
    for (const linkify of [false, true]) {
      const result = render(`<p>ok<br>next</p><${tag}>discard me</${tag}>`, linkify);
      expect(result.querySelector('p')?.textContent).toBe('oknext');
      expect(result.querySelector('p br')).toBeTruthy();
      expect(result.querySelector(tag)).toBeNull();
      expect(result.textContent).not.toContain('discard me');
    }
  });

  it('keeps HTML sanitization active', () => {
    const result = render('<p>ok</p><script>attack()</script><img src="x" onerror="attack()"><a href="javascript:attack()">bad</a>');
    expect(result.querySelector('script, [onerror]')).toBeNull();
    expect(result.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('uses the injected document for server-compatible parsing', () => {
    const detachedDocument = document.implementation.createHTMLDocument('server');
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: detachedDocument }] });
    expect(render('Use <username> &copy;').textContent).toBe('Use <username> &copy;');
    const mixed = 'Use <username> &copy; <strong>Important</strong>';
    expect(render(mixed, true).textContent).toBe(mixed);
    expect(render('First<br>\nSecond').textContent).toBe('FirstSecond');
    expect(render('<a href="//127.0.0.1/">Local</a>').querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(render('<a href="/guide">Guide</a>').querySelector('a')?.getAttribute('href')).toBe('/guide');
  });
});
