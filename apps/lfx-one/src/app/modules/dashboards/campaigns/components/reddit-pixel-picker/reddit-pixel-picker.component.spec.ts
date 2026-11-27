// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { REDDIT_PIXEL_PICKER_REASONS } from '@lfx-one/shared/constants';
import type { RedditPixelsResult } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedditPixelPickerComponent } from './reddit-pixel-picker.component';

const PIXELS: RedditPixelsResult = { accountId: 't2_synthaccount', pixels: [{ id: 't2_sitepixel', name: 'Site pixel' }], pixelCount: 1, truncated: false };

// The rules (labels, the held unlisted id, which failures fall back and why) are tested in
// campaign-reddit-pixels.utils.spec.ts; this spec only checks the wiring: the read reaches the select, a pick reaches the
// model, and a refused read offers the typed box.
describe('RedditPixelPickerComponent', () => {
  let fixture: ComponentFixture<RedditPixelPickerComponent>;
  let getRedditPixels: ReturnType<typeof vi.fn<(slug: string) => Observable<RedditPixelsResult>>>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const emit = (testId: string, event: string, value: unknown): void => {
    fixture.debugElement.query(By.css(`[data-testid="${testId}"]`)).triggerEventHandler(event, value);
    fixture.detectChanges();
  };

  function render(): void {
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('pixelId', '');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    getRedditPixels = vi.fn(() => of(PIXELS));
    await TestBed.configureTestingModule({
      imports: [RedditPixelPickerComponent],
      providers: [{ provide: CampaignService, useValue: { getRedditPixels } }],
    }).compileComponents();
    fixture = TestBed.createComponent(RedditPixelPickerComponent);
  });

  it("reads the project's pixels and sets the model to the picked one, and back to the connection's", () => {
    render();

    expect(getRedditPixels).toHaveBeenCalledWith('tlf');
    emit('reddit-pixel-picker-select', 'valueChange', 't2_sitepixel');
    expect(fixture.componentInstance.pixelId()).toBe('t2_sitepixel');
    emit('reddit-pixel-picker-select', 'valueChange', '');
    expect(fixture.componentInstance.pixelId()).toBe('');
  });

  it('offers the typed box, with why, when the list is refused', () => {
    getRedditPixels.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render();

    expect(query('reddit-pixel-picker-select')).toBeNull();
    expect(query('reddit-pixel-picker-id')?.textContent).toContain(REDDIT_PIXEL_PICKER_REASONS.restricted);
    emit('reddit-pixel-picker-id', 'valueChange', 't2_typed');
    expect(fixture.componentInstance.pixelId()).toBe('t2_typed');
  });
});
