// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingCalendarEvent } from '@lfx-one/shared/interfaces';
import { buildMeetingIcs, buildMeetingIcsFileName, resolveMeetingCalendarOccurrence } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError } from '../errors';
import { contentDispositionAttachment } from '../helpers/content-disposition.helper';
import { getStringQueryParam, validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { MeetingService } from '../services/meeting.service';

/** LFX One's own origin from configuration; never derived from the request's Host header. */
function resolveLfxOrigin(): string {
  try {
    return new URL(process.env['PCC_BASE_URL'] || '').origin;
  } catch {
    return 'https://app.lfx.dev';
  }
}

/**
 * Serves a meeting occurrence as an .ics file (#4862).
 *
 * The event is built from an allow-list (id, occurrence id, title, project name, start, duration) and the LFX meeting
 * page URL. The meeting description, passcode, host key, Zoom links and registrants are never read into the file.
 */
export class MeetingCalendarController {
  private readonly meetingService: MeetingService = new MeetingService();

  /**
   * GET /meetings/:uid/calendar.ics
   *
   * Permission is the page's own: the meeting is fetched from ITX under the caller's token, so a caller who cannot
   * view the meeting gets the upstream 403/404 (authentication itself is enforced by the /api middleware, 401).
   */
  public async getMeetingCalendarIcs(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_meeting_calendar_ics', { meeting_id: uid });

    try {
      if (!validateUidParameter(uid, req, next, { operation: 'get_meeting_calendar_ics', service: 'meeting_calendar_controller' })) {
        return;
      }

      const meeting = await this.meetingService.getMeetingById(req, uid, 'v1_meeting', { access: false, includeProject: true });

      const requested = Number.parseInt(getStringQueryParam(req, 'occurrence') ?? '', 10);
      const occurrence = resolveMeetingCalendarOccurrence(meeting, Number.isFinite(requested) ? requested : null);
      if (!occurrence) {
        throw new ResourceNotFoundError('Meeting occurrence', uid, {
          operation: 'get_meeting_calendar_ics',
          service: 'meeting_calendar_controller',
          path: `/meetings/${uid}/calendar.ics`,
        });
      }

      const event: MeetingCalendarEvent = {
        uid,
        occurrenceId: occurrence.occurrenceId,
        title: meeting.title,
        start: occurrence.start,
        durationMinutes: occurrence.durationMinutes,
        projectName: meeting.project_name,
        joinUrl: `${resolveLfxOrigin()}/meetings/${encodeURIComponent(uid)}`,
      };

      logger.success(req, 'get_meeting_calendar_ics', startTime, { meeting_id: uid, recurring: !!occurrence.occurrenceId });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', contentDispositionAttachment(buildMeetingIcsFileName(meeting.title)));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(buildMeetingIcs(event));
    } catch (error) {
      next(error);
    }
  }
}
