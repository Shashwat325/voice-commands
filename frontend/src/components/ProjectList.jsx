export default function ProjectList({ projects, tasks }) {
  if (!projects.length) {
    return <p className="task-list__empty">No projects on file.</p>;
  }

  return (
    <ul className="task-list">
      {projects.map(p => {
        const theirTasks = tasks.filter(t => t.project_id === p.id);
        const open = theirTasks.filter(t => t.status === 'open').length;
        const inProgress = theirTasks.filter(t => t.status === 'in_progress').length;
        const done = theirTasks.filter(t => t.status === 'done').length;

        return (
          <li key={p.id} className="task-row">
            <span className="status-chip status-chip--open">{theirTasks.length}</span>
            <div className="task-row__body">
              <p className="task-row__desc">{p.name}</p>
              <p className="task-row__meta">
                {theirTasks.length === 0
                  ? 'No tasks logged yet'
                  : `${open} open · ${inProgress} in progress · ${done} done`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
