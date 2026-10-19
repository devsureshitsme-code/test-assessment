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
  };
}
