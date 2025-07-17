// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ProjectLayoutComponent } from '@app/layouts/project-layout/project-layout.component';
import { CardComponent } from '@app/shared/components/card/card.component';
import { TableComponent } from '@app/shared/components/table/table.component';
import { ProjectService } from '@app/shared/services/project.service';
import { Project } from '@lfx-pcc/shared/interfaces';
import { of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-project',
  imports: [ProjectLayoutComponent, CardComponent, TableComponent, DatePipe, RouterModule],
  templateUrl: './project.component.html',
  styleUrl: './project.component.scss',
})
export class ProjectComponent {
  public readonly activatedRoute = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);

  // Load project data based on slug from URL
  public project: Signal<Project | null> = toSignal(
    this.activatedRoute.params.pipe(
      switchMap((params) => {
        const slug = params['slug'];
        if (slug) {
          return this.projectService.getProject(slug);
        }

        return of(null);
      })
    ),
    { initialValue: null }
  );

  public readonly meetingTableData: Signal<any[]> = signal([
    {
      id: 1,
      title: 'Meeting with a really long title that should be truncated',
      url: 'meetings',
      status: 'Upcoming',
      date: '2025-07-10T10:00:00Z',
    },
    {
      id: 2,
      title: 'Standup',
      url: 'meetings',
      status: 'Upcoming',
      date: '2025-07-10T13:00:00Z',
    },
    {
      id: 3,
      title: 'Q4 Board Meeting',
      url: 'meetings',
      status: 'Upcoming',
      date: '2025-07-10T16:00:00Z',
    },
  ]);

  public readonly committeeTableData: Signal<any[]> = signal([
    {
      id: 1,
      title: 'TOS Working Group',
      url: 'committees',
      status: 'Upcoming',
      date: '2025-07-10T10:32:00Z',
    },
    {
      id: 2,
      title: 'Governing Board',
      url: 'committees',
      status: 'Upcoming',
      date: '2025-07-10T11:50:00Z',
    },
    {
      id: 3,
      title: 'Staff',
      url: 'committees',
      status: 'Upcoming',
      date: '2025-07-10T12:00:00Z',
    },
  ]);

  public readonly mailingListTableData: Signal<any[]> = signal([
    {
      id: 1,
      title: 'board',
      url: 'mailing-lists',
      status: 'Upcoming',
      date: '2025-07-10T10:32:00Z',
    },
    {
      id: 2,
      title: 'gsoc',
      url: 'mailing-lists',
      status: 'Upcoming',
      date: '2025-07-10T10:32:00Z',
    },
    {
      id: 3,
      title: 'budget',
      url: 'mailing-lists',
      status: 'Upcoming',
      date: '2025-07-10T10:32:00Z',
    },
  ]);
}
