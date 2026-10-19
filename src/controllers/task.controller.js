export function createTaskController(taskService) {
  return {
    create(req, res) {
      const task = taskService.create(req.validated.body);
      res.status(201).location(`${req.baseUrl}/${task.id}`).json({ data: task });
    },

    list(_req, res) {
      res.json({ data: taskService.list() });
    },

    getById(req, res) {
      const task = taskService.getById(req.validated.params.id);
      res.json({ data: task });
    },

    update(req, res) {
      const task = taskService.update(req.validated.params.id, req.validated.body);
      res.json({ data: task });
    },

    updateStatus(req, res) {
      const task = taskService.updateStatus(req.validated.params.id, req.validated.body.status);
      res.json({ data: task });
    },
  };
}
