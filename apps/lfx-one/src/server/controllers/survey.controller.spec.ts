// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_UID = '11111111-1111-1111-1111-111111111111';

// Hoisted, per-test-controllable mocks for the controller's other collaborators.
const { surveySvc } = vi.hoisted(() => ({
  surveySvc: {
    getSurveyById: vi.fn(),
    getSurveyResponses: vi.fn(),
    deleteSurvey: vi.fn(),
    sendSurveyReminders: vi.fn(),
    getResyncPreview: vi.fn(),
    resyncRecipients: vi.fn(),
  },
}));

// Deep-import the real `isUuid` (mirrors insights-tokens.controller.spec.ts) so these
// security regression tests fail if UUID validation itself becomes permissive, rather
// than only proving the controller calls some uid guard.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await import('../../../../../packages/shared/src/utils/string.utils');
  return { isUuid: actual.isUuid };
});
vi.mock('../services/survey.service', () => ({
  SurveyService: vi.fn(function () {
    return surveySvc;
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    sanitize: vi.fn((value: unknown) => value),
  },
}));

import { SurveyController } from './survey.controller';
import { ServiceValidationError } from '../errors';

function buildReqRes(uid: string) {
  const req = {
    params: { uid },
    query: {},
    headers: {},
    bearerToken: undefined,
    path: `/surveys/${uid}`,
  } as any;
  const res = { json: vi.fn(), status: vi.fn(() => res), send: vi.fn() } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe('SurveyController uid validation (linuxfoundation/lfx-self-serve-ops#436)', () => {
  let controller: SurveyController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SurveyController();
  });

  describe('getSurveyById', () => {
    it.each(['../../etc/passwd', 'abc?x=1', 'abc#frag', '%2e%2e'])('rejects a non-UUID uid %s without calling the service', async (uid) => {
      const { req, res, next } = buildReqRes(uid);

      await controller.getSurveyById(req, res, next);

      expect(surveySvc.getSurveyById).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    });

    it('passes a valid UUID uid through to the service', async () => {
      const survey = { uid: VALID_UID, survey_title: 'Survey' };
      surveySvc.getSurveyById.mockResolvedValue(survey);
      const { req, res, next } = buildReqRes(VALID_UID);

      await controller.getSurveyById(req, res, next);

      expect(surveySvc.getSurveyById).toHaveBeenCalledWith(req, VALID_UID, undefined, true);
      expect(res.json).toHaveBeenCalledWith(survey);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('getSurveyResponses', () => {
    it.each(['../../etc/passwd', 'abc?x=1', 'abc#frag', '%2e%2e'])('rejects a non-UUID uid %s without calling the service', async (uid) => {
      const { req, res, next } = buildReqRes(uid);

      await controller.getSurveyResponses(req, res, next);

      expect(surveySvc.getSurveyResponses).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    });

    it('passes a valid UUID uid through to the service', async () => {
      const page = { data: [] };
      surveySvc.getSurveyResponses.mockResolvedValue(page);
      const { req, res, next } = buildReqRes(VALID_UID);

      await controller.getSurveyResponses(req, res, next);

      expect(surveySvc.getSurveyResponses).toHaveBeenCalledWith(req, VALID_UID, req.query);
      expect(res.json).toHaveBeenCalledWith(page);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('deleteSurvey', () => {
    it.each(['../../etc/passwd', 'abc?x=1', 'abc#frag', '%2e%2e'])('rejects a non-UUID uid %s without calling the service', async (uid) => {
      const { req, res, next } = buildReqRes(uid);

      await controller.deleteSurvey(req, res, next);

      expect(surveySvc.deleteSurvey).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    });

    it('passes a valid UUID uid through to the service', async () => {
      surveySvc.deleteSurvey.mockResolvedValue(undefined);
      const { req, res, next } = buildReqRes(VALID_UID);

      await controller.deleteSurvey(req, res, next);

      expect(surveySvc.deleteSurvey).toHaveBeenCalledWith(req, VALID_UID);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

describe('SurveyController follow-up actions (#4340)', () => {
  const RESPONSE_UID = '22222222-2222-2222-2222-222222222222';
  const COMMITTEE_UID = '33333333-3333-3333-3333-333333333333';
  let controller: SurveyController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SurveyController();
  });

  describe('sendSurveyReminders', () => {
    it.each([[undefined], [[]], [['not-a-uuid']], [[RESPONSE_UID, 42]]])('rejects recipient_ids %j without calling the service', async (ids) => {
      const { req, res, next } = buildReqRes(VALID_UID);
      req.body = { recipient_ids: ids };

      await controller.sendSurveyReminders(req, res, next);

      expect(surveySvc.sendSurveyReminders).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    });

    it('rejects a non-UUID survey uid', async () => {
      const { req, res, next } = buildReqRes('../x');
      req.body = { recipient_ids: [RESPONSE_UID] };

      await controller.sendSurveyReminders(req, res, next);

      expect(surveySvc.sendSurveyReminders).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    });

    it('sends to the deduplicated response ids', async () => {
      surveySvc.sendSurveyReminders.mockResolvedValue({ recipient_count: 1 });
      const { req, res, next } = buildReqRes(VALID_UID);
      req.body = { recipient_ids: [RESPONSE_UID, RESPONSE_UID] };

      await controller.sendSurveyReminders(req, res, next);

      expect(surveySvc.sendSurveyReminders).toHaveBeenCalledWith(req, VALID_UID, [RESPONSE_UID]);
      expect(res.json).toHaveBeenCalledWith({ recipient_count: 1 });
    });
  });

  describe('getResyncPreview / resyncRecipients', () => {
    it('rejects a non-UUID committee_uid', async () => {
      const { req, res, next } = buildReqRes(VALID_UID);
      req.query = { committee_uid: 'abc' };

      await controller.resyncRecipients(req, res, next);

      expect(surveySvc.resyncRecipients).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    });

    it('passes the committee scope through and answers 204', async () => {
      surveySvc.resyncRecipients.mockResolvedValue(undefined);
      const { req, res, next } = buildReqRes(VALID_UID);
      req.query = { committee_uid: COMMITTEE_UID };

      await controller.resyncRecipients(req, res, next);

      expect(surveySvc.resyncRecipients).toHaveBeenCalledWith(req, VALID_UID, COMMITTEE_UID);
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('previews the whole survey when no committee is given', async () => {
      const preview = { affected_recipients: [], affected_committees: [] };
      surveySvc.getResyncPreview.mockResolvedValue(preview);
      const { req, res, next } = buildReqRes(VALID_UID);

      await controller.getResyncPreview(req, res, next);

      expect(surveySvc.getResyncPreview).toHaveBeenCalledWith(req, VALID_UID, undefined);
      expect(res.json).toHaveBeenCalledWith(preview);
    });
  });
});
