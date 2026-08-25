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

  it('renders an each= loop per item and binds each item as the context', () => {
    const html = service.renderBlock('<section each="items"><text>{{label}}</text></section>', {
      items: [{ label: 'Alpha' }, { label: 'Beta' }],
    });
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
  });

  it('does NOT leak a parent-scope field into each= item bindings', () => {
    // itemContext REPLACES the binding context with the item (matching the
    // server's itemCtx.content = item), so a parent-scope field must not resolve
    // inside the loop — otherwise the canvas would render fields the sent email omits.
    const html = service.renderBlock('<section each="items"><text>{{label}} {{parentOnly}}</text></section>', {
      items: [{ label: 'Alpha' }],
      parentOnly: 'PARENT',
    });
    expect(html).toContain('Alpha');
    expect(html).not.toContain('PARENT');
  });

  it('drops an if=-guarded element when its field is empty (non-edit mode)', () => {
    const shown = service.renderBlock('<text if="title">Section title</text>', { title: 'Present' });
    expect(shown).toContain('Section title');

    const hidden = service.renderBlock('<text if="title">Section title</text>', { title: '' });
    expect(hidden).not.toContain('Section title');
  });

  it('renders a <slot> <separator> BETWEEN children only (matching the server)', () => {
    const templateOf = (bt: string): string | undefined => (bt === 'child' ? '<text>{{t}}</text>' : undefined);
    const template = '<section><slot name="children"><separator><hr class="sep-rule"></separator></slot></section>';
    const child = (t: string): NewsletterBlock => ({ block_type: 'child', content: { t }, blocks: [] });

    const three = service.renderBlock(template, {}, [child('One'), child('Two'), child('Three')], templateOf);
    expect(three).toContain('One');
    expect(three).toContain('Three');
    // 3 children → exactly 2 separators (never before the first or after the last).
    expect((three.match(/sep-rule/g) ?? []).length).toBe(2);

    const one = service.renderBlock(template, {}, [child('Only')], templateOf);
    expect(one).toContain('Only');
    expect(one).not.toContain('sep-rule');
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
