// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, model, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';

@Component({
  selector: 'lfx-select',
  imports: [SelectModule, ReactiveFormsModule],
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
})
export class SelectComponent {
  public form = input.required<FormGroup>();
  public control = input.required<string>();

  // Core properties
  public readonly options = input<any[]>([]);
  public readonly optionLabel = input<string>('label');
  public readonly optionValue = input<string>('value');
  public readonly optionDisabled = input<string>('disabled');
  public readonly optionGroupLabel = input<string>('label');
  public readonly optionGroupChildren = input<string>('items');

  // Model binding
  public value = model<any>(null);

  // Display properties
  public readonly placeholder = input<string>('');
  public readonly readonly = input<boolean>(false);
  public readonly showClear = input<boolean>(false);
  public readonly size = input<'small' | 'large'>('small');
  public readonly checkmark = input<boolean>(false);
  public readonly loading = input<boolean>(false);

  // Filtering properties
  public readonly filter = input<boolean>(false);
  public readonly filterBy = input<string>('label');
  public readonly filterMatchMode = input<'contains' | 'startsWith' | 'endsWith' | 'equals' | 'notEquals' | 'in' | 'lt' | 'lte' | 'gt' | 'gte'>('contains');
  public readonly filterPlaceholder = input<string>('');
  public readonly filterLocale = input<string | undefined>(undefined);
  public readonly emptyFilterMessage = input<string>('No results found');
  public readonly emptyMessage = input<string>('No results found');

  // Styling properties
  public readonly styleClass = input<string>('');
  public readonly style = input<Record<string, any> | null | undefined>(undefined);
  public readonly panelStyleClass = input<string>('');
  public readonly panelStyle = input<Record<string, any> | null | undefined>(undefined);
  public readonly appendTo = input<any>(undefined);
  public readonly variant = input<'filled' | 'outlined'>('outlined');

  // Behavior properties
  public readonly scrollHeight = input<string>('200px');
  public readonly lazy = input<boolean>(false);
  public readonly virtualScroll = input<boolean>(false);
  public readonly virtualScrollItemSize = input<number>(0);
  public readonly virtualScrollOptions = input<any>(null);
  public readonly overlayOptions = input<any>(null);
  public readonly ariaFilterLabel = input<string | undefined>(undefined);
  public readonly ariaLabel = input<string | undefined>(undefined);
  public readonly ariaLabelledBy = input<string | undefined>(undefined);
  public readonly editable = input<boolean>(false);
  public readonly group = input<boolean>(false);
  public readonly autofocus = input<boolean>(false);
  public readonly resetFilterOnHide = input<boolean>(false);
  public readonly dropdownIcon = input<string>();
  public readonly autoDisplayFirst = input<boolean>(true);
  public readonly focusOnHover = input<boolean>(false);
  public readonly filterFields = input<string[]>([]);

  // Template properties
  public readonly id = input<string | undefined>(undefined);
  public readonly name = input<string | undefined>(undefined);
  public readonly inputId = input<string | undefined>(undefined);
  public readonly dataKey = input<string | undefined>(undefined);
  public readonly required = input<boolean>(false);
  public readonly tabindex = input<number>(0);
  public readonly tooltip = input<string>('');
  public readonly tooltipPosition = input<'top' | 'bottom' | 'left' | 'right'>('right');
  public readonly tooltipPositionStyle = input<string>('absolute');
  public readonly tooltipStyleClass = input<string | undefined>(undefined);
  public readonly autofocusFilter = input<boolean>(true);

  // Events
  public readonly onChange = output<any>();

  // Event handlers
  protected handleChange(event: any): void {
    this.onChange.emit(event);
  }
}
