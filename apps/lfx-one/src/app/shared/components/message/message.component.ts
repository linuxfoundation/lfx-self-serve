// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, ContentChild, input, output, TemplateRef } from '@angular/core';
import { MessageProps } from '@lfx-one/shared/interfaces';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'lfx-message',
  imports: [NgTemplateOutlet, MessageModule],
  templateUrl: './message.component.html',
})
export class MessageComponent {
  // Content projection for custom templates
  @ContentChild('content') public contentTemplate?: TemplateRef<any>;

  public readonly title = input<string | undefined>(undefined);

  // Core message properties
  public readonly severity = input<MessageProps['severity']>('info');
  public readonly text = input<string | undefined>(undefined);
  public readonly closable = input<boolean>(false);
  public readonly escape = input<boolean>(true);

  // Visual styling
  public readonly size = input<MessageProps['size']>(undefined);
  public readonly variant = input<MessageProps['variant']>(undefined);
  public readonly icon = input<string | undefined>(undefined);
  public readonly closeIcon = input<string | undefined>(undefined);

  // Auto-dismiss functionality
  public readonly life = input<number | undefined>(undefined);

  // Styling properties
  public readonly style = input<Record<string, string | number> | null | undefined>(undefined);
  public readonly styleClass = input<string | undefined>(undefined);

  // Accessibility
  public readonly ariaLabel = input<string | undefined>(undefined);

  // Events
  public readonly onClose = output<{ originalEvent: Event }>();

  protected handleClose(event: Event): void {
    this.onClose.emit({ originalEvent: event });
  }
}
