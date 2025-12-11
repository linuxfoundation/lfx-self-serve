// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, ContentChild, input, output, TemplateRef } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { BreadcrumbItemClickEvent, BreadcrumbModule } from 'primeng/breadcrumb';

@Component({
  selector: 'lfx-breadcrumb',
  imports: [NgTemplateOutlet, RouterModule, BreadcrumbModule],
  templateUrl: './breadcrumb.component.html',
})
export class BreadcrumbComponent {
  @ContentChild('item', { static: false, descendants: false }) public itemTemplate?: TemplateRef<any>;
  @ContentChild('separator', { static: false, descendants: false }) public separatorTemplate?: TemplateRef<any>;

  public readonly model = input<MenuItem[] | undefined>(undefined);
  public readonly home = input<MenuItem | undefined>(undefined);
  public readonly style = input<{ [key: string]: any } | null | undefined>(undefined);
  public readonly styleClass = input<string | undefined>(undefined);
  public readonly homeAriaLabel = input<string | undefined>(undefined);

  public readonly onItemClick = output<BreadcrumbItemClickEvent>();

  protected handleItemClick(event: BreadcrumbItemClickEvent): void {
    this.onItemClick.emit(event);
  }
}
