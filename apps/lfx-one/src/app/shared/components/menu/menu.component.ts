// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgIf, NgTemplateOutlet } from '@angular/common';
import { Component, ContentChild, input, output, TemplateRef, viewChild } from '@angular/core';
import { MenuItem } from 'primeng/api';
import { Menu, MenuModule } from 'primeng/menu';

@Component({
  selector: 'lfx-menu',
  imports: [NgIf, NgTemplateOutlet, MenuModule],
  templateUrl: './menu.component.html',
})
export class MenuComponent {
  @ContentChild('start', { static: false, descendants: false }) public startTemplate?: TemplateRef<any>;
  @ContentChild('end', { static: false, descendants: false }) public endTemplate?: TemplateRef<any>;
  @ContentChild('item', { static: false, descendants: false }) public itemTemplate?: TemplateRef<any>;
  @ContentChild('submenuheader', { static: false, descendants: false }) public submenuHeaderTemplate?: TemplateRef<any>;

  // View child reference to the PrimeNG menu
  private readonly menuRef = viewChild<Menu>('menuComponent');

  // Menu configuration
  public readonly model = input<MenuItem[] | undefined>(undefined);

  // Styling
  public readonly style = input<{ [key: string]: any } | null | undefined>(undefined);
  public readonly styleClass = input<string | undefined>(undefined);

  // Behavior properties
  public readonly popup = input<boolean>(false);
  public readonly appendTo = input<any>(undefined);
  public readonly autoZIndex = input<boolean>(true);
  public readonly baseZIndex = input<number>(0);

  // Accessibility
  public readonly id = input<string | undefined>(undefined);
  public readonly ariaLabel = input<string | undefined>(undefined);
  public readonly ariaLabelledBy = input<string | undefined>(undefined);

  // Events
  public readonly onFocus = output<Event>();
  public readonly onBlur = output<Event>();
  public readonly onShow = output<Event>();
  public readonly onHide = output<Event>();

  // Public methods to control menu programmatically
  public toggle(event?: Event): void {
    const menu = this.menuRef();
    if (menu && event) {
      menu.toggle(event);
    }
  }

  public show(event?: Event): void {
    const menu = this.menuRef();
    if (menu && event) {
      menu.show(event);
    }
  }

  public hide(): void {
    const menu = this.menuRef();
    if (menu) {
      menu.hide();
    }
  }

  protected handleFocus(event: Event): void {
    this.onFocus.emit(event);
  }

  protected handleBlur(event: Event): void {
    this.onBlur.emit(event);
  }

  protected handleShow(event: Event): void {
    this.onShow.emit(event);
  }

  protected handleHide(event: Event): void {
    this.onHide.emit(event);
  }
}
