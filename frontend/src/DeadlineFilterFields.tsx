import { useId } from 'react';

export default function DeadlineFilterFields({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  const id = useId();
  const invalid = Boolean(from && to && from > to);
  return (
    <>
      <label className="field">
        <span>Срок подачи заявок: с</span>
        <input
          className="control"
          type="date"
          value={from}
          max={to || undefined}
          aria-invalid={invalid}
          aria-describedby={id}
          onChange={(event) => onFromChange(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Срок подачи заявок: по</span>
        <input
          className="control"
          type="date"
          value={to}
          min={from || undefined}
          aria-invalid={invalid}
          aria-describedby={id}
          onChange={(event) => onToChange(event.target.value)}
        />
      </label>
      <p
        id={id}
        className={`deadline-filter-note${invalid ? ' invalid' : ''}`}
        role={invalid ? 'alert' : undefined}
      >
        {invalid
          ? 'Дата «по» должна быть не раньше даты «с».'
          : 'Обе даты включены, время — UTC+5. При выборе периода закупки без срока подачи исключаются.'}
      </p>
    </>
  );
}
