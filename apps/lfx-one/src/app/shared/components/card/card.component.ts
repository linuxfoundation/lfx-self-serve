// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, ContentChild, input, TemplateRef } from '@angular/core';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'lfx-card',
  imports: [NgTemplateOutlet, CardModule],
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
})
export class CardComponent {
  @ContentChild('header', { static: false, descendants: false }) public headerTemplate?: TemplateRef<any>;
  @ContentChild('title', { static: false, descendants: false }) public titleTemplate?: TemplateRef<any>;
  @ContentChild('subtitle', { static: false, descendants: false }) public subtitleTemplate?: TemplateRef<any>;
  @ContentChild('footer', { static: false, descendants: false }) public footerTemplate?: TemplateRef<any>;

  public readonly header = input<string>('');
  public readonly subheader = input<string>('');
  public readonly style = input<{ [key: string]: any } | null | undefined>(undefined);
  public readonly styleClass = input<string>('');
  public readonly closable = input<boolean>(false);
}
