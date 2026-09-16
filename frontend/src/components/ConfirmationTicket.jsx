export default function ConfirmationTicket({ summary, onConfirm, onCancel, pending }) {
  return (
    <div className="ticket">
      <div className="ticket__label">Confirm before I do this</div>
      <p className="ticket__summary">{summary}</p>
      <p className="ticket__voice-hint">Say “confirm” or “cancel” — or tap a button below.</p>
      <div className="ticket__actions">
        <button className="btn btn--primary" onClick={onConfirm} disabled={pending}>
          {pending ? 'Working…' : 'Confirm'}
        </button>
        <button className="btn btn--ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}
