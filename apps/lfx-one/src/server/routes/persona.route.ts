// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { PersonaController } from '../controllers/persona.controller';

const router = Router();
const personaController = new PersonaController();

router.get('/personas', (req, res, next) => personaController.getUserPersonas(req, res, next));

export default router;
