export default function MicButton({ mode, disabled, onClick }) {
  const isOn = mode !== 'off';
  const isActive = mode === 'awaiting_command' || mode === 'confirming';
  const isProcessing = mode === 'processing';

  const classNames = [
    'mic-button',
    isOn && 'mic-button--on',
    isActive && 'mic-button--active',
    isProcessing && 'mic-button--processing'
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classNames}
      onClick={onClick}
      disabled={disabled}
      aria-label={isOn ? 'Turn off always-listening mode' : 'Turn on always-listening mode'}
    >
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
        <path
          d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M6 11a6 6 0 0 0 12 0M12 19v2.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      {isOn && !isProcessing && (
        <>
          <span className="mic-pulse" />
          <span className="mic-pulse mic-pulse--delay" />
        </>
      )}
    </button>
  );
}
