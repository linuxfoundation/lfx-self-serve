// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { validateUidParameter, parseFormationIntakeBody, createFormation, getFormationByUid, logger } = vi.hoisted(() => ({
  validateUidParameter: vi.fn(),
  parseFormationIntakeBody: vi.fn(),
  createFormation: vi.fn(),
  getFormationByUid: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../helpers/validation.helper', () => ({ validateUidParameter }));
vi.mock('../helpers/formation-validation.helper', () => ({ parseFormationIntakeBody }));
vi.mock('../services/formation.service', () => ({
  FormationService: class {
    public createFormation = createFormation;
    public getFormationByUid = getFormationByUid;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));

import { FormationController } from './formation.controller';

function buildReq(overrides: Partial<Request> = {}): Request {
  return { params: {}, body: {}, path: '/api/formations', ...overrides } as unknown as Request;
}

function buildRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

describe('FormationController', () => {
  let controller: FormationController;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new FormationController();
    next = vi.fn();
    validateUidParameter.mockReturnValue(true);
  });

  describe('createFormation', () => {
    it('parses the body, creates the formation, and returns 201', async () => {
      const intake = { project_name: 'Example' };
      const formation = { uid: 'formation-1', project_uid: null };
      parseFormationIntakeBody.mockReturnValue(intake);
      createFormation.mockResolvedValue(formation);
      const res = buildRes();

      await controller.createFormation(buildReq(), res, next);

      expect(createFormation).toHaveBeenCalledWith(expect.anything(), intake);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(formation);
      expect(next).not.toHaveBeenCalled();
    });

    it('propagates a validation error via next without creating a formation', async () => {
      const validationError = new Error('project_name is required');
      parseFormationIntakeBody.mockImplementation(() => {
        throw validationError;
      });

      await controller.createFormation(buildReq(), buildRes(), next);

      expect(createFormation).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(validationError);
    });

    it('propagates a service error via next', async () => {
      parseFormationIntakeBody.mockReturnValue({});
      const upstreamError = new Error('unexpected');
      createFormation.mockRejectedValue(upstreamError);
      const res = buildRes();

      await controller.createFormation(buildReq(), res, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(upstreamError);
    });
  });

  describe('getFormationByUid', () => {
    it('returns the formation when found', async () => {
      const formation = { uid: 'formation-1', project_uid: null };
      getFormationByUid.mockResolvedValue(formation);
      const res = buildRes();

      await controller.getFormationByUid(buildReq({ params: { uid: 'formation-1' } }), res, next);

      expect(getFormationByUid).toHaveBeenCalledWith(expect.anything(), 'formation-1');
      expect(res.json).toHaveBeenCalledWith(formation);
    });

    it('returns 404 when the formation is not found — the ephemeral fixture store case', async () => {
      getFormationByUid.mockResolvedValue(null);
      const res = buildRes();

      await controller.getFormationByUid(buildReq({ params: { uid: 'unknown' } }), res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });

    it('stops after validateUidParameter returns false, without calling the service', async () => {
      validateUidParameter.mockReturnValue(false);

      await controller.getFormationByUid(buildReq(), buildRes(), next);

      expect(getFormationByUid).not.toHaveBeenCalled();
    });
  });
});
