// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, EventClickArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';

@Component({
  selector: 'lfx-fullcalendar',
  standalone: true,
  imports: [FullCalendarModule],
  templateUrl: './fullcalendar.component.html',
  styleUrl: './fullcalendar.component.scss',
})
export class FullCalendarComponent {
  // Core properties
  public readonly events = input<EventInput[]>([]);
  public readonly initialView = input<string>('dayGridMonth');
  public readonly height = input<string | number>('auto');

  // Events
  public readonly eventClick = output<EventClickArg>();

  // Calendar options computed property
  protected get calendarOptions(): CalendarOptions {
    return {
      initialView: this.initialView(),
      plugins: [dayGridPlugin, timeGridPlugin],
      events: this.events(),
      height: this.height(),
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek',
      },
      buttonText: {
        today: 'Today',
        dayGridMonth: 'Month',
        timeGridWeek: 'Week',
      },
      eventClick: (info) => this.handleEventClick(info),
      weekends: true,
      editable: false,
      selectable: false,
      selectMirror: false,
      dayMaxEvents: 3,
      moreLinkClick: 'popover',
      dayHeaderFormat: { weekday: 'short' },
      eventTimeFormat: {
        hour: 'numeric',
        minute: '2-digit',
        meridiem: 'short',
      },
      displayEventTime: true,
      eventOrder: 'start',
      nowIndicator: true,
      scrollTime: new Date().getHours() + ':00:00',
    };
  }

  // Event handlers
  protected handleEventClick(info: EventClickArg): void {
    this.eventClick.emit(info);
  }
}
