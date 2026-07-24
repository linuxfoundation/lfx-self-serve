// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { CreatePickerController } from '../controllers/create-picker.controller';

const router = Router();

const createPickerController = new CreatePickerController();

router.get('/tree', (req, res, next) => createPickerController.getTree(req, res, next));
router.get('/tree/children', (req, res, next) => createPickerController.getChildren(req, res, next));
router.get('/search', (req, res, next) => createPickerController.search(req, res, next));

export default router;
