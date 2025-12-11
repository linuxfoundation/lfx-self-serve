// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgIf, NgTemplateOutlet } from '@angular/common';
import { Component, ContentChild, input, output, TemplateRef } from '@angular/core';
import { MenuItem } from 'primeng/api';
import { MenubarModule } from 'primeng/menubar';

@Component({
  selector: 'lfx-menubar',
  imports: [NgIf, NgTemplateOutlet, MenubarModule],
  templateUrl: './menubar.component.html',
})
export class MenubarComponent {
  @ContentChild('start', { static: false, descendants: false }) public startTemplate?: TemplateRef<any>;
  @ContentChild('end', { static: false, descendants: false }) public endTemplate?: TemplateRef<any>;
  @ContentChild('item', { static: false, descendants: false }) public itemTemplate?: TemplateRef<any>;

  // Menu configuration
  public readonly model = input<MenuItem[] | undefined>(undefined);

  // Styling
  public readonly style = input<{ [key: string]: any } | null | undefined>(undefined);
  public readonly styleClass = input<string | undefined>(undefined);

  // Behavior properties
  public readonly breakpoint = input<string>('960px');

  // Accessibility
  public readonly id = input<string | undefined>(undefined);
  public readonly ariaLabel = input<string | undefined>(undefined);
  public readonly ariaLabelledBy = input<string | undefined>(undefined);

  // Events
  public readonly onFocus = output<FocusEvent>();
  public readonly onBlur = output<FocusEvent>();

  protected handleFocus(event: FocusEvent): void {
    this.onFocus.emit(event);
  }

  protected handleBlur(event: FocusEvent): void {
    this.onBlur.emit(event);
  }
}
