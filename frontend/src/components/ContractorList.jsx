export default function ContractorList({ contractors, tasks }) {
  if (!contractors.length) {
    return <p className="task-list__empty">No contractors on file.</p>;
  }

  return (
    <ul className="task-list">
      {contractors.map(c => {
        const theirTasks = tasks.filter(t => t.assigned_to === c.id);
        const open = theirTasks.filter(t => t.status === 'open').length;
        const inProgress = theirTasks.filter(t => t.status === 'in_progress').length;
        const done = theirTasks.filter(t => t.status === 'done').length;

        return (
          <li key={c.id} className="task-row">
            <span className="status-chip status-chip--in_progress">{c.trade}</span>
            <div className="task-row__body">
              <p className="task-row__desc">{c.name}</p>
              <p className="task-row__meta">
                {theirTasks.length === 0
                  ? 'No tasks assigned yet'
                  : `${open} open · ${inProgress} in progress · ${done} done`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
