// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  MeetingRegistrant,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
} from '@lfx-pcc/shared/interfaces';
import { Request, Response } from 'express';

import { Logger } from '../helpers/logger';
import { Responder } from '../helpers/responder';
import { MeetingService } from '../services/meeting.service';

/**
 * Controller for handling meeting HTTP requests
 */
export class MeetingController {
  private meetingService: MeetingService = new MeetingService();

  /**
   * GET /meetings
   */
  public async getMeetings(req: Request, res: Response): Promise<void> {
    const startTime = Logger.start(req, 'get_meetings', {
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const meetings = await this.meetingService.getMeetings(req, req.query as Record<string, any>);

      // TODO: Remove this once we have a way to get the registrants count
      const counts = await Promise.all(
        meetings.map(async (m) => {
          const registrants = await this.meetingService.getMeetingRegistrants(req, m.uid);
          return registrants.length;
        })
      );
      meetings.forEach((m, i) => {
        m.individual_registrants_count = counts[i];
      });

      Logger.success(req, 'get_meetings', startTime, {
        meeting_count: meetings.length,
      });

      res.json(meetings);
    } catch (error) {
      Logger.error(req, 'get_meetings', startTime, error);
      Responder.handle(res, error, 'get_meetings');
    }
  }

  /**
   * GET /meetings/:uid
   */
  public async getMeetingById(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_meeting_by_id', {
      meeting_uid: uid,
    });

