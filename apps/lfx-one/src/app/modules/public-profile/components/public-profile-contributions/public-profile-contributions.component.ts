// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { SelectComponent } from '@components/select/select.component';
import { PUBLIC_PROFILE_ALL_YEARS, PUBLIC_PROFILE_ALL_YEARS_LABEL } from '@lfx-one/shared/constants';
import { PublicProfileProject, PublicProfileTechnicalContribution } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-public-profile-contributions',
  imports: [AvatarComponent, DecimalPipe, SelectComponent],
  templateUrl: './public-profile-contributions.component.html',
})
export class PublicProfileContributionsComponent {
  public readonly technicalContribution = input<PublicProfileTechnicalContribution | null>(null);

  protected readonly yearForm = new FormGroup({ year: new FormControl<number>(PUBLIC_PROFILE_ALL_YEARS, { nonNullable: true }) });

  private readonly selectedYear: Signal<number> = this.initSelectedYear();
  private readonly allProjects = computed<PublicProfileProject[]>(() => this.technicalContribution()?.projects ?? []);

  protected readonly yearOptions: Signal<{ label: string; value: number }[]> = this.initYearOptions();
  protected readonly projects: Signal<PublicProfileProject[]> = this.initProjects();

  private initSelectedYear(): Signal<number> {
    return toSignal(this.yearForm.controls.year.valueChanges, { initialValue: PUBLIC_PROFILE_ALL_YEARS });
  }

  private initYearOptions(): Signal<{ label: string; value: number }[]> {
    return computed(() => {
      const years = new Set<number>();
      for (const project of this.allProjects()) {
        project.years.forEach((entry) => years.add(entry.year));
      }
      const yearOptions = [...years].sort((a, b) => b - a).map((year) => ({ label: String(year), value: year }));
      return [{ label: PUBLIC_PROFILE_ALL_YEARS_LABEL, value: PUBLIC_PROFILE_ALL_YEARS }, ...yearOptions];
    });
  }

  // "Last 5 years" keeps the BFF-summed totals; a specific year swaps in that year's row (0s when absent).
  private initProjects(): Signal<PublicProfileProject[]> {
    return computed(() => {
      const year = this.selectedYear();
      if (year === PUBLIC_PROFILE_ALL_YEARS) {
        return this.allProjects();
      }
      return this.allProjects().map((project) => {
        const row = project.years.find((entry) => entry.year === year);
        return { ...project, commits: row?.commits ?? 0, prs: row?.prs ?? 0, issues: row?.issues ?? 0, added: row?.added ?? 0, deleted: row?.deleted ?? 0 };
      });
    });
  }
}
