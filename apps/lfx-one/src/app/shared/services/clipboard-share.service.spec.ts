// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageService } from 'primeng/api';

import { ClipboardShareService } from './clipboard-share.service';

describe('ClipboardShareService', () => {
  let service: ClipboardShareService;
  let clipboard: Clipboard;
  let messageService: MessageService;

  beforeEach(() => {
    const mockClipboard = {
      copy: vi.fn().mockReturnValue(true),
    };
    const mockMessageService = {
      add: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ClipboardShareService,
        { provide: Clipboard, useValue: mockClipboard },
        { provide: MessageService, useValue: mockMessageService },
      ],
    });

    service = TestBed.inject(ClipboardShareService);
    clipboard = TestBed.inject(Clipboard);
    messageService = TestBed.inject(MessageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should copy URL to clipboard and show success toast', () => {
    const url = 'https://example.com/newsletter/123';
    const detail = 'Shared link copied!';

    service.copyLink(url, detail);

    expect(clipboard.copy).toHaveBeenCalledWith(url);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'success',
      summary: 'Link Copied',
      detail,
    });
  });

  it('should use default detail text when not provided', () => {
    const url = 'https://example.com/newsletter/456';

    service.copyLink(url);

    expect(clipboard.copy).toHaveBeenCalledWith(url);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'success',
      summary: 'Link Copied',
      detail: 'Link copied to clipboard.',
    });
  });

  it('should show warning when URL is empty', () => {
    service.copyLink('');

    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'No Link',
      detail: 'No link available to copy.',
    });
  });

  it('should show warning when URL is null', () => {
    service.copyLink(null as any);

    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'No Link',
      detail: 'No link available to copy.',
    });
  });

  it('should show error toast when clipboard copy fails', () => {
    vi.mocked(clipboard.copy).mockReturnValue(false);
    const url = 'https://example.com/newsletter/789';

    service.copyLink(url);

    expect(clipboard.copy).toHaveBeenCalledWith(url);
    expect(messageService.add).toHaveBeenCalledWith({
      severity: 'error',
      summary: 'Copy Failed',
      detail: 'Failed to copy link. Please try again.',
    });
  });
});
