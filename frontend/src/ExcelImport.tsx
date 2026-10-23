import { useState } from 'react';
import { Notice } from './ui';
interface Report {
  errors: { row: number; field: string; message: string }[];
  duplicates: unknown[];
  totalRows: number;
  validRows?: number;
  imported: boolean;
  sheetName?: string;
  indexError?: string;
  changes?: { inserted: number; updated: number; unchanged: number };
}
export default function ExcelImport({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  async function run(dryRun: boolean) {
    if (!file) return;
    setError('');
    setBusy(dryRun ? 'Проверяем строки Excel…' : 'Сохраняем тендеры и вычисляем embeddings…');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Максимальный размер файла — 5 МБ.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const response = await fetch('/api/imports/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, dataBase64: btoa(binary), dryRun }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Не удалось загрузить файл.');
      setReport(result);
      if (result.imported) onImported();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Сервис недоступен');
    } finally {
      setBusy('');
    }
  }
  async function retryIndex() {
    setBusy('Вычисляем embeddings…');
    setError('');
    try {
      const response = await fetch('/api/index', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setReport((previous) => (previous ? { ...previous, indexError: undefined } : null));
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка индексации');
    } finally {
      setBusy('');
    }
  }
  return (
    <details className="panel import-panel">
      <summary>Загрузить тендеры из Excel</summary>
      <div className="import-body">
        <p>Формат .xlsx, первый лист, до 2000 строк и 5 МБ. Первая строка — заголовки:</p>
        <p className="small">
          № тендера · Наименование тендера · Регион · Дата создания · Сфера (группа) · Сфера
          деятельности · Способ закупки · Вид закупки
        </p>
        <p className="small">
          Даты: ДД.ММ.ГГГГ, ГГГГ-ММ-ДД или ячейки Excel с датой. Номер тендера лучше хранить как
          текст.
        </p>
        <label className="field">
          <span>Excel-файл с тендерами</span>
          <input
            type="file"
            accept=".xlsx"
            disabled={!!busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setReport(null);
              setError('');
            }}
          />
        </label>
        <div className="button-row">
          <button className="btn" disabled={!file || !!busy} onClick={() => run(true)}>
            Проверить файл
          </button>
          {report && !report.errors.length && !report.imported && (
            <button className="btn primary" disabled={!!busy} onClick={() => run(false)}>
              Импортировать тендеры
            </button>
          )}
        </div>
        {busy && <p role="status">{busy} Первый запуск модели может занять время.</p>}
        {error && <p role="alert">{error}</p>}
        {report && (
          <div aria-live="polite">
            <p>
              {report.imported ? 'Импорт завершён' : 'Результат проверки'}: строк {report.totalRows}
              , ошибок {report.errors.length}, повторов номера {report.duplicates.length}.
            </p>
            {report.changes && (
              <p>
                Новых: {report.changes.inserted}; обновлений: {report.changes.updated}; без
                изменений: {report.changes.unchanged}.
              </p>
            )}
            {report.errors.length > 0 && (
              <Notice kind="error">Файл не импортирован. Исправьте ошибки.</Notice>
            )}
            {report.errors.slice(0, 50).map((item, i) => (
              <p className="small" key={i}>
                Строка {item.row}, {item.field}: {item.message}
              </p>
            ))}
            {report.duplicates.length > 0 && (
              <p className="small">
                Для повторяющегося номера используется последняя корректная строка.
              </p>
            )}
            {report.indexError && (
              <Notice kind="warning">
                Тендеры сохранены, но поиск ждёт индексации: {report.indexError}
                <button className="btn" disabled={!!busy} onClick={retryIndex}>
                  Повторить индексацию
                </button>
              </Notice>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
