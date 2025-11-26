// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { UserController } from '../controllers/user.controller';

const router = Router();
const userController = new UserController();

// GET /api/user/pending-actions - Get all pending actions for the authenticated user
router.get('/pending-actions', (req, res, next) => userController.getPendingActions(req, res, next));

export default router;
