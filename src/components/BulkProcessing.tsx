import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { aiProvider } from '../domain/ai';
import { getApiKey } from '../domain/openai';
import type { Characteristic, ClassDef, EquipmentModel } from '../domain/types';

const newId = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function priorityKeysFor(
  m: EquipmentModel,
  classes: ClassDef[],
): Array<{ key: string; unit?: string }> {
  const cls = classes.find((c) => c.name === m.className);
  const sub = cls?.subclasses.find((s) => s.name === m.subclassName);
  const keys: Array<{ key: string; unit?: string }> = [];
  for (const p of cls?.priorityChars ?? []) keys.push({ key: p.key, unit: p.unit });
  for (const p of sub?.priorityChars ?? []) {
    if (!keys.find((k) => k.key === p.key)) keys.push({ key: p.key, unit: p.unit });
  }
  return keys;
}

/**
 * Окно массовой обработки моделей (п.6.3 ТЗ).
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
  const updateModel = useStore((s) => s.updateModel);
  const classifier = useStore((s) => s.classifier);
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
  /** Прогресс пакетной обработки ИИ. null = не идёт. */
  const [aiProgress, setAiProgress] = useState<{
    label: string;
    done: number;
    total: number;
    skipped: number;
    failed: number;
  } | null>(null);
  const cancelRef = useRef(false);
  const hasKey = !!getApiKey();

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

  /**
   * Пакетное извлечение хар-к из документов модели через ИИ
   * (п.6.3 ТЗ — функция «обогатить характеристики из документов»).
   * Идёт по `filtered`, пропускает модели без класса/документа/ключей,
   * пишет источник «ai» и сохраняет lockedByExpert значения.
   */
  async function bulkExtractFromDocs() {
    cancelRef.current = false;
    let done = 0;
    let skipped = 0;
    let failed = 0;
    const total = filtered.length;
    setAiProgress({ label: 'Хар-ки из документов', done, total, skipped, failed });
    for (const m of filtered) {
      if (cancelRef.current) break;
      const text = (m.documents ?? [])
        .map((d) => d.parsedText || '')
        .filter(Boolean)
        .join('\n\n');
      const keys = priorityKeysFor(m, classifier.classes);
      if (!text.trim() || keys.length === 0 || !m.className) {
        skipped += 1;
      } else {
        try {
          const items = await aiProvider().extractCharacteristics({ text, keys });
          if (items.length === 0) {
            skipped += 1;
          } else {
            const existing = m.characteristics ?? [];
            const locked = existing.filter((c) => c.lockedByExpert);
            const lockedKeys = new Set(locked.map((c) => c.key.toLowerCase()));
            const aiChars: Characteristic[] = items
              .filter((x) => !lockedKeys.has(x.key.toLowerCase()))
              .map((x) => ({
                id: newId('c'),
                key: x.key,
                valueRaw: x.valueRaw,
                unit: x.unit,
                targetUnit: keys.find((k) => k.key === x.key)?.unit,
                isPriority: true,
                priorityOrder: keys.findIndex((k) => k.key === x.key),
                source: 'ai' as const,
              }));
            updateModel(m.id, { characteristics: [...locked, ...aiChars] });
          }
        } catch {
          failed += 1;
        }
      }
      done += 1;
      setAiProgress({ label: 'Хар-ки из документов', done, total, skipped, failed });
    }
    setAiProgress(null);
    setMsg(
      `Хар-ки из документов: обработано ${done}, пропущено ${skipped}, ошибок ${failed}.`,
    );
  }

  /**
   * Пакетное обогащение хар-к из открытых источников через ИИ
   * (п.6.3 ТЗ — функция «обогатить значения характеристик из интернета»).
   */
  async function bulkEnrichFromWeb() {
    cancelRef.current = false;
    let done = 0;
    let skipped = 0;
    let failed = 0;
    const total = filtered.length;
    setAiProgress({ label: 'Хар-ки из интернета', done, total, skipped, failed });
    for (const m of filtered) {
      if (cancelRef.current) break;
      const keys = priorityKeysFor(m, classifier.classes);
      if (!m.className || keys.length === 0) {
        skipped += 1;
      } else {
        try {
          const items = await aiProvider().enrichCharacteristicsFromWeb({
            model: {
              className: m.className,
              subclassName: m.subclassName,
              normalizedCode: m.normalizedCode,
              rawCode: m.rawCode,
            },
            keys,
          });
          if (items.length === 0) {
            skipped += 1;
          } else {
            const existing = m.characteristics ?? [];
            const locked = existing.filter((c) => c.lockedByExpert);
            const lockedKeys = new Set(locked.map((c) => c.key.toLowerCase()));
            const keepManual = existing.filter(
              (c) =>
                !c.lockedByExpert &&
                c.source === 'manual' &&
                !!c.valueRaw &&
                !keys.find((k) => k.key === c.key),
            );
            const webChars: Characteristic[] = items
              .filter((x) => !lockedKeys.has(x.key.toLowerCase()))
              .map((x) => ({
                id: newId('c'),
                key: x.key,
                valueRaw: x.valueRaw,
                unit: x.unit,
                targetUnit: keys.find((k) => k.key === x.key)?.unit,
                isPriority: true,
                priorityOrder: keys.findIndex((k) => k.key === x.key),
                source: 'web' as const,
              }));
            updateModel(m.id, {
              characteristics: [...locked, ...keepManual, ...webChars],
            });
          }
        } catch {
          failed += 1;
        }
      }
      done += 1;
      setAiProgress({ label: 'Хар-ки из интернета', done, total, skipped, failed });
    }
    setAiProgress(null);
    setMsg(
      `Хар-ки из интернета: обработано ${done}, пропущено ${skipped}, ошибок ${failed}.`,
    );
  }

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
          <h3 style={{ margin: 0 }}>Массовая обработка моделей · п.6.3 ТЗ</h3>
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
            title="Применить правила нормализации (п.8.3) ко всем выбранным моделям."
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
          <button
            disabled={filtered.length === 0 || !hasKey || !!aiProgress}
            title={
              hasKey
                ? 'Извлечь характеристики из загруженных документов через ИИ. Идёт по списку, пишет результат с источником «ai».'
                : 'Введите OpenAI токен в шапке, чтобы запустить пакетную обработку.'
            }
            onClick={() => bulkExtractFromDocs()}
          >
            🤖 ИИ: хар-ки из документов
          </button>
          <button
            disabled={filtered.length === 0 || !hasKey || !!aiProgress}
            title={
              hasKey
                ? 'Заполнить пустые приоритетные характеристики через ИИ из открытых источников (паспортные/типовые значения).'
                : 'Введите OpenAI токен в шапке, чтобы запустить пакетную обработку.'
            }
            onClick={() => bulkEnrichFromWeb()}
          >
            🌐 ИИ: хар-ки из интернета
          </button>
          {aiProgress && (
            <button
              onClick={() => {
                cancelRef.current = true;
              }}
              title="Прервать текущий пакетный прогон"
            >
              ⏹ Стоп
            </button>
          )}
          <span className="spacer" />
          <span className="muted small">
            Видно {filtered.length} из {stat.total}
          </span>
        </div>

        {aiProgress && (
          <div
            className="muted small"
            style={{
              background: 'var(--bg-alt)',
              padding: 6,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>
              {aiProgress.label}: {aiProgress.done}/{aiProgress.total}
              {aiProgress.skipped ? ` · пропущено ${aiProgress.skipped}` : ''}
              {aiProgress.failed ? ` · ошибок ${aiProgress.failed}` : ''}
            </span>
            <div
              style={{
                flex: 1,
                height: 6,
                background: '#eee',
                borderRadius: 3,
                overflow: 'hidden',
                minWidth: 120,
              }}
            >
              <div
                style={{
                  width: `${(aiProgress.done / Math.max(1, aiProgress.total)) * 100}%`,
                  height: '100%',
                  background: '#4a90e2',
                  transition: 'width 200ms linear',
                }}
              />
            </div>
          </div>
        )}

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
