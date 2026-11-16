// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ShareDialogData } from '@lfx-one/shared/interfaces';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareDialogComponent } from './share-dialog.component';

const URL = 'https://app.lfx.dev/newsletters/cncf/abc123';

describe('ShareDialogComponent', () => {
  let fixture: ComponentFixture<ShareDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let copyLink: ReturnType<typeof vi.fn>;

  const find = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  async function mount(data: ShareDialogData): Promise<void> {
    close = vi.fn();
    copyLink = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ShareDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: ClipboardShareService, useValue: { copyLink } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShareDialogComponent);
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('shows the title as the eyebrow when no eyebrow is given', async () => {
    await mount({ url: URL, title: 'K8s Weekly #42' });
    expect(find('share-dialog-eyebrow')!.textContent!.trim()).toBe('K8s Weekly #42');
  });

  it('opens social destinations in a new tab and email in the mail client', async () => {
    await mount({ url: URL, title: 'K8s Weekly #42' });

    for (const key of ['x', 'linkedin', 'reddit']) {
      const link = find(`share-dialog-${key}`)!;
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('href')).toContain(encodeURIComponent(URL));
    }

    const email = find('share-dialog-email')!;
    expect(email.getAttribute('target')).toBeNull();
    expect(email.getAttribute('href')).toMatch(/^mailto:\?subject=K8s%20Weekly%20%2342&body=/);
  });

  it('copies the URL with the caller-supplied toast message', async () => {
    await mount({ url: URL, title: 'K8s Weekly #42', copiedMessage: 'Newsletter link copied to clipboard.' });
    find('share-dialog-copy-link')!.querySelector('button')!.click();
    expect(copyLink).toHaveBeenCalledWith(URL, 'Newsletter link copied to clipboard.');
  });

  it('reports the channel when a destination is picked', async () => {
    const onShare = vi.fn();
    await mount({ url: URL, title: 'K8s Weekly #42', onShare });
    const link = find('share-dialog-linkedin')!;
    link.addEventListener('click', (event) => event.preventDefault());
    link.click();
    expect(onShare).toHaveBeenCalledWith('linkedin');
  });

  it('reports a middle-click on a destination, but not a right-click', async () => {
    const onShare = vi.fn();
    await mount({ url: URL, title: 'K8s Weekly #42', onShare });
    const link = find('share-dialog-x')!;

    link.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true }));
    expect(onShare).not.toHaveBeenCalled();

    link.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(onShare).toHaveBeenCalledWith('x');
  });

  it('reports copy_link only when the copy succeeded', async () => {
    const onShare = vi.fn();
    await mount({ url: URL, title: 'K8s Weekly #42', onShare });

    copyLink.mockReturnValue(false);
    find('share-dialog-copy-link')!.querySelector('button')!.click();
    expect(onShare).not.toHaveBeenCalled();

    copyLink.mockReturnValue(true);
    find('share-dialog-copy-link')!.querySelector('button')!.click();
    expect(onShare).toHaveBeenCalledWith('copy_link');
  });

  it('claims Escape so overlays underneath do not also close', async () => {
    await mount({ url: URL, title: 'K8s Weekly #42' });
    const documentListener = vi.fn();
    document.addEventListener('keydown', documentListener);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(close).toHaveBeenCalled();
    expect(documentListener).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentListener);
  });

  it('closes from the round close button', async () => {
    await mount({ url: URL, title: 'K8s Weekly #42' });
    find('share-dialog-close')!.click();
    expect(close).toHaveBeenCalled();
  });
});
