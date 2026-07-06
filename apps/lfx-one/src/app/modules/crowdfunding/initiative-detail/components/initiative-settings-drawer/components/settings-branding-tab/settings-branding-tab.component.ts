// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, input, signal, viewChild, PLATFORM_ID } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom } from 'rxjs';
import { ButtonComponent } from '@components/button/button.component';
import { ALLOWED_LOGO_MIME_TYPES, MAX_LOGO_SIZE_BYTES } from '@lfx-one/shared/constants';
import { AllowedLogoMimeType, InitiativeDetail } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';

@Component({
  selector: 'lfx-settings-branding-tab',
  imports: [ButtonComponent],
  templateUrl: './settings-branding-tab.component.html',
})
export class SettingsBrandingTabComponent {
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly visible = input.required<boolean>();
  public readonly initiative = input.required<InitiativeDetail>();

  public readonly logoUrl = signal<string>('');
  protected readonly uploadingLogo = signal(false);
  protected readonly logoUploadError = signal<string | null>(null);

  private readonly logoFileInput = viewChild<ElementRef<HTMLInputElement>>('logoFileInput');

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => {
        this.logoUrl.set(this.initiative().logoUrl ?? '');
        this.logoUploadError.set(null);
      });
  }

  protected triggerLogoUpload(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.logoFileInput()?.nativeElement.click();
    }
  }

  protected removeLogo(): void {
    this.logoUrl.set('');
    this.logoUploadError.set(null);
    const input = this.logoFileInput()?.nativeElement;
    if (input) input.value = '';
  }

  protected async onLogoFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    this.logoUploadError.set(null);

    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type as AllowedLogoMimeType)) {
      this.logoUploadError.set('Unsupported file type. Use PNG, JPEG, GIF, or WebP.');
      return;
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      this.logoUploadError.set(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`);
      return;
    }

    this.uploadingLogo.set(true);
    try {
      const presigned = await firstValueFrom(this.crowdfundingService.getPresignedUrl(file.type), { defaultValue: null });
      if (!presigned) return;

      const s3Response = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: presigned.requiredHeaders,
        body: file,
      });

      if (!s3Response.ok) {
        this.logoUploadError.set('Upload failed. Please try again.');
        return;
      }

      this.logoUrl.set(presigned.destinationUrl);
    } catch {
      this.logoUploadError.set('Logo upload failed. Please try again.');
    } finally {
      this.uploadingLogo.set(false);
    }
  }
}