    try {
      if (!uid) {
        Logger.error(req, 'get_meeting_by_id', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      const meeting = await this.meetingService.getMeetingById(req, uid);

      Logger.success(req, 'get_meeting_by_id', startTime, {
        meeting_uid: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      res.json(meeting);
    } catch (error) {
      Logger.error(req, 'get_meeting_by_id', startTime, error, {
        meeting_uid: uid,
      });
      Responder.handle(res, error, 'get_meeting_by_id');
    }
  }

  /**
   * POST /meetings
   */
  public async createMeeting(req: Request, res: Response): Promise<void> {
    const meetingData: CreateMeetingRequest = req.body;
    const startTime = Logger.start(req, 'create_meeting', {
      project_uid: meetingData?.project_uid,
      title: meetingData?.title,
      start_time: meetingData?.start_time,
      duration: meetingData?.duration,
      timezone: meetingData?.timezone,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      const meeting = await this.meetingService.createMeeting(req, meetingData);

      Logger.success(req, 'create_meeting', startTime, {
        meeting_id: meeting.uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      res.status(201).json(meeting);
    } catch (error) {
      Logger.error(req, 'create_meeting', startTime, error, {
        project_uid: req.body?.project_uid,
      });
      Responder.handle(res, error, 'create_meeting');
    }
  }

  /**
   * PUT /meetings/:uid
   */
  public async updateMeeting(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const meetingData: UpdateMeetingRequest = req.body;
    const { editType } = req.query;
    const startTime = Logger.start(req, 'update_meeting', {
      meeting_uid: uid,
      project_uid: meetingData?.project_uid,
      start_time: meetingData?.start_time,
      timezone: meetingData?.timezone,
      edit_type: editType,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (!uid) {
        Logger.error(req, 'update_meeting', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      const meeting = await this.meetingService.updateMeeting(req, uid, meetingData, editType as 'single' | 'future');

      Logger.success(req, 'update_meeting', startTime, {
        meeting_uid: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
        edit_type: editType || 'single',
      });

      res.json(meeting);
    } catch (error) {
      Logger.error(req, 'update_meeting', startTime, error, {
        meeting_uid: uid,
        edit_type: editType,
      });
      Responder.handle(res, error, 'update_meeting');
    }
  }

  /**
   * DELETE /meetings/:uid
   */
  public async deleteMeeting(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'delete_meeting', {
      meeting_uid: uid,
    });

    try {
      if (!uid) {
        Logger.error(req, 'delete_meeting', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      await this.meetingService.deleteMeeting(req, uid);

      Logger.success(req, 'delete_meeting', startTime, {
        meeting_uid: uid,
        status_code: 204,
      });

      res.status(204).send();
    } catch (error) {
      Logger.error(req, 'delete_meeting', startTime, error, {
        meeting_uid: uid,
      });
      Responder.handle(res, error, 'delete_meeting');
    }
  }

  /**
   * GET /meetings/:uid/registrants
   */
  public async getMeetingRegistrants(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_meeting_registrants', {
      meeting_uid: uid,
    });

    try {
      if (!uid) {
        Logger.error(req, 'get_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      const registrants = await this.meetingService.getMeetingRegistrants(req, uid);

      Logger.success(req, 'get_meeting_registrants', startTime, {
        meeting_uid: uid,
        registrant_count: registrants.length,
      });

      res.json(registrants);
    } catch (error) {
      Logger.error(req, 'get_meeting_registrants', startTime, error, {
        meeting_uid: uid,
      });
      Responder.handle(res, error, 'get_meeting_registrants');
    }
  }

  /**
   * POST /meetings/:uid/registrants
   * @description Adds one or more registrants
   */
  public async addMeetingRegistrants(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const registrantData: CreateMeetingRegistrantRequest[] =
      req.body?.map((registrant: CreateMeetingRegistrantRequest) => ({
        ...registrant,
        meeting_uid: uid,
      })) || [];

    const startTime = Logger.start(req, 'add_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: registrantData.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (!uid) {
        Logger.error(req, 'add_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      if (!Array.isArray(registrantData) || !registrantData.length) {
        Logger.error(req, 'add_meeting_registrants', startTime, new Error('No registrants provided'));
        Responder.badRequest(res, 'No registrants provided', {
          code: 'MISSING_REGISTRANT_DATA',
        });
        return;
      }

      // Attempt to add the first user to the meeting, if it fails, return the error
      const firstRegistrant = registrantData[0];
      const firstRegistrantResult = await this.meetingService.addMeetingRegistrant(req, firstRegistrant);

      let registrants: MeetingRegistrant[] = [firstRegistrantResult];
      // Add the rest of the registrants in parallel
      if (registrantData.length > 1) {
        const requests = registrantData.slice(1).map((registrant) =>
          this.meetingService.addMeetingRegistrant(req, registrant).catch((error) => {
            Logger.error(req, 'add_meeting_registrants', startTime, error, {
              meeting_uid: uid,
              registrant_uid: registrant.email,
            });

            return Promise.reject(error);
          })
        );

        registrants = [...registrants, ...(await Promise.all(requests))];
      }

      Logger.success(req, 'add_meeting_registrants', startTime, {
        meeting_uid: uid,
        registrant_count: registrants.length,
      });

      res.status(201).json(registrants);
    } catch (error) {
      Logger.error(req, 'add_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: registrantData.length,
      });
      Responder.handle(res, error, 'add_meeting_registrants');
    }
  }

  /**
   * PUT /meetings/:uid/registrants
   * @description Updates one or more registrants
   */
  public async updateMeetingRegistrants(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const updateData: { uid: string; changes: UpdateMeetingRegistrantRequest }[] =
      req.body?.map((update: { uid: string; changes: UpdateMeetingRegistrantRequest }) => ({
        ...update,
        changes: {
          ...update.changes,
          meeting_uid: uid,
        },
      })) || [];

    const startTime = Logger.start(req, 'update_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: updateData.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (!uid) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      if (!Array.isArray(updateData) || !updateData.length) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('No registrants provided'));
        Responder.badRequest(res, 'No registrants provided', {
          code: 'MISSING_REGISTRANT_DATA',
        });
        return;
      }

      // Basic validation - only check for registrant UIDs
      if (updateData.some((update) => !update.uid)) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('Missing registrant UIDs for update'), {
          provided_uids: updateData.map((update) => update.uid).filter(Boolean),
        });

        Responder.badRequest(res, 'One or more registrants are missing UID', {
          code: 'MISSING_REGISTRANT_UID',
        });
        return;
      }

      // Attempt to update the first registrant, if it fails, return the error
      const firstUpdate = updateData[0];
      const firstRegistrantResult = await this.meetingService.updateMeetingRegistrant(req, uid, firstUpdate.uid, firstUpdate.changes);

      let registrants: MeetingRegistrant[] = [firstRegistrantResult];
      // Update the rest of the registrants in parallel
      if (updateData.length > 1) {
        const requests = updateData.slice(1).map((update) =>
          this.meetingService.updateMeetingRegistrant(req, uid, update.uid, update.changes).catch((error) => {
            Logger.error(req, 'update_meeting_registrants', startTime, error, {
              meeting_uid: uid,
              registrant_uid: update.uid,
            });

            return Promise.reject(error);
          })
        );

        registrants = [...registrants, ...(await Promise.all(requests))];
      }

      Logger.success(req, 'update_meeting_registrants', startTime, {
        meeting_uid: uid,
        registrant_count: registrants.length,
      });

      res.json(registrants);
    } catch (error) {
      Logger.error(req, 'update_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: updateData.length,
      });
      Responder.handle(res, error, 'update_meeting_registrants');
    }
  }

  /**
   * DELETE /meetings/:uid/registrants
   * @description Deletes one or more registrants
   */
  public async deleteMeetingRegistrants(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const registrantUids: string[] = req.body || [];

    const startTime = Logger.start(req, 'delete_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: registrantUids.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (!uid) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      if (!registrantUids.length) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Empty registrant UIDs array'));
        Responder.badRequest(res, 'Empty registrant UIDs array', {
          code: 'MISSING_REGISTRANT_UIDS',
        });
        return;
      }

      // Basic validation - only check for non-empty array
      if (!Array.isArray(registrantUids) || !registrantUids.length || !req.body.every((item: string) => typeof item === 'string')) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Empty registrant UIDs array'), {
          provided_count: registrantUids.length,
        });

        Responder.badRequest(res, 'Array of registrant UIDs is required', {
          code: 'MISSING_REGISTRANT_UIDS',
        });
        return;
      }

      // Attempt to delete the first registrant, if it fails, return the error
      const firstRegistrantUid = registrantUids[0];
      await this.meetingService.deleteMeetingRegistrant(req, uid, firstRegistrantUid);

      // Delete the rest of the registrants in parallel
      if (registrantUids.length > 1) {
        const requests = registrantUids.slice(1).map((registrantUid) =>
          this.meetingService.deleteMeetingRegistrant(req, uid, registrantUid).catch((error) => {
            Logger.error(req, 'delete_meeting_registrants', startTime, error, {
              meeting_uid: uid,
              registrant_uid: registrantUid,
            });

            return Promise.reject(error);
          })
        );

        await Promise.all(requests);
      }

      Logger.success(req, 'delete_meeting_registrants', startTime, {
        meeting_uid: uid,
        registrant_count: registrantUids.length,
        status_code: 204,
      });

      res.status(204).send();
    } catch (error) {
      Logger.error(req, 'delete_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: registrantUids.length,
      });
      Responder.handle(res, error, 'delete_meeting_registrants');
    }
  }
}
