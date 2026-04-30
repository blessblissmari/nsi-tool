import { useMemo, useState } from 'react';
import { useStore } from '../store';

/**
 * Окно массовой обработки моделей.
 *
 * Показывает все модели в виде таблицы с фильтрами по статусам:
 *   — без класса
 *   — без хар-к
 *   — без ВВ
 *   — без техкарт
 *   — без проверки экспертом
 *   — с подсказками классификатора (нерешённые)
 *
 * Позволяет применять массовые действия только к видимому подмножеству.
 */
interface Props {
  onClose: () => void;
}

type FilterKey =
  | 'noClass'
  | 'noChars'
  | 'noActions'
  | 'noTechCards'
  | 'notVerified'
  | 'unresolved';

const FILTER_LABEL: Record<FilterKey, string> = {
  noClass: 'без класса',
  noChars: 'без хар-к',
  noActions: 'без ВВ',
  noTechCards: 'без техкарт',
  notVerified: 'не проверено экспертом',
  unresolved: 'требует ручной классификации',
};

export function BulkProcessing({ onClose }: Props) {
  const models = useStore((s) => s.models);
  const select = useStore((s) => s.selectModel);
  const normalizeAll = useStore((s) => s.normalizeAll);
  const classifyByClassifier = useStore((s) => s.classifyByClassifier);
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    noClass: false,
    noChars: false,
    noActions: false,
    noTechCards: false,
    notVerified: false,
    unresolved: false,
  });
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (filters.noClass && (m.className || m.subclassName)) return false;
      if (
        filters.noChars &&
        (m.characteristics ?? []).some((c) => !!c.valueRaw)
      )
        return false;
      if (filters.noActions && (m.actions ?? []).length > 0) return false;
      if (filters.noTechCards && (m.techCard ?? []).length > 0) return false;
      if (filters.notVerified && m.validity?.expertVerified) return false;
      if (filters.unresolved && m.classificationSource !== 'unresolved')
        return false;
      if (q) {
        const hay = [
          m.rawCode,
          m.normalizedCode,
          m.className ?? '',
          m.subclassName ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [models, filters, search]);

  const stat = useMemo(() => {
    const total = models.length;
    const noClass = models.filter((m) => !m.className).length;
    const noChars = models.filter(
      (m) => (m.characteristics ?? []).filter((c) => !!c.valueRaw).length === 0,
    ).length;
    const noActions = models.filter(
      (m) => (m.actions ?? []).length === 0,
    ).length;
    const noTechCards = models.filter(
      (m) => (m.techCard ?? []).length === 0,
    ).length;
    return { total, noClass, noChars, noActions, noTechCards };
  }, [models]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: 20,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: 'min(1100px, 96vw)',
          maxHeight: '92vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: 16,
        }}
      >
        <div className="row-flex" style={{ alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Массовая обработка моделей</h3>
          <span className="spacer" />
          <button onClick={onClose}>закрыть</button>
        </div>

        <div className="muted small">
          Всего {stat.total} · без класса {stat.noClass} · без хар-к{' '}
          {stat.noChars} · без ВВ {stat.noActions} · без техкарт{' '}
          {stat.noTechCards}
        </div>

        <div
          className="row-flex"
          style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
        >
          {(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => (
            <label
              key={k}
              className="small"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <input
                type="checkbox"
                checked={filters[k]}
                onChange={() =>
                  setFilters((f) => ({ ...f, [k]: !f[k] }))
                }
              />
              {FILTER_LABEL[k]}
            </label>
          ))}
          <span className="spacer" />
          <input
            type="search"
            placeholder="поиск по коду / классу"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220 }}
          />
        </div>

        <div className="row-flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button
            disabled={filtered.length === 0}
            title="Применить правила нормализации ко всем выбранным моделям."
            onClick={() => {
              const ids = new Set(filtered.map((m) => m.id));
              const r = normalizeAll(ids);
              setMsg(`Нормализовано: ${r.done} из ${filtered.length}`);
            }}
          >
            🪄 Нормализовать выбранное
          </button>
          <button
            disabled={filtered.length === 0}
            title="Классифицировать выбранные модели по классификатору."
            onClick={() => {
              const ids = new Set(filtered.map((m) => m.id));
              const r = classifyByClassifier(ids);
              setMsg(
                `Классифицировано: ${r.matched} из ${filtered.length}` +
                  (r.suggested ? `, подсказок: ${r.suggested}` : ''),
              );
            }}
          >
            🧭 Классифицировать выбранное
          </button>
          <span className="spacer" />
          <span className="muted small">
            Видно {filtered.length} из {stat.total}
          </span>
        </div>

        {msg && (
          <div
            className="muted small"
            style={{ background: 'var(--bg-alt)', padding: 6, borderRadius: 4 }}
          >
            {msg}
          </div>
        )}

        <table className="models" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 200 }}>Код</th>
              <th>Класс / Подкласс</th>
              <th style={{ width: 80 }}>Хар-к</th>
              <th style={{ width: 60 }}>ВВ</th>
              <th style={{ width: 70 }}>ТК</th>
              <th style={{ width: 80 }}>Источник</th>
              <th style={{ width: 80 }}>Проверено</th>
              <th style={{ width: 80 }}>Открыть</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((m) => {
              const charsCount = (m.characteristics ?? []).filter(
                (c) => !!c.valueRaw,
              ).length;
              return (
                <tr key={m.id}>
                  <td className="mono">{m.normalizedCode || m.rawCode}</td>
                  <td>
                    {m.className ? (
                      <>
                        {m.className}
                        {m.subclassName ? ` / ${m.subclassName}` : ''}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{charsCount}</td>
                  <td>{(m.actions ?? []).length}</td>
                  <td>{(m.techCard ?? []).length}</td>
                  <td className="muted small">
                    {m.classificationSource ?? '—'}
                  </td>
                  <td>
                    {m.validity?.expertVerified ? (
                      <span className="badge ok">да</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        select(m.id);
                        onClose();
                      }}
                    >
                      открыть →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div className="muted small">
            Показаны первые 500 строк. Уточните фильтры, чтобы увидеть остальные.
          </div>
        )}
      </div>
    </div>
  );
}
