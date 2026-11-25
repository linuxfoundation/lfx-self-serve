// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareKitCopyCardComponent } from './share-kit-copy-card.component';

describe('ShareKitCopyCardComponent', () => {
  let fixture: ComponentFixture<ShareKitCopyCardComponent>;
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  function setClipboard(writeText: (value: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  }

  const el = (suffix: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="card${suffix}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ShareKitCopyCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(ShareKitCopyCardComponent);
    fixture.componentRef.setInput('heading', 'Invite your network');
    fixture.componentRef.setInput('text', 'Join us.\n\nhttps://events.example.org/');
    fixture.componentRef.setInput('copyLabel', 'Copy post');
    fixture.componentRef.setInput('testId', 'card');
  });

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  });

  it('renders the text as text, not markup', () => {
    fixture.componentRef.setInput('text', '<b>not bold</b>');
    fixture.detectChanges();
    expect(el('-text').textContent).toBe('<b>not bold</b>');
    expect(el('-text').querySelector('b')).toBeNull();
  });

  it('copies the exact text, shows "Copied" and emits', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const copied = vi.fn();
    fixture.componentInstance.copied.subscribe(copied);
    fixture.detectChanges();

    el('-copy').querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith('Join us.\n\nhttps://events.example.org/');
    expect(el('-status').textContent).toBe('Copied');
    expect(copied).toHaveBeenCalledTimes(1);
  });

  it('selects the text when the clipboard is refused', async () => {
    setClipboard(() => Promise.reject(new Error('denied')));
    fixture.detectChanges();

    el('-copy').querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el('-status').textContent).toContain('Text selected');
    expect(document.getSelection()?.toString()).toContain('Join us.');
  });

  it('clears its status timer when destroyed', async () => {
    setClipboard(() => Promise.resolve());
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    fixture.detectChanges();
    el('-copy').querySelector('button')?.click();
    await fixture.whenStable();
    clearSpy.mockClear();
    fixture.destroy();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });

  it('masks sensitive text from Datadog Session Replay', () => {
    fixture.detectChanges();
    expect(el('').hasAttribute('data-dd-privacy')).toBe(false);
    fixture.componentRef.setInput('sensitive', true);
    fixture.detectChanges();
    expect(el('').getAttribute('data-dd-privacy')).toBe('mask');
  });

  it('flags a post over the platform limit', () => {
    fixture.componentRef.setInput('length', 301);
    fixture.componentRef.setInput('limit', 300);
    fixture.detectChanges();
    expect(el('-count').textContent?.trim()).toBe('301 / 300 characters');
    expect(el('-count').classList).toContain('text-red-700');
  });
});
