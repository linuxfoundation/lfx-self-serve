// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, input, model, Signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';

import { ItOsAgentChatComponent } from '../it-os-agent-chat/it-os-agent-chat.component';
import { ItOsChatEngine } from '../services/it-os-chat-engine';

// Page frame for the IT OS GitHub, email forwarding and mailing list agents (#4257): Agent and Details tabs,
// the sample situation and "Viewing as" demo controls, and Reset demo. The Details tab is projected content.
@Component({
  selector: 'lfx-it-os-agent-shell',
  imports: [ReactiveFormsModule, ButtonComponent, SelectButtonComponent, SelectComponent, ItOsAgentChatComponent],
  templateUrl: './it-os-agent-shell.component.html',
})
export class ItOsAgentShellComponent {
  // === Inputs ===
  public readonly engine = input.required<ItOsChatEngine>();
  public readonly icon = input.required<string>();
  public readonly iconClass = input.required<string>();
  public readonly testId = input.required<string>();

  // === Forms ===
  public readonly viewForm = new FormGroup({
    role: new FormControl('staff', { nonNullable: true }),
    scenario: new FormControl('', { nonNullable: true }),
  });

  // === Model signals ===
  public readonly tab = model('agent');

  // === Computed ===
  public readonly scenarioOptions: Signal<{ label: string; value: string }[]> = computed(() =>
    this.engine().scenarios.map((s) => ({ label: s.label, value: s.id }))
  );

  protected readonly roleOptions = [
    { label: 'LF staff', value: 'staff' },
    { label: 'External maintainer', value: 'external' },
  ];

  public constructor() {
    // The engine keeps the demo across visits, so start the controls from its current values.
    effect(() => {
      const engine = this.engine();
      untracked(() => {
        engine.start();
        this.syncControls();
      });
    });
    this.viewForm.controls.role.valueChanges.pipe(takeUntilDestroyed()).subscribe((role) => this.engine().staff.set(role === 'staff'));
    this.viewForm.controls.scenario.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      if (id && id !== this.engine().scenario()) this.engine().setScenario(id);
    });
  }

  public reset(): void {
    this.engine().reset();
    this.syncControls();
    this.tab.set('agent');
  }

  private syncControls(): void {
    const engine = this.engine();
    this.viewForm.reset({ role: engine.staff() ? 'staff' : 'external', scenario: engine.scenario() }, { emitEvent: false });
  }
}
