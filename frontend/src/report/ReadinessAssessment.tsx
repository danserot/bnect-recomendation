import { useEffect, useState } from 'react';
import type { PurchaseReadiness } from '@bnect/shared';
import { api, errorMessage } from '../api';
import { dateLabel, numeric } from '../analytics/format';

export default function ReadinessAssessment() {
  const [data, setData] = useState<PurchaseReadiness | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    api
      .purchaseReadiness(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(errorMessage(problem));
      });
    return () => controller.abort();
  }, [attempt]);
  if (error)
    return (
      <div className="integration-data-error" role="alert">
        <p>{error}</p>
        <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
          Повторить оценку
        </button>
      </div>
    );
  if (!data)
    return (
      <p className="integration-loading" role="status">
        Проверяем данные…
      </p>
    );
  const percent = (part: number, total: number) =>
    total ? `${numeric((part / total) * 100, 1)}%` : '—';
  return (
    <div className="integration-readiness">
      <div className="integration-readiness-top">
        <p>
          В каталоге: <strong>{numeric(data.totalRows, 0)}</strong> строк.
        </p>
        <button className="btn sm" onClick={() => setAttempt((a) => a + 1)}>
          Обновить оценку
        </button>
      </div>
      <div className="integration-readiness-grid">
        <div>
          <span>Есть другие документы для средней</span>
          <strong>{percent(data.rowsWithAnalogs, data.eligibleRows)}</strong>
          <p>
            {numeric(data.rowsWithAnalogs, 0)} из {numeric(data.eligibleRows, 0)} сопоставимых
            строк. Все даты.
          </p>
        </div>
        <div>
          <span>Есть полный график за 6 месяцев</span>
          <strong>{percent(data.completeChartRows, data.periodRows)}</strong>
          <p>
            {numeric(data.completeChartRows, 0)} из {numeric(data.periodRows, 0)} строк периода.
            Заполнены все {data.expectedIntervals} интервалов.
          </p>
        </div>
      </div>
      <p>
        График: {dateLabel(data.period.from)} — {dateLabel(data.period.to)}, основной регион строки,
        без поиска и дополнительной группы. Выбранный документ исключён.
      </p>
      <p>
        Без даты: {numeric(data.missingDateRows, 0)} строк; без корректной цены:{' '}
        {numeric(data.missingPriceRows, 0)}. Наличие расчёта не означает достаточную статистику.
      </p>
      <small>
        Обновлено:{' '}
        {new Intl.DateTimeFormat('ru-RU', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Qyzylorda',
        }).format(new Date(data.generatedAt))}
        .
      </small>
    </div>
  );
}
