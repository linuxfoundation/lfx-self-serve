// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, OnDestroy, OnInit, output, signal, viewChild } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Popover, PopoverModule } from 'primeng/popover';
import { Subscription } from 'rxjs';

export interface SelectChipOption<T = string> {
  label: string;
  value: T;
  disabled?: boolean;
}

type ChipColor = 'blue' | 'purple' | 'green' | 'red' | 'gray' | 'orange' | 'yellow';

@Component({
  selector: 'lfx-select-chip',
  imports: [PopoverModule, ReactiveFormsModule],
  templateUrl: './select-chip.component.html',
  styleUrl: './select-chip.component.scss',
})
export class SelectChipComponent<T = string> implements OnInit, OnDestroy {
  // Form inputs (optional - for form-based usage)
  public form = input<FormGroup | null>(null);
  public control = input<string>('');

  // Direct value binding (for standalone usage like tables)
  public value = input<T | null>(null);

  // Options
  public readonly options = input<SelectChipOption<T>[]>([]);

  // Display properties
  public readonly placeholder = input<string>('Select');
  public readonly color = input<ChipColor>('blue');
  public readonly disabled = input<boolean>(false);
  public readonly showChevron = input<boolean>(true);
  public readonly size = input<'small' | 'medium'>('small');

  // Styling
  public readonly styleClass = input<string>('');
  public readonly panelStyleClass = input<string>('');

  // Accessibility
  public readonly ariaLabel = input<string | undefined>(undefined);
  public readonly testIdPrefix = input<string>('select-chip');

  // Events
  public readonly onChange = output<T>();

  // ViewChild for popover control
  public popover = viewChild<Popover>('selectChipPopover');

  // State
  public isOpen = signal<boolean>(false);
  private currentValue = signal<T | null>(null);
  private valueChangesSubscription?: Subscription;

  // Computed: check if using form control mode
  private isFormMode = computed(() => !!this.form() && !!this.control());

  // Computed label based on current value
  public selectedLabel = computed(() => {
    const value = this.currentValue();
    const option = this.options().find((o) => o.value === value);
    return option?.label || this.placeholder();
  });

  // Color classes for the chip
  public chipColorClasses = computed(() => {
    const colorMap: Record<ChipColor, string> = {
      blue: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
      purple: 'bg-purple-100 text-purple-700 hover:bg-purple-200',
      green: 'bg-green-100 text-green-700 hover:bg-green-200',
      red: 'bg-red-100 text-red-700 hover:bg-red-200',
      gray: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
      orange: 'bg-orange-100 text-orange-700 hover:bg-orange-200',
      yellow: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200',
    };
    return colorMap[this.color()];
  });

  // Size classes for the chip
  public chipSizeClasses = computed(() => {
    const sizeMap: Record<'small' | 'medium', string> = {
      small: 'px-3 py-0.5 text-xs',
      medium: 'px-4 py-1 text-sm',
    };
    return sizeMap[this.size()];
  });

  public ngOnInit(): void {
    if (this.isFormMode()) {
      // Form control mode
      const formControl = this.form()?.get(this.control());
      if (formControl) {
        this.currentValue.set(formControl.value);
        this.valueChangesSubscription = formControl.valueChanges.subscribe((val: T | null) => {
          this.currentValue.set(val);
        });
      }
    } else {
      // Standalone mode - use direct value input
      this.currentValue.set(this.value());
    }
  }

  public ngOnDestroy(): void {
    if (this.valueChangesSubscription) {
      this.valueChangesSubscription.unsubscribe();
    }
  }

  public onTriggerClick(event: Event): void {
    if (this.disabled()) return;

    // Update value from input in standalone mode (in case it changed)
    if (!this.isFormMode()) {
      this.currentValue.set(this.value());
    }

    event.stopPropagation();
    this.popover()?.toggle(event);
  }

  public onOptionSelect(option: SelectChipOption<T>): void {
    if (option.disabled) return;

    if (this.isFormMode()) {
      // Form control mode
      const formControl = this.form()?.get(this.control());
      if (formControl) {
        formControl.setValue(option.value);
      }
    } else {
      // Standalone mode - just update local state
      this.currentValue.set(option.value);
    }

    this.onChange.emit(option.value);
    this.popover()?.hide();
  }

  public onPopoverShow(): void {
    this.isOpen.set(true);
  }

  public onPopoverHide(): void {
    this.isOpen.set(false);
  }
}
