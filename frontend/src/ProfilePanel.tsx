import { useState } from 'react';
import type { Catalog, SupplierProfile } from '@bnect/shared';
import { api, errorMessage } from './api';
import { Icon, Notice } from './ui';

export function validateProfile(profile: SupplierProfile) {
  if (profile.name.trim().length < 2) return 'Укажите название компании: минимум 2 символа.';
  if (profile.specializationDescription.trim().length < 10)
    return 'Опишите специализацию компании: минимум 10 символов.';
  return '';
}
function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
export function ProfilePanel({
  profiles,
  profile,
  catalog,
  onChange,
  onSelect,
  onSaved,
  onRecommend,
  loading,
  invalidReason,
}: {
  profiles: SupplierProfile[];
  profile: SupplierProfile;
  catalog: Catalog;
  onChange: (value: SupplierProfile) => void;
  onSelect: (id: string) => void;
  onSaved: (value: SupplierProfile) => void;
  onRecommend: () => void;
  loading: boolean;
  invalidReason: string;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const original = profiles.find((item) => item.id === profile.id);
  const dirty = JSON.stringify(profile) !== JSON.stringify(original);
  const update = (patch: Partial<SupplierProfile>) => {
    if (saving) return;
    onChange({ ...profile, ...patch });
    setMessage(null);
  };
  async function save() {
    if (saving) return;
    const error = validateProfile(profile);
    if (error) {
      setMessage({ error: true, text: error });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api.saveSupplier(profile);
      onSaved(saved);
      setMessage({ error: false, text: 'Профиль сохранён в базе данных.' });
    } catch (error) {
      setMessage({ error: true, text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }
  const options = (
    legend: string,
    values: string[],
    selected: string[],
    key: 'industryGroups' | 'activities' | 'serviceRegionIds' | 'procurementTypes',
    names?: Record<string, string>,
  ) => (
    <fieldset disabled={saving}>
      <legend>{legend}</legend>
      <div className="option-grid">
        {values.map((value) => (
          <label className="check-label" key={value}>
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => update({ [key]: toggle(selected, value) })}
            />
            {names?.[value] ?? value}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <>
      <section className="panel panel-pad" aria-labelledby="profile-heading">
        <div className="profile-top">
          <div className="profile-icon">
            <Icon name="building" size={21} />
          </div>
          <div>
            <h2 id="profile-heading">Профиль поставщика</h2>
            <span className="small muted">Основа для рекомендаций</span>
          </div>
        </div>
        <label className="field">
          <span>Демонстрационная компания</span>
          <select
            className="control"
            value={profile.id}
            disabled={saving}
            onChange={(event) => {
              onSelect(event.target.value);
              setMessage(null);
            }}
          >
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {!editing && (
          <>
            <p className="profile-description">{profile.specializationDescription}</p>
            <div className="profile-summary">
              <div>
                <div className="meta-label">Специализация</div>
                <div className="chips">
                  {profile.industryGroups.map((group) => (
                    <span className="chip" key={group}>
                      {group}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="meta-label">География работы</div>
                <div className="chips">
                  {profile.serviceRegionIds.map((id) => (
                    <span className="chip" key={id}>
                      {catalog.regions.find((item) => item.id === id)?.name ?? id}
                    </span>
                  ))}
                  {!profile.serviceRegionIds.length && (
                    <span className="small muted">Не указана</span>
                  )}
                </div>
              </div>
            </div>
            <hr className="divider" />
          </>
        )}
        <button
          className="edit-link"
          disabled={saving}
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
        >
          <Icon name={editing ? 'close' : 'edit'} size={13} />
          {editing ? 'Свернуть редактирование' : 'Редактировать профиль'}
        </button>
        {editing && (
          <div className="profile-editor">
            <label className="field">
              <span>Название компании</span>
              <input
                className="control"
                disabled={saving}
                maxLength={200}
                value={profile.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Что компания поставляет или выполняет</span>
              <textarea
                className="control"
                disabled={saving}
                maxLength={5000}
                value={profile.specializationDescription}
                onChange={(event) => update({ specializationDescription: event.target.value })}
              />
            </label>
            {options('Сферы', catalog.industryGroups, profile.industryGroups, 'industryGroups')}
            {options('Сферы деятельности', catalog.activities, profile.activities, 'activities')}
            {options(
              'Регионы работы',
              catalog.regions.map((item) => item.id),
              profile.serviceRegionIds,
              'serviceRegionIds',
              Object.fromEntries(catalog.regions.map((item) => [item.id, item.name])),
            )}
            {options(
              'Виды закупок',
              catalog.procurementTypes,
              profile.procurementTypes,
              'procurementTypes',
            )}
            <button className="btn subtle full" onClick={save} disabled={saving || !dirty}>
              <Icon name="check" size={14} />
              {saving ? 'Сохраняем…' : 'Сохранить профиль'}
            </button>
          </div>
        )}
        {dirty && (
          <p className="dirty-hint">
            Черновик сохранён в этом браузере. Подбор использует текущие поля формы. Для записи в БД
            нажмите «Сохранить профиль».
          </p>
        )}
        {message && (
          <div role="status" className={`status-message ${message.error ? 'error' : 'success'}`}>
            {message.text}
          </div>
        )}
        <button
          className="btn primary full"
          style={{ marginTop: 20 }}
          disabled={loading || !!invalidReason || saving}
          onClick={onRecommend}
        >
          <Icon name="sparkle" size={16} />
          {loading ? 'Подбираем закупки…' : 'Подобрать закупки'}
          {!loading && <Icon name="arrow" size={15} />}
        </button>
        {invalidReason && (
          <p className="region-error" role="status">
            {invalidReason}
          </p>
        )}
      </section>
      <Notice>
        Рекомендации учитывают специализацию и географию. Лицензии, квалификация и остальные условия
        допуска не проверяются.
      </Notice>
      <div className="aside-note">
        <p className="small">
          Демо-профили — отдельные синтетические данные. Подключение реальной базы поставщиков
          предусмотрено через адаптер и ещё не выполнено.
        </p>
      </div>
    </>
  );
}
