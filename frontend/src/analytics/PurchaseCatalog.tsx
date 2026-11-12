import type { Purchase, PurchaseAnalytics } from '@bnect/shared';
import { dateLabel, money, numeric } from './format';
import { Icon } from '../ui';

interface PurchaseColumn {
  key: string;
  label: string;
  render: (purchase: Purchase) => string;
}

const COLUMNS: PurchaseColumn[] = [
  { key: 'number', label: 'Номер', render: (purchase) => purchase.number },
  { key: 'date', label: 'Дата', render: (purchase) => dateLabel(purchase.date) },
  { key: 'title', label: 'Наименование', render: (purchase) => purchase.title },
  {
    key: 'product',
    label: 'Товар / код',
    render: (purchase) => [purchase.product, purchase.code].filter(Boolean).join(' · ') || '—',
  },
  { key: 'region', label: 'Регион', render: (purchase) => purchase.region ?? '—' },
  { key: 'quantity', label: 'Количество', render: (purchase) => numeric(purchase.quantity) },
  { key: 'unit', label: 'Единица', render: (purchase) => purchase.unit ?? '—' },
  {
    key: 'unitPrice',
    label: 'Цена за единицу',
    render: (purchase) =>
      money(purchase.unitPrice, purchase.currency) + (purchase.priceDerived ? ' *' : ''),
  },
  {
    key: 'amount',
    label: 'Сумма',
    render: (purchase) =>
      money(purchase.amount, purchase.currency) +
      (purchase.amountVat ? ` (${purchase.amountVat})` : ''),
  },
];

interface PurchaseCatalogProps {
  data: PurchaseAnalytics;
  fields: string[];
  totalRecords: number;
  onChoose: (purchase: Purchase) => void;
  onClearSelection: () => void;
  onPageChange: (page: number) => void;
}

export default function PurchaseCatalog({
  data,
  fields,
  totalRecords,
  onChoose,
  onClearSelection,
  onPageChange,
}: PurchaseCatalogProps) {
  const visibleColumns = COLUMNS.filter(
    ({ key }) =>
      fields.includes(key) ||
      key === 'number' ||
      key === 'title' ||
      (key === 'product' && fields.includes('code')),
  );

  return (
    <section className="panel purchase-catalog">
      <div className="purchase-catalog-heading">
        <div>
          <h2>Каталог закупок</h2>
          <p className="subtitle">
            Найдено: {numeric(data.total, 0)}. Выберите закупку для сравнения.
          </p>
        </div>
        {data.selected && (
          <button className="btn sm" onClick={onClearSelection}>
            Снять выбор
          </button>
        )}
      </div>
      {data.items.length ? (
        <>
          <div className="purchase-table-scroll">
            <table className="purchase-table">
              <thead>
                <tr>
                  {visibleColumns.map(({ key, label }) => (
                    <th key={key} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((purchase) => (
                  <tr
                    key={purchase.id}
                    className={data.selected?.id === purchase.id ? 'selected' : ''}
                    onClick={() => onChoose(purchase)}
                  >
                    {visibleColumns.map(({ key, render }) => (
                      <td key={key} className={`purchase-cell-${key}`}>
                        {key === 'number' ? (
                          <button
                            className="purchase-select"
                            aria-pressed={data.selected?.id === purchase.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onChoose(purchase);
                            }}
                          >
                            № {purchase.number}
                          </button>
                        ) : (
                          <span>{render(purchase)}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="purchase-pagination">
            <span>
              Страница {data.page} из {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <div className="button-row">
              <button
                className="btn sm"
                disabled={data.page <= 1}
                onClick={() => onPageChange(data.page - 1)}
              >
                Назад
              </button>
              <button
                className="btn sm"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => onPageChange(data.page + 1)}
              >
                Далее
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="purchase-empty">
          <div className="purchase-empty-icon" aria-hidden="true">
            <Icon name="briefcase" size={24} />
          </div>
          <h2>{totalRecords ? 'Закупки не найдены' : 'Добавьте Excel с закупками'}</h2>
          <p>
            {totalRecords
              ? 'Измените поиск или фильтры. Для записей без даты выберите весь период.'
              : 'После импорта здесь появятся закупки, цены за единицу и сравнение по выбранному региону.'}
          </p>
          {!totalRecords && (
            <p className="small muted">Цены появятся после загрузки исходных данных.</p>
          )}
        </div>
      )}
    </section>
  );
}
