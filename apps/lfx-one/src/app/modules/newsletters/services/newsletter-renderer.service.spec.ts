// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NewsletterBlock } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { NewsletterRendererService } from './newsletter-renderer.service';

/**
 * The renderer's output is bypassSecurityTrustHtml'd in the canvas, so its
 * escaping/sanitization/URL-gating is the trust boundary for a draft's
 * body_layout (server-loaded and shared across a project's privileged personas).
 * These tests pin that boundary: substituted field values are HTML-escaped, the
 * one arbitrary-HTML field (richtext) is sanitized, and href/src are gated so a
 * javascript:/data: value can't reach the trusted string.
 */
describe('NewsletterRendererService (browser)', () => {
  let service: NewsletterRendererService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    service = TestBed.inject(NewsletterRendererService);
  });

  it('HTML-escapes a substituted {{field}} value so it can never inject markup', () => {
    const html = service.renderBlock('<text>{{title}}</text>', { title: '<script>alert(1)</script>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('sanitizes a richtext field, stripping scripts and event handlers while keeping inert markup', () => {
    const html = service.renderBlock('<richtext field="body"></richtext>', {
      body: '<b>bold</b><script>alert(1)</script><img src="x" onerror="alert(1)">',
    });
    expect(html).toContain('bold');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
  });

  it('drops an href bound to a javascript: URL but keeps the visible text', () => {
    const html = service.renderBlock('<a href="{{u}}">Click</a>', { u: 'javascript:alert(1)' });
    expect(html).toContain('Click');
    expect(html).not.toContain('javascript:');
  });

  it('keeps a valid https href and a mailto href', () => {
    expect(service.renderBlock('<a href="{{u}}">x</a>', { u: 'https://example.com/a' })).toContain('href="https://example.com/a"');
    expect(service.renderBlock('<a href="{{u}}">x</a>', { u: 'mailto:ed@example.com' })).toContain('mailto:ed@example.com');
  });

  it('drops an img src bound to a data: URL (src is http(s)-only, no mailto exception)', () => {
    const html = service.renderBlock('<img src="{{u}}" />', { u: 'data:text/html,<script>alert(1)</script>' });
    expect(html).not.toContain('data:');
    expect(html).not.toContain('<script>');
  });

  it('escapes double quotes in an attribute value so it cannot break out of the attribute', () => {
    const html = service.renderBlock('<img src="{{u}}" alt="{{a}}" />', { u: 'https://example.com/i.png', a: 'say "hi" ' });
    expect(html).toContain('&quot;hi&quot;');
    expect(html).not.toContain('alt="say "hi"');
  });

  it('renders nested child blocks through a slot', () => {
    const children: NewsletterBlock[] = [{ block_type: 'child', content: { t: 'Nested' }, blocks: [] }];
    const templateOf = (bt: string): string | undefined => (bt === 'child' ? '<text>{{t}}</text>' : undefined);
    const html = service.renderBlock('<section><slot></slot></section>', {}, children, templateOf);
    expect(html).toContain('Nested');
  });

  it('assembles the wrapper body slot around top-level blocks', () => {
    const blocks: NewsletterBlock[] = [{ block_type: 'b', content: { t: 'Body copy' }, blocks: [] }];
    const templateOf = (bt: string): string | undefined => (bt === 'b' ? '<text>{{t}}</text>' : undefined);
    const html = service.renderNewsletter('<section><slot name="body"></slot></section>', blocks, templateOf);
    expect(html).toContain('Body copy');
  });
});

/**
 * On the server the render* methods must early-return without touching DOMParser
 * (a browser-only API), so SSR never crashes rendering the composer route.
 */
describe('NewsletterRendererService (server)', () => {
  let service: NewsletterRendererService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });
    service = TestBed.inject(NewsletterRendererService);
  });

  it('returns empty strings on the server', () => {
    expect(service.renderBlock('<text>{{t}}</text>', { t: 'x' })).toBe('');
    expect(service.renderNewsletter('<section></section>', [], () => undefined)).toBe('');
    expect(service.renderWrapperChrome('<section></section>')).toEqual({ header: '', footer: '' });
    expect(service.collectEditableFields('<text>{{t}}</text>').size).toBe(0);
  });
});
