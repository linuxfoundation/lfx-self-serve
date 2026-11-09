// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { NewsletterPreviewComponent, withBlankLinkTarget } from './newsletter-preview.component';

/**
 * A complete newsletter document bypasses Angular's HTML sanitizer, so the iframe sandbox is the
 * only control on it. These tests pin the exact sandbox value on both routes into the iframe.
 */
describe('NewsletterPreviewComponent', () => {
  let fixture: ComponentFixture<NewsletterPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NewsletterPreviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(NewsletterPreviewComponent);
  });

  async function render(inputs: { bodyHtml: string; fullDocument?: boolean }): Promise<HTMLIFrameElement | null> {
    fixture.componentRef.setInput('subject', 'Weekly');
    fixture.componentRef.setInput('bodyHtml', inputs.bodyHtml);
    fixture.componentRef.setInput('fullDocument', inputs.fullDocument ?? false);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('[data-testid="newsletter-preview-iframe"]') as HTMLIFrameElement | null;
  }

  it('shows a date in place of the send-date token in a draft document', async () => {
    const frame = await render({ bodyHtml: '<!doctype html><html><head></head><body><p>%%SEND_DATE%%</p></body></html>' });

    expect(frame?.getAttribute('srcdoc')).not.toContain('%%SEND_DATE%%');
  });

  it.each([
    ['a body that starts with a doctype', { bodyHtml: '<!doctype html><html><head></head><body><p>Hi</p></body></html>' }],
    ['the fullDocument input', { bodyHtml: '<p>Hi</p>', fullDocument: true }],
  ])('frames %s with popups allowed and never scripts or same-origin', async (_label, inputs) => {
    const frame = await render(inputs);
    const sandbox = frame?.getAttribute('sandbox');

    expect(sandbox).toBe('allow-popups allow-popups-to-escape-sandbox');
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('opens links in a new tab instead of inside the frame', async () => {
    const srcdoc = (
      await render({ bodyHtml: '<!doctype html><html><head><title>x</title></head><body><a href="https://example.com">Read</a></body></html>' })
    )?.getAttribute('srcdoc');

    expect(srcdoc).toContain('<head><base target="_blank"><title>x</title>');
  });

  it('renders an authored fragment through the sanitized chrome, not the iframe', async () => {
    expect(await render({ bodyHtml: '<p>Hi</p>' })).toBeNull();
  });
});

describe('withBlankLinkTarget', () => {
  it('adds a head when the document has none', () => {
    expect(withBlankLinkTarget('<html><body>x</body></html>')).toBe('<html><head><base target="_blank"></head><body>x</body></html>');
  });

  it('prepends the base to a bare fragment', () => {
    expect(withBlankLinkTarget('<p>x</p>')).toBe('<base target="_blank"><p>x</p>');
  });
});
