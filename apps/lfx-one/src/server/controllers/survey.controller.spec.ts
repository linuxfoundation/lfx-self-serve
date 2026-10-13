// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_UID = '11111111-1111-1111-1111-111111111111';

// Hoisted, per-test-controllable mocks. The `@lfx-one/shared/*` path alias isn't wired
// into vitest (see vitest.config.ts), so the shared barrels the controller imports at
// module load are stubbed here.
const { isUuidMock, surveySvc } = vi.hoisted(() => ({
  isUuidMock: vi.fn(),
  surveySvc: {
    getSurveyById: vi.fn(),
    getSurveyResponses: vi.fn(),
    deleteSurvey: vi.fn(),
  },
}));

vi.mock('@lfx-one/shared/utils', () => ({
  isUuid: isUuidMock,
}));
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
    isUuidMock.mockImplementation((value: string) => value === VALID_UID);
    controller = new SurveyController();
  });

  describe('getSurveyById', () => {
    it('rejects a non-UUID uid without calling the service', async () => {
      const { req, res, next } = buildReqRes('../../etc/passwd');

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
    it('rejects a non-UUID uid without calling the service', async () => {
      const { req, res, next } = buildReqRes('../../etc/passwd');

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
    it('rejects a non-UUID uid without calling the service', async () => {
      const { req, res, next } = buildReqRes('../../etc/passwd');

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
