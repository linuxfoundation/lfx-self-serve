// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ShareDialogData } from '@lfx-one/shared/interfaces';
import { ShareDialogService } from '@services/share-dialog.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterPreviewDrawerComponent } from './newsletter-preview-drawer.component';

describe('NewsletterPreviewDrawerComponent share dialog', () => {
  let fixture: ComponentFixture<NewsletterPreviewDrawerComponent>;
  const dialogRef = { close: vi.fn() };
  const shareDialog = { open: vi.fn<(data: ShareDialogData) => typeof dialogRef>(() => dialogRef) };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [NewsletterPreviewDrawerComponent],
      providers: [provideNoopAnimations(), { provide: ShareDialogService, useValue: shareDialog }],
    }).compileComponents();
    fixture = TestBed.createComponent(NewsletterPreviewDrawerComponent);
    fixture.componentRef.setInput('subject', 'K8s Weekly #42');
    fixture.componentRef.setInput('bodyHtml', '<p>body</p>');
    fixture.componentRef.setInput('displayName', 'Kubernetes');
    fixture.componentRef.setInput('shareUrl', 'https://app.lfx.dev/newsletters/kubernetes/news-1');
    fixture.componentRef.setInput('shareTarget', { projectUid: 'proj-1', newsletterId: 'news-1' });
    fixture.detectChanges();
  });

  it('emits shares bound to the issue the dialog opened for', () => {
    const shared = vi.fn();
    fixture.componentInstance.shared.subscribe(shared);
    fixture.componentInstance.onShare();
    shareDialog.open.mock.calls[0][0].onShare?.('linkedin');
    expect(shared).toHaveBeenCalledWith({ projectUid: 'proj-1', newsletterId: 'news-1', channel: 'linkedin' });
  });

  it('closes its Share dialog when the drawer is destroyed, e.g. by browser Back', () => {
    fixture.componentInstance.onShare();
    expect(dialogRef.close).not.toHaveBeenCalled();
    fixture.destroy();
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
  });

  it('does nothing on destroy when no dialog was opened', () => {
    expect(() => fixture.destroy()).not.toThrow();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
