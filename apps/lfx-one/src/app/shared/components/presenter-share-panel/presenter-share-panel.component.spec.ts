// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VOTE_PRESENTER_COPY_CONFIRMATION_MS } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PresenterSharePanelComponent } from './presenter-share-panel.component';

@Component({
  selector: 'lfx-test-host',
  imports: [PresenterSharePanelComponent],
  template: `
    <lfx-presenter-share-panel [link]="link" [qrLabel]="'QR code for ' + link" footnote="Eligible voters only.">
      <ng-container ngProjectAs="[shareActions]"><span data-testid="test-share-action">extra</span></ng-container>
    </lfx-presenter-share-panel>
  `,
})
class HostComponent {
  public link = 'https://example.test/votes/v1';
}

describe('PresenterSharePanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let writeText: ReturnType<typeof vi.fn>;

  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const copyButton = (): HTMLButtonElement => fixture.nativeElement.querySelector('[data-testid="vote-presenter-copy-link"] button') as HTMLButtonElement;
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await flush();
  });

  afterEach(() => vi.useRealTimers());

  it('renders the link, the QR label, the footnote and a Copy link button', () => {
    expect(el('vote-presenter-link')?.textContent?.trim()).toBe('https://example.test/votes/v1');
    expect(el('vote-presenter-share')?.textContent).toContain('Eligible voters only.');
    expect(copyButton().textContent).toContain('Copy link');
    expect(fixture.nativeElement.querySelector('[data-testid="vote-qr"]')?.getAttribute('aria-label')).toBe('QR code for https://example.test/votes/v1');
  });

  it('projects [shareActions] between the copy controls and the QR code', () => {
    const share = el('vote-presenter-share') as HTMLElement;
    const action = el('test-share-action') as HTMLElement;
    const qr = share.querySelector('[data-testid="vote-qr"]') as Element;
    expect(share.contains(action)).toBe(true);
    expect(el('vote-presenter-copy-status')!.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('copies the link, shows the confirmation and announces it politely', async () => {
    copyButton().click();
    await flush();
    expect(writeText).toHaveBeenCalledWith('https://example.test/votes/v1');
    expect(copyButton().textContent).toContain('Link copied');
    expect(el('vote-presenter-copy-status')?.textContent?.trim()).toBe('Link copied to clipboard');
    expect(el('vote-presenter-copy-status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('resets the copy status after the confirmation window', async () => {
    copyButton().click();
    await flush();
    await vi.advanceTimersByTimeAsync(VOTE_PRESENTER_COPY_CONFIRMATION_MS - 1);
    fixture.detectChanges();
    expect(copyButton().textContent).toContain('Link copied');
    await vi.advanceTimersByTimeAsync(1);
    fixture.detectChanges();
    expect(copyButton().textContent).toContain('Copy link');
    expect(el('vote-presenter-copy-status')?.textContent?.trim()).toBe('');
  });

  it('restarts the window when copied again before it ends', async () => {
    copyButton().click();
    await flush();
    await vi.advanceTimersByTimeAsync(VOTE_PRESENTER_COPY_CONFIRMATION_MS - 500);
    copyButton().click();
    await flush();
    await vi.advanceTimersByTimeAsync(VOTE_PRESENTER_COPY_CONFIRMATION_MS - 500);
    fixture.detectChanges();
    expect(copyButton().textContent).toContain('Link copied');
  });

  it('shows the manual-copy hint when the clipboard write fails', async () => {
    writeText.mockReturnValue(Promise.reject(new Error('denied')));
    copyButton().click();
    await flush();
    expect(el('vote-presenter-share')?.textContent).toContain("Couldn't copy. Select the link and press Ctrl/⌘+C.");
    expect(copyButton().textContent).toContain('Copy link');
  });

  it('clears the reset timer on destroy', async () => {
    copyButton().click();
    await flush();
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
