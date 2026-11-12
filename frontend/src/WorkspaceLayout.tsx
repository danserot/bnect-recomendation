import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui';
import './workspace-layout.css';

export const NAVIGATION = [
  ['catalog', 'Закупки', 'briefcase'],
  ['analytics', 'Аналитика', 'chart'],
  ['map', 'Карта векторов', 'network'],
  ['model', 'Модель и тесты', 'layers'],
  ['report', 'Внедрение', 'file'],
] as const;

export type Tab = (typeof NAVIGATION)[number][0];

export default function WorkspaceLayout({
  tab,
  onNavigate,
  children,
}: {
  tab: Tab;
  onNavigate: (tab: Tab) => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const content = useRef<HTMLElement>(null);
  const activeLabel = NAVIGATION.find(([id]) => id === tab)?.[1];

  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#workspace-content"
        onClick={(event) => {
          event.preventDefault();
          content.current?.focus();
        }}
      >
        Перейти к содержимому
      </a>
      <aside className="workspace-sidebar" aria-label="Рабочее пространство">
        <div className="workspace-brand">
          <span className="workspace-brand-symbol" aria-hidden="true">
            <Icon name="layers" size={23} />
          </span>
          <span className="workspace-wordmark">
            bnect<span>.</span>
          </span>
          <button
            className="icon-button workspace-menu-toggle"
            aria-label={menuOpen ? 'Закрыть меню разделов' : 'Открыть меню разделов'}
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} size={21} />
          </button>
        </div>
        <div
          className={`workspace-navigation ${menuOpen ? 'is-open' : ''}`}
          id="workspace-navigation"
        >
          <p className="workspace-nav-label">Рабочее пространство</p>
          <nav aria-label="Основные разделы">
            {NAVIGATION.map(([id, label, icon], index) => (
              <button
                className={`workspace-nav-item ${tab === id ? 'active' : ''} ${index === 3 ? 'workspace-nav-secondary' : ''}`}
                key={id}
                onClick={() => {
                  onNavigate(id);
                  setMenuOpen(false);
                }}
                aria-current={tab === id ? 'page' : undefined}
              >
                <Icon name={icon} size={19} />
                <span>{label}</span>
                {tab === id && <span className="workspace-active-dot" aria-hidden="true" />}
              </button>
            ))}
          </nav>
        </div>
        <div className="workspace-sidebar-foot">
          <Icon name="briefcase" size={17} />
          <span>Закупки и аналитика</span>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <div className="workspace-breadcrumb">
            <span>Рабочее пространство</span>
            <Icon name="chevron" size={13} />
            <strong>{activeLabel}</strong>
          </div>
          <span className="workspace-context">
            <Icon name="layers" size={15} /> Обзор закупок
          </span>
        </header>
        <main
          ref={content}
          id="workspace-content"
          tabIndex={-1}
          className={`main ${tab === 'report' ? 'report-main' : tab === 'analytics' ? 'analytics-main' : ''}`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
