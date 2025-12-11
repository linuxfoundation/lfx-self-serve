// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal } from '@angular/core';
import { AvatarProps } from '@lfx-one/shared/interfaces';
import { AvatarModule } from 'primeng/avatar';

@Component({
  selector: 'lfx-avatar',
  imports: [AvatarModule],
  templateUrl: './avatar.component.html',
})
export class AvatarComponent {
  // Input signals
  public readonly label = input<AvatarProps['label']>('');
  public readonly icon = input<AvatarProps['icon']>('');
  public readonly image = input<AvatarProps['image']>('');
  public readonly size = input<AvatarProps['size']>('normal');
  public readonly shape = input<AvatarProps['shape']>('square');
  public readonly style = input<AvatarProps['style']>(null);
  public readonly customClass = input<AvatarProps['styleClass']>('');
  public readonly ariaLabel = input<AvatarProps['ariaLabel']>('');

  /**
   * @deprecated Use customClass instead. Will be removed in next major version.
   * PrimeNG v20 migrated from styleClass to class attribute.
   */
  public readonly styleClass = this.customClass;

  // Internal state for error handling
  private readonly imageErrorSignal = signal<boolean>(false);

  // Computed signals for priority logic
  public readonly displayImage = computed(() => {
    const imageUrl = this.image();
    return imageUrl && !this.imageErrorSignal() ? imageUrl : '';
  });

  public readonly displayIcon = computed(() => {
    const image = this.displayImage();
    const icon = this.icon();
    return !image && icon ? icon : '';
  });

  public readonly displayLabel = computed(() => {
    const image = this.displayImage();
    const icon = this.displayIcon();
    const label = this.label();

    if (!image && !icon && label) {
      // Return first character of the label
      return label.charAt(0).toUpperCase();
    }
    return '';
  });

  // Output events
  public readonly onClick = output<Event>();
  public readonly onImageError = output<Event>();

  // Event handlers
  protected handleClick(event: Event): void {
    this.onClick.emit(event);
  }

  protected handleImageError(event: Event): void {
    this.imageErrorSignal.set(true);
    this.onImageError.emit(event);
  }
}
