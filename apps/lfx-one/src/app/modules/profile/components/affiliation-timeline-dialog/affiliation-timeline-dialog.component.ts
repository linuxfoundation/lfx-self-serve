// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { MONTH_ABBREV_OPTIONS, YEAR_OPTIONS } from '@lfx-one/shared/constants';
import {
  AffiliationEditOrg,
  AffiliationEditPeriod,
  AffiliationSegment,
  AffiliationWorkWindow,
  DisabledOrgSuggestion,
  TimelineProjectData,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { isoDateToMonthYear } from '@lfx-one/shared/utils';
import { CheckboxModule } from 'primeng/checkbox';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

@Component({
  selector: 'lfx-affiliation-timeline-dialog',
  imports: [FormsModule, ButtonComponent, CheckboxModule, SelectModule, ToggleSwitchModule],
  templateUrl: './affiliation-timeline-dialog.component.html',
  styleUrl: './affiliation-timeline-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AffiliationTimelineDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  public readonly project = signal<TimelineProjectData>(this.config.data.projects[this.config.data.startProjectIndex ?? 0]);
  public readonly workExperience = signal<WorkExperienceEntry[]>(this.config.data.workExperience ?? []);

  public readonly monthOptions = MONTH_ABBREV_OPTIONS;
  public readonly yearOptions = YEAR_OPTIONS;

  public readonly organizations = signal<AffiliationEditOrg[]>([]);

  public readonly companyOrgs: Signal<AffiliationEditOrg[]> = this.initCompanyOrgs();
  public readonly overlappingPeriodIds: Signal<Set<string>> = this.initOverlappingPeriodIds();
  public readonly hasOverlap: Signal<boolean> = computed(() => this.overlappingPeriodIds().size > 0);
  public readonly hasNoWorkExperience: Signal<boolean> = computed(() => this.companyOrgs().length === 0);
  public readonly hasUnverifiedWorkExperienceOnly: Signal<boolean> = computed(() => this.workExperience().length > 0 && this.companyOrgs().length === 0);
  public readonly hasValidationErrors: Signal<boolean> = this.initHasValidationErrors();
  public readonly availableYearsMap: Signal<Map<string, { label: string; value: string }[]>> = this.initAvailableYearsMap();
  public readonly orgRangeLabelMap: Signal<Map<string, string>> = this.initOrgRangeLabelMap();
  public readonly periodErrorsMap: Signal<Map<string, { outsideWorkExperience: boolean; startAfterEnd: boolean }>> = this.initPeriodErrorsMap();

  public constructor() {
    this.organizations.set(this.buildInitialState());
  }

  public toggleOrganization(orgName: string): void {
    this.organizations.update((orgs) =>
      orgs.map((org) => {
        if (org.organization !== orgName) {
          return org;
        }
        const nowEnabled = !org.enabled;
        return {
          ...org,
          enabled: nowEnabled,
          periods: nowEnabled && org.periods.length === 0 ? this.createDefaultPeriods(org) : org.periods,
        };
      })
    );

    const toggledOrg = this.organizations().find((o) => o.organization === orgName);
    if (toggledOrg?.enabled && orgName !== 'Independent') {
      this.splitIndependentPeriods(toggledOrg.periods);
    }
  }

  public addPeriod(orgName: string): void {
    this.organizations.update((orgs) =>
      orgs.map((org) => {
        if (org.organization !== orgName) {
          return org;
        }
        return { ...org, periods: [...org.periods, this.createEmptyPeriod()] };
      })
    );
  }

  public removePeriod(orgName: string, periodId: string): void {
    this.organizations.update((orgs) =>
      orgs.map((org) => {
        if (org.organization !== orgName) {
          return org;
        }
        return { ...org, periods: org.periods.filter((p) => p.id !== periodId) };
      })
    );
  }

  public updatePeriodField(orgName: string, periodId: string, field: keyof AffiliationEditPeriod, value: string | boolean): void {
    this.organizations.update((orgs) =>
      orgs.map((org) => {
        if (org.organization !== orgName) {
          return org;
        }
        return {
          ...org,
          periods: org.periods.map((p) => {
            if (p.id !== periodId) {
              return p;
            }
            const updated = { ...p, [field]: value };
            if (field === 'isPresent' && value === true) {
              updated.endMonth = '';
              updated.endYear = '';
            }
            return updated;
          }),
        };
      })
    );
  }

  public areAllPeriodsComplete(orgName: string): boolean {
    const org = this.organizations().find((o) => o.organization === orgName);
    if (!org || org.periods.length === 0) {
      return false;
    }
    return org.periods.every((p) => p.startMonth && p.startYear && (p.isPresent || (p.endMonth && p.endYear)));
  }

  public save(): void {
    const enabledOrgs = this.organizations().filter((org) => org.enabled);
    const segments: AffiliationSegment[] = [];

    for (const org of enabledOrgs) {
      for (const period of org.periods) {
        if (!period.startMonth || !period.startYear) {
          continue;
        }
        const startDate = `${period.startMonth} ${period.startYear}`;
        let endDate: string | undefined;
        if (period.isPresent) {
          endDate = undefined;
        } else if (period.endMonth && period.endYear) {
          endDate = `${period.endMonth} ${period.endYear}`;
        }

        segments.push({
          id: period.id,
          role: 'Contributor',
          roleSource: 'user-confirmed',
          organization: org.organization,
          organizationLogo: org.organizationLogo,
          startDate,
          endDate,
          sourceLabel: 'Confirmed by user',
          sourceType: 'user-confirmed',
          needsConfirmation: false,
        });
      }
    }

    const updatedProject: TimelineProjectData = {
      ...this.project(),
      segments,
    };

    this.ref.close({ projects: [updatedProject] });
  }

  public cancel(): void {
    this.ref.close(null);
  }

  private buildInitialState(): AffiliationEditOrg[] {
    const project = this.project();
    const weEntries = this.workExperience();
    const orgMap = new Map<string, AffiliationEditOrg>();

    // Each work-history entry contributes one window. The same org can appear in several
    // entries (multiple stints), so accumulate windows instead of overwriting by org name.
    for (const we of weEntries) {
      const window: AffiliationWorkWindow = { startDate: we.startDate, endDate: we.endDate };
      const existing = orgMap.get(we.organization);
      if (existing) {
        existing.weWindows.push(window);
        if (we.organizationLogo && !existing.organizationLogo) {
          existing.organizationLogo = we.organizationLogo;
        }
      } else {
        orgMap.set(we.organization, {
          organization: we.organization,
          organizationLogo: we.organizationLogo,
          enabled: false,
          periods: [],
          weWindows: [window],
        });
      }
    }

    const suggestions: DisabledOrgSuggestion[] = project.disabledOrgSuggestions ?? [];
    for (const suggestion of suggestions) {
      if (!orgMap.has(suggestion.organizationName)) {
        const matchingWe = weEntries.find((we) => we.organizationId === suggestion.organizationId);
        orgMap.set(suggestion.organizationName, {
          organization: suggestion.organizationName,
          organizationLogo: suggestion.organizationLogo,
          enabled: false,
          periods: [],
          weWindows: [
            {
              startDate: matchingWe?.startDate ?? isoDateToMonthYear(suggestion.earliestStartDate),
              endDate: this.resolveEndDate(matchingWe, suggestion),
            },
          ],
        });
      }
    }

    for (const seg of project.segments) {
      const existing = orgMap.get(seg.organization);
      const period = this.segmentToPeriod(seg);
      if (existing) {
        existing.enabled = true;
        existing.periods.push(period);
        if (seg.organizationLogo && !existing.organizationLogo) {
          existing.organizationLogo = seg.organizationLogo;
        }
      } else {
        orgMap.set(seg.organization, {
          organization: seg.organization,
          organizationLogo: seg.organizationLogo,
          enabled: true,
          periods: [period],
          weWindows: [],
        });
      }
    }

    return Array.from(orgMap.values());
  }

  private segmentToPeriod(seg: AffiliationSegment): AffiliationEditPeriod {
    const startParts = seg.startDate.split(' ');
    const endParts = seg.endDate ? seg.endDate.split(' ') : [];

    return {
      id: seg.id,
      startMonth: startParts[0] || '',
      startYear: startParts[1] || '',
      endMonth: endParts[0] || '',
      endYear: endParts[1] || '',
      isPresent: !seg.endDate,
    };
  }

  private createDefaultPeriods(org: AffiliationEditOrg): AffiliationEditPeriod[] {
    if (org.weWindows.length === 0) {
      return [this.createEmptyPeriod()];
    }
    return org.weWindows.map((window, index) => this.windowToPeriod(window, index));
  }

  private windowToPeriod(window: AffiliationWorkWindow, index: number): AffiliationEditPeriod {
    const startParts = window.startDate ? window.startDate.split(' ') : [];
    const endParts = window.endDate ? window.endDate.split(' ') : [];
    return {
      id: `period-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      startMonth: startParts[0] || '',
      startYear: startParts[1] || '',
      endMonth: endParts[0] || '',
      endYear: endParts[1] || '',
      isPresent: !window.endDate,
      windowIndex: index,
    };
  }

  private createEmptyPeriod(): AffiliationEditPeriod {
    return {
      id: `period-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      startMonth: '',
      startYear: '',
      endMonth: '',
      endYear: '',
      isPresent: false,
    };
  }

  private computePeriodErrors(org: AffiliationEditOrg, period: AffiliationEditPeriod): { outsideWorkExperience: boolean; startAfterEnd: boolean } {
    const errors = { outsideWorkExperience: false, startAfterEnd: false };

    const hasStart = period.startMonth && period.startYear;
    const hasEnd = !period.isPresent && period.endMonth && period.endYear;

    if (!hasStart) {
      return errors;
    }

    const startTs = this.periodToTimestamp(period.startMonth, period.startYear);
    const endTs = hasEnd ? this.periodToTimestamp(period.endMonth, period.endYear) : null;

    if (endTs !== null) {
      errors.startAfterEnd = startTs > endTs;
    }

    // Only constrain to work history when the org has windows. Orgs known solely from existing
    // confirmed affiliations (or "Independent") carry no windows and remain unrestricted.
    if (org.weWindows.length > 0) {
      const periodEndTs = period.isPresent ? Date.now() : endTs;
      errors.outsideWorkExperience = !org.weWindows.some((window) => this.periodWithinWindow(startTs, periodEndTs, window));
    }

    return errors;
  }

  private periodWithinWindow(startTs: number, endTs: number | null, window: AffiliationWorkWindow): boolean {
    const windowStartTs = this.parseWeDate(window.startDate);
    const windowEndTs = window.endDate ? this.parseWeDate(window.endDate) : Date.now();
    if (startTs < windowStartTs || startTs > windowEndTs) {
      return false;
    }
    if (endTs === null) {
      return true;
    }
    return endTs >= windowStartTs && endTs <= windowEndTs;
  }

  private initAvailableYearsMap(): Signal<Map<string, { label: string; value: string }[]>> {
    return computed(() => {
      const map = new Map<string, { label: string; value: string }[]>();
      const currentYear = new Date().getFullYear();
      for (const org of this.organizations()) {
        const unrestricted = org.organization === 'Independent' || org.weWindows.length === 0;
        // Fallback for manually-added / segment-derived periods on an org that has windows:
        // the union of every stint's years (gap years between stints fall out naturally).
        const unionYears = unrestricted ? null : this.windowsToYearOptions(org.weWindows, currentYear);

        for (const period of org.periods) {
          if (unrestricted) {
            map.set(period.id, this.yearOptions);
            continue;
          }
          // Seeded rows stay bound to their stint. Un-bound rows (manually added) show the full
          // range until a start/end year is picked, then snap to the stint that year belongs to.
          const window = period.windowIndex !== undefined ? org.weWindows[period.windowIndex] : this.inferWindowForPeriod(period, org.weWindows, currentYear);
          map.set(period.id, window ? this.windowsToYearOptions([window], currentYear) : (unionYears ?? this.yearOptions));
        }
      }
      return map;
    });
  }

  private windowsToYearOptions(windows: AffiliationWorkWindow[], currentYear: number): { label: string; value: string }[] {
    const allowedYears = new Set<number>();
    for (const window of windows) {
      const startYear = parseInt(window.startDate.split(' ')[1], 10) || 2000;
      const endYear = window.endDate ? parseInt(window.endDate.split(' ')[1], 10) || currentYear : currentYear;
      for (let yr = startYear; yr <= endYear; yr++) {
        allowedYears.add(yr);
      }
    }
    return this.yearOptions.filter((y) => allowedYears.has(parseInt(y.value, 10)));
  }

  // Infer which stint window a period belongs to from the first year the user picks (start, else end).
  // Assumes stints don't overlap in years; if they did, the earliest matching stint wins.
  private inferWindowForPeriod(period: AffiliationEditPeriod, windows: AffiliationWorkWindow[], currentYear: number): AffiliationWorkWindow | undefined {
    const selectedYear = period.startYear || period.endYear;
    if (!selectedYear) {
      return undefined;
    }
    const yr = parseInt(selectedYear, 10);
    return windows.find((window) => {
      const startYear = parseInt(window.startDate.split(' ')[1], 10) || 2000;
      const endYear = window.endDate ? parseInt(window.endDate.split(' ')[1], 10) || currentYear : currentYear;
      return yr >= startYear && yr <= endYear;
    });
  }

  private initPeriodErrorsMap(): Signal<Map<string, { outsideWorkExperience: boolean; startAfterEnd: boolean }>> {
    return computed(() => {
      const map = new Map<string, { outsideWorkExperience: boolean; startAfterEnd: boolean }>();
      for (const org of this.organizations()) {
        for (const period of org.periods) {
          map.set(period.id, this.computePeriodErrors(org, period));
        }
      }
      return map;
    });
  }

  private initOrgRangeLabelMap(): Signal<Map<string, string>> {
    return computed(() => {
      const map = new Map<string, string>();
      for (const org of this.organizations()) {
        if (org.weWindows.length === 0) {
          continue;
        }
        const earliestStart = [...org.weWindows].sort((a, b) => this.parseWeDate(a.startDate) - this.parseWeDate(b.startDate))[0].startDate;
        const endedWindows = org.weWindows.filter((w): w is Required<AffiliationWorkWindow> => !!w.endDate);
        const ongoing = endedWindows.length < org.weWindows.length;
        const latestEnd = ongoing ? 'Present' : [...endedWindows].sort((a, b) => this.parseWeDate(b.endDate) - this.parseWeDate(a.endDate))[0].endDate;
        map.set(org.organization, `${earliestStart} – ${latestEnd}`);
      }
      return map;
    });
  }

  private initCompanyOrgs(): Signal<AffiliationEditOrg[]> {
    return computed(() => this.organizations().filter((org) => org.organization !== 'Independent'));
  }

  private initHasValidationErrors(): Signal<boolean> {
    return computed(() => {
      const enabledOrgs = this.organizations().filter((org) => org.enabled);
      return enabledOrgs.some((org) =>
        org.periods.some((period) => {
          const errors = this.computePeriodErrors(org, period);
          return errors.outsideWorkExperience || errors.startAfterEnd;
        })
      );
    });
  }

  private initOverlappingPeriodIds(): Signal<Set<string>> {
    return computed(() => {
      const enabledOrgs = this.organizations().filter((org) => org.enabled);
      const allPeriods: { id: string; start: number; end: number }[] = [];

      for (const org of enabledOrgs) {
        for (const period of org.periods) {
          if (!period.startMonth || !period.startYear) {
            continue;
          }
          const start = this.periodToTimestamp(period.startMonth, period.startYear);
          let end: number | null;
          if (period.isPresent) {
            end = Date.now();
          } else if (period.endMonth && period.endYear) {
            end = this.periodToTimestamp(period.endMonth, period.endYear);
          } else {
            end = null;
          }
          if (end === null) {
            continue;
          }
          allPeriods.push({ id: period.id, start, end });
        }
      }

      const ids = new Set<string>();
      for (let i = 0; i < allPeriods.length; i++) {
        for (let j = i + 1; j < allPeriods.length; j++) {
          if (allPeriods[i].start < allPeriods[j].end && allPeriods[j].start < allPeriods[i].end) {
            ids.add(allPeriods[i].id);
            ids.add(allPeriods[j].id);
          }
        }
      }
      return ids;
    });
  }

  private parseWeDate(dateStr: string): number {
    const parts = dateStr.split(' ');
    return this.periodToTimestamp(parts[0], parts[1]);
  }

  private periodToTimestamp(month: string, year: string): number {
    const monthIndex = MONTH_ABBREV_OPTIONS.findIndex((m) => m.value === month);
    return new Date(parseInt(year, 10), monthIndex >= 0 ? monthIndex : 0, 1).getTime();
  }

  private splitIndependentPeriods(newOrgPeriods: AffiliationEditPeriod[]): void {
    const indepOrg = this.organizations().find((o) => o.organization === 'Independent');
    if (!indepOrg?.enabled || indepOrg.periods.length === 0) {
      return;
    }

    let remainingPeriods = [...indepOrg.periods];

    for (const np of newOrgPeriods) {
      if (!np.startMonth || !np.startYear) {
        continue;
      }
      const nStart = this.periodToTimestamp(np.startMonth, np.startYear);
      let nEnd: number | null;
      if (np.isPresent) {
        nEnd = Date.now();
      } else if (np.endMonth && np.endYear) {
        nEnd = this.periodToTimestamp(np.endMonth, np.endYear);
      } else {
        nEnd = null;
      }
      if (nEnd === null) {
        continue;
      }

      const nextPeriods: AffiliationEditPeriod[] = [];

      for (const ip of remainingPeriods) {
        if (!ip.startMonth || !ip.startYear) {
          nextPeriods.push(ip);
          continue;
        }
        const iStart = this.periodToTimestamp(ip.startMonth, ip.startYear);
        let iEnd: number | null;
        if (ip.isPresent) {
          iEnd = Date.now();
        } else if (ip.endMonth && ip.endYear) {
          iEnd = this.periodToTimestamp(ip.endMonth, ip.endYear);
        } else {
          iEnd = null;
        }
        if (iEnd === null) {
          nextPeriods.push(ip);
          continue;
        }

        if (nEnd <= iStart || nStart >= iEnd) {
          nextPeriods.push(ip);
        } else if (nStart <= iStart && nEnd >= iEnd) {
          // N covers I entirely — remove
        } else if (nStart > iStart && nEnd >= iEnd) {
          const prev = this.getPreviousMonth(np.startMonth, np.startYear);
          nextPeriods.push({ ...ip, endMonth: prev.month, endYear: prev.year, isPresent: false });
        } else if (nStart <= iStart && nEnd < iEnd) {
          if (np.isPresent) {
            // N is present — nothing remains after
          } else {
            const next = this.getNextMonth(np.endMonth, np.endYear);
            nextPeriods.push({ ...ip, startMonth: next.month, startYear: next.year });
          }
        } else {
          // N is inside I — split into two pieces
          const prev = this.getPreviousMonth(np.startMonth, np.startYear);
          nextPeriods.push({
            ...ip,
            id: `${ip.id}-before`,
            endMonth: prev.month,
            endYear: prev.year,
            isPresent: false,
          });
          if (!np.isPresent) {
            const next = this.getNextMonth(np.endMonth, np.endYear);
            nextPeriods.push({
              ...ip,
              id: `${ip.id}-after`,
              startMonth: next.month,
              startYear: next.year,
            });
          }
        }
      }

      remainingPeriods = nextPeriods;
    }

    this.organizations.update((orgs) =>
      orgs.map((org) => {
        if (org.organization !== 'Independent') {
          return org;
        }
        if (remainingPeriods.length === 0) {
          return { ...org, enabled: false, periods: [] };
        }
        return { ...org, periods: remainingPeriods };
      })
    );
  }

  private getPreviousMonth(month: string, year: string): { month: string; year: string } {
    const idx = MONTH_ABBREV_OPTIONS.findIndex((m) => m.value === month);
    if (idx <= 0) {
      return { month: MONTH_ABBREV_OPTIONS[11].value, year: String(parseInt(year, 10) - 1) };
    }
    return { month: MONTH_ABBREV_OPTIONS[idx - 1].value, year };
  }

  private resolveEndDate(matchingWe: WorkExperienceEntry | undefined, suggestion: DisabledOrgSuggestion): string | undefined {
    if (matchingWe) {
      return matchingWe.endDate;
    }
    if (suggestion.latestEndDate) {
      return isoDateToMonthYear(suggestion.latestEndDate);
    }
    return undefined;
  }

  private getNextMonth(month: string, year: string): { month: string; year: string } {
    const idx = MONTH_ABBREV_OPTIONS.findIndex((m) => m.value === month);
    if (idx >= 11) {
      return { month: MONTH_ABBREV_OPTIONS[0].value, year: String(parseInt(year, 10) + 1) };
    }
    return { month: MONTH_ABBREV_OPTIONS[idx + 1].value, year };
  }
}
