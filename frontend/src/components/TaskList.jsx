
const STATUS_LABEL = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done'
};

export default function TaskList({ tasks, highlightId }) {
  if (!tasks.length) {
    return <p className="task-list__empty">No tasks logged yet. Try creating one by voice.</p>;
  }

  return (
    <ul className="task-list">
      {tasks.map(task => (
        <li
          key={task.id}
          className={`task-row ${task.id === highlightId ? 'task-row--highlight' : ''}`}
        >
          <span className={`status-chip status-chip--${task.status}`}>
            {STATUS_LABEL[task.status] || task.status}
          </span>
          <div className="task-row__body">
            <p className="task-row__desc">{task.description}</p>
            <p className="task-row__meta">
              {task.location ? `${task.location} · ` : ''}
              {task.project_name}
              {task.assignee_name ? ` · ${task.assignee_name}` : ' · Unassigned'}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
