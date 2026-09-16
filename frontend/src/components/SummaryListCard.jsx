export default function SummaryListCard({ title, items }) {
  return (
    <div className="details-card">
      <p className="details-card__title">{title}</p>
      <ul className="task-list">
        {items.map(item => (
          <li key={item.title} className="task-row">
            <span className="status-chip status-chip--in_progress">{item.subtitle}</span>
            <div className="task-row__body">
              <p className="task-row__desc">{item.title}</p>
              <p className="task-row__meta">{item.meta}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
