import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Catalog, Tender } from '@bnect/shared';
import { api, errorMessage } from './api';
import CatalogPanel from './CatalogPanel';
import TenderDrawer from './TenderDrawer';
import { Loading, Notice } from './ui';
import TenderMap from './TenderMap';
import PurchaseAnalyticsPage from './analytics/PurchaseAnalyticsPage';
import { useTenderImportStatus } from './hooks/useTenderImportStatus';
import WorkspaceLayout, { NAVIGATION, type Tab } from './WorkspaceLayout';

const IntegrationReport = lazy(() => import('./report/IntegrationReport'));
const ModelPage = lazy(() => import('./model/ModelPage'));

function currentTab(): Tab {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('report-')) return 'report';
  return NAVIGATION.find(([id]) => id === hash)?.[0] ?? 'catalog';
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [tab, setTab] = useState<Tab>(currentTab);
  const [mapTenderId, setMapTenderId] = useState<string>();
  const handleImportReady = useCallback(() => {
    setAttempt((value) => value + 1);
    setMapTenderId(undefined);
  }, []);
  const importStatus = useTenderImportStatus(handleImportReady);
  const openTender = (tender: Tender) => {
    setSelectedTender(tender);
    setMapTenderId(tender.id);
  };
  const closeTender = useCallback(() => setSelectedTender(null), []);

  useEffect(() => {
    const update = () => setTab(currentTab());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

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
    <WorkspaceLayout
      tab={tab}
      onNavigate={(id) => {
        setTab(id);
        window.location.hash = id;
      }}
    >
      {tab !== 'analytics' &&
        tab !== 'report' &&
        tab !== 'model' &&
        importStatus &&
        !['waiting', 'ready'].includes(importStatus.stage) && (
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
            <span className="eyebrow">Каталог тендеров</span>
            <h1>Закупки</h1>
            <p className="subtitle">Выберите тендер для просмотра похожих закупок.</p>
          </div>
        </div>
      )}
      {tab === 'model' ? (
        <Suspense fallback={<Loading text="Открываем описание модели…" />}>
          <ModelPage />
        </Suspense>
      ) : tab === 'report' ? (
        <Suspense fallback={<Loading text="Открываем план внедрения…" />}>
          <IntegrationReport />
        </Suspense>
      ) : tab === 'analytics' ? (
        <PurchaseAnalyticsPage />
      ) : error ? (
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
            <CatalogPanel key={attempt} catalog={catalog} onOpen={openTender} />
          )}
          {tab === 'map' && (
            <TenderMap key={attempt} catalog={catalog} tenderId={mapTenderId} onOpen={openTender} />
          )}
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
    </WorkspaceLayout>
  );
}
