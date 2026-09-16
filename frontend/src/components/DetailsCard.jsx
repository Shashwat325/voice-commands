export default function DetailsCard({ title, subtitle, stats, tasks, note, images }) {
  return (
    <div className="details-card">
      <p className="details-card__title">{title}</p>
      {subtitle && <p className="details-card__subtitle">{subtitle}</p>}

      {images && images.length > 0 && (
        <div className="details-card__gallery" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 12 }}>
          {images.map(img => (
            <figure key={img.id} style={{ margin: 0, flex: '0 0 auto' }}>
              <img src={img.url} alt={img.label || title} style={{ width: 140, height: 100, objectFit: 'cover', borderRadius: 6 }} />
              {img.label && <figcaption style={{ fontSize: 12, textAlign: 'center' }}>{img.label}</figcaption>}
            </figure>
          ))}
        </div>
      )}

      <div className="details-card__stats">
        {stats.map(s => (
          <div key={s.label} className="details-card__stat">
            <span className="details-card__stat-value">{s.value}</span>
            <span className="details-card__stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {note && <p className="details-card__note">{note}</p>}

      {tasks && tasks.length > 0 && (
        <ul className="details-card__tasklist">
          {tasks.map(t => (
            <li key={t.id}>
              <span>{t.description}</span>
              <span className={`status-chip status-chip--${t.status}`}>{t.status.replace('_', ' ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}