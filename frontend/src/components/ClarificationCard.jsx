export default function ClarificationCard({ message, candidates }) {
  return (
    <div className="clarify">
      <div className="clarify__label">Need a bit more</div>
      <p className="clarify__message">{message}</p>
      {candidates && candidates.length > 0 && (
        <ul className="clarify__list">
          {candidates.map(c => (
            <li key={c.id}>{c.name || c.description}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
