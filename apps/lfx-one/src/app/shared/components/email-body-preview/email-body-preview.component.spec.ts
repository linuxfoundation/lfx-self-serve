// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { EmailBodyPreviewComponent } from './email-body-preview.component';

/**
 * This component bypasses Angular's HTML sanitizer, so the sandbox is the only control left on the
 * framed document. These are the assertions that keep it: the two forbidden tokens, and the fact
 * that inline styles reach the frame at all -- which is the whole reason the bypass exists and the
 * thing that would silently stop being true if anyone "fixed" the bypass back into a sanitize call.
 */
describe('EmailBodyPreviewComponent', () => {
  let fixture: ComponentFixture<EmailBodyPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EmailBodyPreviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(EmailBodyPreviewComponent);
  });

  async function render(html: string): Promise<HTMLIFrameElement | null> {
    fixture.componentRef.setInput('html', html);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement | null;
  }

  // The two grants that would make the bypass unsound. `allow-scripts` turns model-authored HTML
  // derived from scraped third-party pages into an execution sink; adding `allow-same-origin`
  // beside it lets the framed document strip its own sandbox attribute.
  it('never grants allow-scripts or allow-same-origin', async () => {
    const sandbox = (await render('<p>Join us</p>'))?.getAttribute('sandbox');

    expect(sandbox).toBe('allow-popups allow-popups-to-escape-sandbox');
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  // The app's own URL carries the project and brief ids, so it must not ride along on any request
  // the framed document makes.
  it('sends no referrer from the frame', async () => {
    expect((await render('<p>Join us</p>'))?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  // The regression this component exists to prevent. `[innerHTML]` stripped `style` through
  // `SecurityContext.HTML`; the campaign service's email styling is entirely inline, so a preview
  // that drops it shows the operator layout the recipient will never see.
  //
  // SCOPE, because this test is easy to over-read: it proves THIS component does not strip a
  // style it is handed. It does NOT prove the operator sees styling, and today they do not --
  // every caller passes the body through `stripResourceLoadingHtml` first, whose
  // `allowedAttributes` (html-utils.ts) permits only `href`, `colspan` and `rowspan`. Measured
  // against the real allowlist, `<p style="color:#2563eb">Join us</p>` arrives here as
  // `<p>Join us</p>`, so all four real previews lose the generated colours and typography.
  //
  // Restoring them means admitting a safe SUBSET of inline CSS through that sanitizer -- `url()`,
  // `expression()` and `position:fixed` all have to be refused -- which is a security decision
  // about the shared helper rather than a change to this component. Tracked separately; this
  // comment exists so the next reader does not take a green test here as evidence the preview is
  // styled.
  it('carries inline styles into the frame instead of stripping them', async () => {
    const srcdoc = (await render('<p style="color:#2563eb;font-weight:bold">Join us</p>'))?.getAttribute('srcdoc');

    expect(srcdoc).toContain('style="color:#2563eb;font-weight:bold"');
    expect(srcdoc).toContain('<!doctype html>');
  });

  // The sandbox blocks script; it does NOT block subresource loads or a meta-refresh navigation,
  // and the body is interpolated raw -- so until this, an operator-typed variant-B body was held
  // back only by a client-side stripper. `default-src 'none'` is exact rather than cautious: the
  // stripper's allow-list carries no `img`, no `src` and no `style` attribute, so a legitimate
  // preview loads nothing external. `style-src 'unsafe-inline'` is the one opening, and it cannot
  // fetch. This holds for whatever the stripper misses, including a tag HTML gains later.
  it('forbids every subresource and navigation the sandbox still allows', async () => {
    const srcdoc = (await render('<p>Join us</p>'))?.getAttribute('srcdoc') ?? '';

    expect(srcdoc, 'a pasted body could still reach a third-party host').toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'">`
    );
  });

  // A blank body must read as blank. Rendering the placeholder inside the frame would make an
  // ungenerated email look like a one-line email that was generated.
  it('renders the placeholder as text with no frame when there is no body', async () => {
    fixture.componentRef.setInput('html', '   ');
    fixture.componentRef.setInput('emptyText', '(no body yet)');
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
    expect((fixture.nativeElement.textContent as string).trim()).toBe('(no body yet)');
  });

  // E2E targets the same testid whichever arm renders, so neither arm may drop it.
  it('puts the testid on both the frame and the placeholder', async () => {
    fixture.componentRef.setInput('testId', 'campaigns-email-preview-body');
    expect((await render('<p>Join us</p>'))?.getAttribute('data-testid')).toBe('campaigns-email-preview-body');

    fixture.componentRef.setInput('html', '');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="campaigns-email-preview-body"]')).not.toBeNull();
  });
});
