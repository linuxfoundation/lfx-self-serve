// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { LinkifyHtmlPipe } from './linkify-html.pipe';

@Component({
  selector: 'lfx-test-linkify-html',
  imports: [LinkifyHtmlPipe],
  template: `<div [innerHTML]="html | linkifyHtml"></div>`,
})
class HostComponent {
  public html = '';
}

describe('LinkifyHtmlPipe', () => {
  let pipe: LinkifyHtmlPipe;

  beforeEach(() => {
    pipe = TestBed.runInInjectionContext(() => new LinkifyHtmlPipe());
  });

  function render(html: string | null | undefined): HTMLDivElement {
    const result = document.createElement('div');
    result.innerHTML = pipe.transform(html);
    return result;
  }

  it.each([null, undefined, ''])('renders empty input %s as an empty string', (value) => {
    expect(pipe.transform(value)).toBe('');
  });

  it('links plain URLs while preserving newlines and sentence punctuation', () => {
    const text = 'Read (https://example.com/charter).\n\nThen visit http://example.org.';
    const result = render(text);
    expect(result.textContent).toBe(text);
    expect(Array.from(result.querySelectorAll('a'), (anchor) => anchor.getAttribute('href'))).toEqual(['https://example.com/charter', 'http://example.org']);
  });

  it('preserves rich markup, existing anchors, and non-web links without nested anchors', () => {
    const result = render(
      '<p><strong>Read https://example.com</strong></p><p><a href="/guide"><em>https://example.org</em></a> <a href="mailto:a@example.com">email</a></p>'
    );
    expect(result.querySelector('strong a')?.getAttribute('href')).toBe('https://example.com');
    expect(result.querySelector('a[href="/guide"] em')?.textContent).toBe('https://example.org');
    expect(result.querySelector('a[href^="mailto:"]')?.textContent).toBe('email');
    expect(result.querySelectorAll('p')).toHaveLength(2);
    expect(result.querySelectorAll('a')).toHaveLength(3);
    expect(result.querySelector('a a')).toBeNull();
  });

  it('handles repeated and prefix-overlapping URLs without re-linking generated markup', () => {
    const text = 'https://example.com https://example.com/page https://example.com';
    const result = render(text);
    expect(Array.from(result.querySelectorAll('a'), (anchor) => anchor.getAttribute('href'))).toEqual(text.split(' '));
    expect(result.textContent).toBe(text);
    expect(pipe.transform(result.innerHTML)).toBe(result.innerHTML);
  });

  it('decodes entities once so query parameters and escaped markup stay literal', () => {
    const result = render('<p>https://example.com/doc?a=1&amp;b=2 &lt;img onerror="attack()"&gt;</p>');
    expect(result.querySelector('a')?.getAttribute('href')).toBe('https://example.com/doc?a=1&b=2');
    expect(result.textContent).toContain('<img onerror="attack()">');
    expect(result.querySelector('img')).toBeNull();
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1/admin',
    'http://10.0.0.1/admin',
    'http://192.168.1.1/admin',
    'http://[::1]/admin',
    'http://169.254.169.254/admin',
    'http://2130706433/admin',
    'http://example.com.localhost/admin',
    'https://',
    'javascript:alert(1)',
  ])('does not turn a rejected destination into a link: %s', (url) => {
    const result = render(`Read ${url}`);
    expect(result.querySelector('a')).toBeNull();
    expect(result.textContent).toBe(`Read ${url}`);
  });

  it('keeps sanitization active both before parsing and in the template binding', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.html = '<p>https://example.com</p><script>attack()</script><img src="x" onerror="attack()"><a href="javascript:attack()">bad</a>';
    fixture.detectChanges();
    const result = fixture.nativeElement as HTMLElement;
    expect(result.querySelector('script, [onerror]')).toBeNull();
    expect(result.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(result.querySelector('p a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('recomputes links when the bound description changes', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.html = 'https://example.com/first';
    fixture.detectChanges();
    fixture.componentInstance.html = '<p>https://example.org/second</p>';
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const links = (fixture.nativeElement as HTMLElement).querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.org/second');
  });

  it('uses the injected document rather than a browser global', () => {
    TestBed.resetTestingModule();
    const detachedDocument = document.implementation.createHTMLDocument('server document');
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: detachedDocument }] });
    pipe = TestBed.runInInjectionContext(() => new LinkifyHtmlPipe());
    expect(render('https://example.com').querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });
});
