import { Router } from 'express';
import { createTaskController } from '../controllers/task.controller.js';
import { validate } from '../middleware/validate.js';
import { createTaskSchema, taskIdParamsSchema } from '../validation/task.schemas.js';

export function createTaskRouter(taskService) {
  const router = Router();
  const controller = createTaskController(taskService);

  router.post('/', validate({ body: createTaskSchema }), controller.create);
  router.get('/', controller.list);
  router.get('/:id', validate({ params: taskIdParamsSchema }), controller.getById);

  return router;
}
