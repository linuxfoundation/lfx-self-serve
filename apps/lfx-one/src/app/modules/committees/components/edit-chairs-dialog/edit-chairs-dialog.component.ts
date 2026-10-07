// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { EditChairsDialogData, EditChairsDialogResult } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-edit-chairs-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, SelectComponent],
  templateUrl: './edit-chairs-dialog.component.html',
})
export class EditChairsDialogComponent {
  private readonly config = inject(DynamicDialogConfig<EditChairsDialogData>);
  private readonly ref = inject(DynamicDialogRef);

  public readonly memberOptions: { label: string; value: string }[] = this.config.data?.members ?? [];
  private readonly labelMap = new Map<string, string>(this.memberOptions.map((m) => [m.value, m.label]));

  public readonly chairUids = signal<string[]>([...(this.config.data?.currentChairUids ?? [])]);
  public readonly viceChairUids = signal<string[]>([...(this.config.data?.currentViceChairUids ?? [])]);

  public readonly addChairForm = new FormGroup({ uid: new FormControl<string | null>(null) });
  public readonly addViceChairForm = new FormGroup({ uid: new FormControl<string | null>(null) });

  public readonly chairOptions: Signal<{ label: string; value: string }[]> = computed(() => {
    const assigned = new Set([...this.chairUids(), ...this.viceChairUids()]);
    return this.memberOptions.filter((m) => !assigned.has(m.value));
  });

  public readonly viceChairOptions: Signal<{ label: string; value: string }[]> = computed(() => {
    const assigned = new Set([...this.chairUids(), ...this.viceChairUids()]);
    return this.memberOptions.filter((m) => !assigned.has(m.value));
  });

  public labelFor(uid: string): string {
    return this.labelMap.get(uid) ?? uid;
  }

  public removeChair(uid: string): void {
    this.chairUids.update((uids) => uids.filter((u) => u !== uid));
  }

  public removeViceChair(uid: string): void {
    this.viceChairUids.update((uids) => uids.filter((u) => u !== uid));
  }

  public onChairSelected(event: { value: string | null }): void {
    if (event.value) {
      this.chairUids.update((uids) => [...uids, event.value as string]);
      this.addChairForm.reset();
    }
  }

  public onViceChairSelected(event: { value: string | null }): void {
    if (event.value) {
      this.viceChairUids.update((uids) => [...uids, event.value as string]);
      this.addViceChairForm.reset();
    }
  }

  public cancel(): void {
    this.ref.close();
  }

  public save(): void {
    const result: EditChairsDialogResult = {
      chairUids: this.chairUids(),
      viceChairUids: this.viceChairUids(),
    };
    this.ref.close(result);
  }
}
