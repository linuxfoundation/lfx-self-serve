// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { MY_DOCUMENT_SOURCE_TAGS } from '@lfx-one/shared/constants';
import { MyDocumentSource, TagSeverity } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'myDocumentSourceTag',
})
export class MyDocumentSourceTagPipe implements PipeTransform {
  public transform(source: MyDocumentSource, field: 'severity'): TagSeverity;
  public transform(source: MyDocumentSource, field: 'icon' | 'iconClass' | 'label'): string;
  public transform(source: MyDocumentSource, field: 'icon' | 'iconClass' | 'label' | 'severity'): string | TagSeverity {
    const config = MY_DOCUMENT_SOURCE_TAGS[source];
    if (field === 'label') return config?.value ?? source;
    if (field === 'severity') return config?.severity ?? 'info';
    return config?.[field] ?? '';
  }
}
