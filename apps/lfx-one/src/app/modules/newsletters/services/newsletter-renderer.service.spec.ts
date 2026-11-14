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

  it('checks an if= on an each= element against each item, as the server does', () => {
    // bind.go clears each= on the clone but keeps if=/unless=, so the guard is
    // evaluated per item against the item's own fields.
    const html = service.renderBlock('<section if="enabled" each="items"><text>{{title}}</text></section>', {
      items: [
        { enabled: true, title: 'Alpha' },
        { enabled: false, title: 'Beta' },
      ],
    });
    expect(html).toContain('Alpha');
    expect(html).not.toContain('Beta');
  });

  it('drops an if=-guarded element when its field is empty (non-edit mode)', () => {
    const shown = service.renderBlock('<text if="title">Section title</text>', { title: 'Present' });
    expect(shown).toContain('Section title');

    const hidden = service.renderBlock('<text if="title">Section title</text>', { title: '' });
    expect(hidden).not.toContain('Section title');
  });

  it('escapes literal template text as well as bound values outside edit mode', () => {
    // The parser decodes entities, so a template's literal `&lt;img ...&gt;` reaches the
    // binder as `<img ...>`; it must come out as text, not as a live tag.
    const html = service.renderBlock('<text>Hi &lt;img src=x onerror=alert(1)&gt; {{name}}</text>', { name: 'Ada' });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('Ada');
  });

  it('drops a wrapper <style> block and its CSS instead of rendering it as text', () => {
    const wrapper =
      '<section><style>@media (prefers-color-scheme: dark) { .dm-card { color:#f0f0f0 !important; } }</style><text>Header</text><slot name="body"></slot></section>';
    const { header } = service.renderWrapperChrome(wrapper);
    expect(header).toContain('Header');
    expect(header).not.toContain('prefers-color-scheme');
    expect(header).not.toContain('<style');
  });

  it('honours unless= and field == literal guards the same way as the server', () => {
    const template = '<section><text unless="italic == false">Italic intro</text><text if="italic == false">Plain intro</text></section>';
    const italic = service.renderBlock(template, { italic: true });
    expect(italic).toContain('Italic intro');
    expect(italic).not.toContain('Plain intro');

    const plain = service.renderBlock(template, { italic: false });
    expect(plain).toContain('Plain intro');
    expect(plain).not.toContain('Italic intro');

    const missing = service.renderBlock('<text unless="subtitle">Fallback</text>', {});
    expect(missing).toContain('Fallback');
    expect(service.renderBlock('<text if="layout != compact">Wide</text>', { layout: 'compact' })).not.toContain('Wide');
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

  it('splits a container card around its <slot> into shell + before/after', () => {
    // The <slot> is nested inside the bordered card. The chrome must return the
    // card element's own class/style (so the composer hosts a REAL card element)
    // and the leaf content BEFORE the slot, with the slot itself removed.
    const template =
      '<section class="card" style="border:1px solid #131313"><div style="padding:10px"><text>AAIF COMMUNITY</text><slot name="children"></slot></div></section>';
    const chrome = service.renderContainerChrome(template, {});

    expect(chrome.shellClass).toContain('nl-card');
    expect(chrome.shellStyle).toContain('border:1px solid #131313');
    expect(chrome.before).toContain('AAIF COMMUNITY');
    // The slot placeholder must not leak into either fragment.
    expect(chrome.before).not.toContain('slot');
    expect(chrome.after).not.toContain('slot');
    // The card's box style stays on the shell, not duplicated into the content.
    expect(chrome.before).not.toContain('#131313');
  });

  it('strips NUL from a bound value so it cannot forge the container-slot sentinel', () => {
    // The slot split in renderContainerChrome keys on a NUL-delimited sentinel and
    // relies on NUL never appearing in rendered content. A bound value carrying the
    // exact sentinel must not be able to move the split point ahead of the real slot.
    const template = '<section class="card"><div><text>{{label}}</text><slot name="children"></slot></div></section>';
    const chrome = service.renderContainerChrome(template, { label: 'A\u0000nl-container-slot\u0000B' });

    // Split lands at the REAL slot: the whole (NUL-stripped) label stays in `before`.
    expect(chrome.before).toContain('Anl-container-slotB');
    // No NUL survives, and nothing from the label leaks past the slot.
    expect(chrome.before).not.toContain('\u0000');
    expect(chrome.after).not.toContain('nl-container-slot');
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
