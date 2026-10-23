import { useCallback, useEffect, useState } from 'react';
import type { Catalog, Tender } from '@bnect/shared';
import { api, errorMessage } from './api';
import CatalogPanel from './CatalogPanel';
import TenderDrawer from './TenderDrawer';
import { Loading, Notice } from './ui';
import TenderMap from './TenderMap';
import Description from './Description';

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [tab, setTab] = useState<'catalog' | 'map' | 'description'>('catalog');
  const [mapTenderId, setMapTenderId] = useState<string>();
  const [importStatus, setImportStatus] = useState<{
    stage: string;
    message: string;
    errors?: { row: number; field: string; message: string }[];
  } | null>(null);
  useEffect(() => {
    let alive = true;
    let completed = '';
    const poll = async () => {
      try {
        const response = await fetch('/api/import-status');
        if (!response.ok) return;
        const state = await response.json();
        if (!alive) return;
        setImportStatus(state);
        if (state.stage === 'ready' && state.updatedAt !== completed) {
          completed = state.updatedAt;
          setAttempt((v) => v + 1);
          setMapTenderId(undefined);
        }
      } catch {
        /* API may be restarting. */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const openTender = (tender: Tender) => {
    setSelectedTender(tender);
    setMapTenderId(tender.id);
  };
  const closeTender = useCallback(() => setSelectedTender(null), []);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api
      .catalog(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setCatalog(data);
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(errorMessage(problem));
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <div className="shell">
      <header className="topbar restored-header">
        <div className="topbar-inner">
          <button className="brand" onClick={closeTender} aria-label="Bnect — список закупок">
            bnect<span className="brand-dot">.</span>
          </button>
          <nav className="nav" aria-label="Основные разделы">
            {(
              [
                ['catalog', 'Закупки'],
                ['map', 'Векторное пространство'],
                ['description', 'Как это работает'],
              ] as const
            ).map(([id, label]) => (
              <button
                className={`nav-button ${tab === id ? 'active' : ''}`}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <span className="demo-badge">Прототип</span>
        </div>
      </header>
      <main className="main simple-main">
        {importStatus && importStatus.stage !== 'waiting' && (
          <div style={{ marginBottom: 18 }}>
            <Notice kind={importStatus.stage === 'error' ? 'error' : 'info'}>
              {importStatus.message}
              {importStatus.errors?.map((item, i) => (
                <div key={i}>
                  Строка {item.row}: {item.field} — {item.message}
                </div>
              ))}
            </Notice>
          </div>
        )}
        {tab === 'catalog' && (
          <div className="page-heading">
            <div>
              <h1>Закупки</h1>
              <p className="subtitle">
                Выберите тендер, чтобы увидеть сведения и пять похожих закупок.
              </p>
            </div>
          </div>
        )}
        {error ? (
          <section className="panel boot-error">
            <h2>Не удалось загрузить закупки</h2>
            <p>{error}</p>
            <button className="btn primary" onClick={() => setAttempt((value) => value + 1)}>
              Повторить
            </button>
          </section>
        ) : !catalog ? (
          <Loading text="Загружаем закупки…" />
        ) : (
          <>
            {tab === 'catalog' && (
              <>
                <CatalogPanel key={attempt} catalog={catalog} onOpen={openTender} />
              </>
            )}
            {tab === 'map' && (
              <TenderMap
                key={attempt}
                catalog={catalog}
                tenderId={mapTenderId}
                onOpen={openTender}
              />
            )}
            {tab === 'description' && <Description catalog={catalog} />}
            <div className="simple-demo-note">
              <Notice>
                Тендеры загружены из data/tenders.xlsx. Отсутствующие статусы, сроки и требования не
                достраиваются.
              </Notice>
            </div>
            {selectedTender && (
              <TenderDrawer
                tender={selectedTender}
                catalog={catalog}
                onClose={closeTender}
                onOpen={openTender}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
