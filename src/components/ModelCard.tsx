import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  getUiSettings,
  setUiSettings,
  subscribeUiSettings,
  type UiSettings,
} from '../domain/uiSettings';
import {
  normalizeModelCode,
  normalizeCharName,
  normalizeUnit,
} from '../domain/normalize';
import { classifyModel } from '../domain/classify';
import {
  parseCharacteristics,
  sortCharacteristics,
  missingPriorityChars,
} from '../domain/parseChars';
import { fmtNum, parseValue } from '../domain/units';
import type {
  ActionItem,
  ActionKind,
  Characteristic,
  DocumentRef,
} from '../domain/types';
import { extractTextFromFile, extractTextFromUrl } from '../parsers/docText';
import { aiProvider } from '../domain/ai';
import { getApiKey } from '../domain/openai';
import { loadModelsDb, lookupModel } from '../data/modelsDb';
import * as XLSX from 'xlsx';

type Tab =
  | 'props'
  | 'docs'
  | 'chars'
  | 'actions'
  | 'analogs'
  | 'techcards'
  | 'specs'
  | 'ppr'
  | 'reliability';

const TABS: Array<{ id: Tab; label: string; ready: boolean }> = [
  { id: 'props', label: 'Свойства', ready: true },
  { id: 'docs', label: 'Документы', ready: true },
  { id: 'chars', label: 'Характеристики', ready: true },
  { id: 'actions', label: 'ВВ', ready: true },
  { id: 'ppr', label: 'График ППР', ready: true },
  { id: 'techcards', label: 'Техкарты', ready: true },
  { id: 'specs', label: 'Спецификации', ready: true },
  { id: 'analogs', label: 'Аналоги', ready: true },
  { id: 'reliability', label: 'Надёжность', ready: true },
];

function newId(p: string) {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Бейдж расширения файла для документов на ТОР (п.6.1 ТЗ:
 * «Реализовано визуальное цветовое обозначение типов файлов»).
 * Цвета подобраны под основные типы документов в ТОиР.
 */
function fileExt(name: string): string {
  if (!name) return '';
  const cleaned = name.split('?')[0].split('#')[0];
  const m = /\.([a-zа-я0-9]{1,8})$/i.exec(cleaned.trim());
  return m ? m[1].toLowerCase() : '';
}
function FileExtBadge({ name }: { name: string }) {
  const ext = fileExt(name);
  if (!ext) return <span className="ext-badge ext-other">FILE</span>;
  const known = new Set([
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'csv',
    'txt',
    'rtf',
    'zip',
    'rar',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'svg',
    'dwg',
    'dxf',
  ]);
  const cls = known.has(ext) ? `ext-${ext}` : 'ext-other';
  return <span className={`ext-badge ${cls}`}>{ext.toUpperCase()}</span>;
}

export function ModelCard({ modelId }: { modelId: string }) {
  const model = useStore((s) => s.models.find((x) => x.id === modelId));
  const classifier = useStore((s) => s.classifier);
  const rules = useStore((s) => s.rules);
  const update = useStore((s) => s.updateModel);
  const remove = useStore((s) => s.deleteModel);
  const disabledRules = useMemo(
    () =>
      new Set(
        rules.modelRules.filter((r) => !r.enabled).map((r) => r.id),
      ),
    [rules],
  );
  const [tab, setTab] = useState<Tab>('props');
  const [ui, setUi] = useState<UiSettings>(() => getUiSettings());
  useEffect(() => subscribeUiSettings(setUi), []);
  const fullscreen = ui.modelCardFullscreen;
  const toggleFullscreen = () =>
    setUiSettings({ modelCardFullscreen: !fullscreen });

  const norm = useMemo(
    () => (model ? normalizeModelCode(model.rawCode, disabledRules) : null),
    [model, disabledRules],
  );

  if (!model) return null;

  const cls = classifier.classes.find((c) => c.name === model.className);
  const sub = cls?.subclasses.find((s) => s.name === model.subclassName);
  const code = model.normalizedCode || model.rawCode;

  return (
    <div className={`card model-card${fullscreen ? ' is-fullscreen' : ''}`}>
      <div className="card-head">
        {ui.showModelImages && model.imageUrl && (
          <img
            src={model.imageUrl}
            alt=""
            className="model-thumb"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <span className="muted small">Модель</span>
        <h3 className="mono code-title">{code}</h3>
        {model.className && (
          <span className="muted small">
            · {model.className}
            {model.subclassName ? ` / ${model.subclassName}` : ''}
          </span>
        )}
        <span className="spacer" />
        <button
          onClick={toggleFullscreen}
          title={
            fullscreen
              ? 'Свернуть карточку обратно к дереву'
              : 'Развернуть карточку на весь экран (отдельно от иерархии)'
          }
        >
          {fullscreen ? '⤤ К дереву' : '⛶ На весь экран'}
        </button>
        <button className="danger" onClick={() => remove(model.id)}>
          Удалить
        </button>
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'sel' : ''} ${
              !t.ready ? 'todo' : ''
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {!t.ready && <span className="todo-mark">·</span>}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === 'props' && (
          <PropsTab modelId={modelId} />
        )}
        {tab === 'docs' && <DocsTab modelId={modelId} />}
        {tab === 'chars' && <CharsTab modelId={modelId} />}
        {tab === 'actions' && <ActionsTab modelId={modelId} />}
        {tab === 'ppr' && <PprTab modelId={modelId} />}
        {tab === 'techcards' && <TechCardTab modelId={modelId} />}
        {tab === 'specs' && <SpecsTab modelId={modelId} />}
        {tab === 'analogs' && <AnalogsTab modelId={modelId} />}
        {tab === 'reliability' && <ReliabilityTab modelId={modelId} />}
      </div>

      {tab === 'props' && norm && norm.applied.length > 0 && (
        <details className="diag">
          <summary>
            Применённые правила нормализации ({norm.applied.length})
          </summary>
          <ul>
            {norm.applied.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
            {norm.warnings.map((w, i) => (
              <li key={'w' + i} className="warn-text">
                ⚠ {w}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );

  function TechCardTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const refs = useStore((s) => s.references);
    const upsert = useStore((s) => s.upsertTechCardRow);
    const del = useStore((s) => s.deleteTechCardRow);
    const setTechCard = useStore((s) => s.setTechCard);
    const [aiBusy, setAiBusy] = useState(false);
    const [aiErr, setAiErr] = useState('');
    /**
     * Фильтр по виду воздействия (ВВ): техкарта подстраивается под выбранный
     * вид (например, «только ТО-1»). По умолчанию — все ВВ.
     * Спец-значения: '' = все · '__none__' = строки без привязки к ВВ.
     * Не мутирует store — это только UI-фильтр (созвон 28.04.2026: «только то1»).
     */
    const [actionFilter, setActionFilter] = useState<string>('');
    if (!m) return null;
    const allRows = m.techCard ?? [];
    const rows =
      actionFilter === ''
        ? allRows
        : actionFilter === '__none__'
          ? allRows.filter((r) => !r.actionId)
          : allRows.filter((r) => r.actionId === actionFilter);
    const ops = refs.operations;
    const specs = refs.specialties;
    const acts = m.actions ?? [];
    const hasKey = !!getApiKey();

    // ───── Нормализация имён внутри техкарты (правила из созвона 28.04.2026) ─────
    // 1) Если несколько слов — первое всегда существительное.
    // 2) Элемент / Подэлемент — в единственном числе и именительном падеже.
    // 3) Слова не сокращать и не заменять синонимами.
    // Дополнительно: «Не вноси как Элемент/Подэлемент крепёж — гайки, шайбы,
    // винты, шпильки, хомуты, болты, штифты, шпонки.»
    const FORBIDDEN_FASTENERS = [
      'гайка', 'шайба', 'винт', 'шпилька', 'хомут', 'болт', 'штифт', 'шпонка',
    ];
    const ABBREV_EXPANSIONS: Record<string, string> = {
      кл: 'клапан',
      'эл/двиг': 'электродвигатель',
      'эл.двиг': 'электродвигатель',
      эл: 'электро',
      цил: 'цилиндр',
      тр: 'труба',
      трубопр: 'трубопровод',
      возд: 'воздух',
      дв: 'двигатель',
      редукт: 'редуктор',
      подш: 'подшипник',
      подшипн: 'подшипник',
      кпп: 'коробка передач',
    };
    const SYNONYM_TO_CANON: Record<string, string> = {
      моторчик: 'двигатель',
      двигун: 'двигатель',
      кулак: 'кулачок',
      колесико: 'колесо',
      колёсико: 'колесо',
    };
    const isLikelyAdjective = (w: string) =>
      /(?:ный|ная|ное|ные|ая|ое|ые|ой|ий|яя|ее|ие|ьный|ьная|ьное|ьные|ний|няя|нее|ние|ского|ская|ское|ские|зной|зная)$/u.test(
        w,
      );
    const toSingularNominative = (w: string): string => {
      if (!w || w.length <= 3) return w;
      if (/нки$/u.test(w)) return w.slice(0, -1) + 'а';
      if (/тки$/u.test(w)) return w.slice(0, -1) + 'а';
      if (/[бвгджзклмнпрстфхцчшщ]ы$/u.test(w)) return w.slice(0, -1);
      if (/[бвгджзклмнпрстфхцчшщ]и$/u.test(w)) return w.slice(0, -1) + 'ь';
      if (/иями$/u.test(w)) return w.slice(0, -4) + 'ие';
      if (/[еа]ния$/u.test(w)) return w.slice(0, -1) + 'е';
      if (/ии$/u.test(w)) return w.slice(0, -1) + 'е';
      if (/ями$/u.test(w)) return w.slice(0, -3) + 'ь';
      if (/ами$/u.test(w)) return w.slice(0, -3) + 'а';
      return w;
    };
    const cleanNameText = (s: string): string => {
      // eslint-disable-next-line no-control-regex
      const ctrl = /[\u0000-\u001F\u007F]/g;
      return String(s ?? '')
        .replace(ctrl, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*[-–—]\s*/g, '-')
        .trim();
    };
    const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
    const expandWord = (w: string): string => {
      const lower = w.toLowerCase().replace(/[.,;]+$/u, '');
      if (ABBREV_EXPANSIONS[lower]) return ABBREV_EXPANSIONS[lower];
      if (SYNONYM_TO_CANON[lower]) return SYNONYM_TO_CANON[lower];
      return w;
    };
    const normElement = (input: string): { text: string; warnings: string[] } => {
      const warnings: string[] = [];
      const t = cleanNameText(input);
      if (!t) return { text: '', warnings };
      let words = t.split(' ').filter(Boolean).map((w) => expandWord(w.toLowerCase()));
      words = words.map((w) => (isLikelyAdjective(w) ? w : toSingularNominative(w)));
      if (words.length > 1) {
        const idx = words.findIndex((w) => !isLikelyAdjective(w));
        if (idx > 0) {
          const noun = words[idx];
          words = [noun, ...words.filter((_, i) => i !== idx)];
        }
      }
      const head = (words[0] ?? '').toLowerCase();
      if (FORBIDDEN_FASTENERS.includes(head)) {
        warnings.push(
          `«${head}» нельзя использовать как Элемент/Подэлемент. Укажите узел, к которому относится крепёж.`,
        );
      }
      return { text: cap(words.join(' ')), warnings };
    };
    const normOperation = (input: string): string => {
      const t = cleanNameText(input);
      if (!t) return '';
      const words = t.split(' ').map((w) => expandWord(w));
      return cap(words.join(' ').toLowerCase());
    };
    const normTmc = (input: string): string => {
      const t = cleanNameText(input);
      if (!t) return '';
      const words = t.split(' ').map((w) => expandWord(w));
      return words.join(' ');
    };

    // При активном фильтре по ВВ новая строка сразу получает этот actionId,
    // чтобы она осталась видимой в текущем виде («техкарта подстраивается под вид»).
    const filterActionId =
      actionFilter && actionFilter !== '__none__' ? actionFilter : undefined;
    const addBlankRow = () =>
      upsert(modelId, {
        component: '',
        subcomponent: '',
        operation: '',
        actionId: filterActionId,
        specialty: '',
        qualification: '',
        laborHours: undefined,
        workers: undefined,
        tmcName: '',
        tmcKind: undefined,
        tmcUnit: '',
        tmcQty: undefined,
        source: 'manual',
      });
    const addAggregateRow = () =>
      upsert(modelId, {
        isAggregate: true,
        component: '',
        subcomponent: '',
        operation: '',
        actionId: filterActionId,
        source: 'manual',
      });
    const sortByElement = () => {
      const sorted = [...allRows].sort((a, b) => {
        const ea = (a.isAggregate ? '\uffff' : (a.component ?? '')).toLocaleLowerCase('ru');
        const eb = (b.isAggregate ? '\uffff' : (b.component ?? '')).toLocaleLowerCase('ru');
        if (ea !== eb) return ea.localeCompare(eb, 'ru');
        const sa = (a.subcomponent ?? '').toLocaleLowerCase('ru');
        const sb = (b.subcomponent ?? '').toLocaleLowerCase('ru');
        if (sa !== sb) return sa.localeCompare(sb, 'ru');
        return (a.operation ?? '').localeCompare(b.operation ?? '', 'ru');
      });
      setTechCard(modelId, sorted);
    };
    const dedupeRows = () => {
      const seen = new Set<string>();
      const out: typeof allRows = [];
      for (const r of allRows) {
        const key = [
          r.isAggregate ? 'AGG' : (r.component ?? '').trim().toLowerCase(),
          (r.subcomponent ?? '').trim().toLowerCase(),
          (r.operation ?? '').trim().toLowerCase(),
          (r.specialty ?? '').trim().toLowerCase(),
          (r.qualification ?? '').trim().toLowerCase(),
          (r.tmcName ?? '').trim().toLowerCase(),
          (r.tmcUnit ?? '').trim().toLowerCase(),
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
      const removed = allRows.length - out.length;
      setTechCard(modelId, out);
      setAiErr(removed > 0 ? `Удалено дублей: ${removed}.` : 'Дублей не найдено.');
    };

    /**
     * Нормализация всех имён в техкарте по правилам из созвона 28.04.2026:
     *   1. Первое слово — существительное.
     *   2. Элемент / Подэлемент — ед.число + им.падеж.
     *   3. Не сокращать и не подменять синонимами.
     *   + Запрет крепежа (гайки/шайбы/винты/...) как Элемент/Подэлемент.
     * Плюс старые правила п.8.4 (операции) и п.8.6 (ед.изм.).
     */
    const normalizeAllRows = () => {
      let touched = 0;
      const warns: string[] = [];
      for (const r of allRows) {
        const elem = r.component ? normElement(r.component) : { text: '', warnings: [] };
        const sub = r.subcomponent ? normElement(r.subcomponent) : { text: '', warnings: [] };
        const newOp = r.operation ? normOperation(r.operation) : r.operation;
        const newTmc = r.tmcName ? normTmc(r.tmcName) : r.tmcName;
        const newUnit = r.tmcUnit ? normalizeUnit(r.tmcUnit) : r.tmcUnit;
        const newComp = r.component ? elem.text : r.component;
        const newSub = r.subcomponent ? sub.text : r.subcomponent;
        if (
          newOp !== r.operation ||
          newComp !== r.component ||
          newSub !== r.subcomponent ||
          newTmc !== r.tmcName ||
          newUnit !== r.tmcUnit
        ) {
          upsert(modelId, {
            ...r,
            operation: newOp ?? '',
            component: newComp ?? '',
            subcomponent: newSub ?? '',
            tmcName: newTmc ?? '',
            tmcUnit: newUnit ?? '',
          });
          touched++;
        }
        warns.push(...elem.warnings, ...sub.warnings);
      }
      const head = touched ? `Нормализовано: ${touched}` : 'Все строки уже нормализованы.';
      setAiErr(warns.length ? `${head}. Замечаний: ${warns.length}.` : head);
    };

    /** Этап 3 ручного workflow: «Состав» (Элемент / Подэлемент). */
    const fillElementsAi = async () => {
      if (aiBusy) return;
      if (!hasKey) {
        setAiErr('Укажите OpenAI ключ в «Настройках».');
        return;
      }
      setAiBusy(true);
      setAiErr('');
      try {
        const docText = (m.documents ?? [])
          .map((d) => d.parsedText ?? '')
          .filter(Boolean)
          .join('\n\n');
        const result = await aiProvider().fillElementsAndSubelements({
          model: {
            className: m.className,
            subclassName: m.subclassName,
            normalizedCode: m.normalizedCode,
            rawCode: m.rawCode,
          },
          docText: docText || undefined,
        });
        if (result.length === 0) {
          setAiErr('ИИ не вернул состав. Очистите кэш ИИ и повторите.');
          return;
        }
        for (const r of result) {
          upsert(modelId, {
            component: r.component,
            subcomponent: r.subcomponent,
            source: 'ai',
          });
        }
      } catch (e) {
        setAiErr('Ошибка ИИ: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setAiBusy(false);
      }
    };

    /** Этап 4 ручного workflow: «Операции» с правилами Демонтаж/Монтаж. */
    const fillOperationsAi = async () => {
      if (aiBusy) return;
      if (!hasKey) {
        setAiErr('Укажите OpenAI ключ в «Настройках».');
        return;
      }
      // Берём уникальные пары элемент+подэлемент из существующих строк.
      const existing = m.techCard ?? [];
      const compsMap = new Map<string, { component: string; subcomponent?: string }>();
      for (const r of existing) {
        if (!r.component?.trim()) continue;
        const k = `${r.component.trim()}|${(r.subcomponent ?? '').trim()}`;
        if (!compsMap.has(k))
          compsMap.set(k, {
            component: r.component.trim(),
            subcomponent: r.subcomponent?.trim() || undefined,
          });
      }
      if (compsMap.size === 0) {
        setAiErr('Сначала заполните состав (этап 3 — кнопка «🧩 Состав»).');
        return;
      }
      setAiBusy(true);
      setAiErr('');
      try {
        const docText = (m.documents ?? [])
          .map((d) => d.parsedText ?? '')
          .filter(Boolean)
          .join('\n\n');
        const result = await aiProvider().fillOperationsForElements({
          model: {
            className: m.className,
            subclassName: m.subclassName,
            normalizedCode: m.normalizedCode,
            rawCode: m.rawCode,
          },
          components: Array.from(compsMap.values()),
          operationsRef: ops.map((o) => o.name),
          docText: docText || undefined,
        });
        if (result.length === 0) {
          setAiErr('ИИ не вернул операции. Очистите кэш ИИ и повторите.');
          return;
        }
        // Удаляем существующие пустые строки (component без operation),
        // потом вставляем новые с операциями.
        for (const r0 of existing) {
          if (r0.component && !r0.operation) {
            del(modelId, r0.id);
          }
        }
        for (const r of result) {
          upsert(modelId, {
            component: r.component,
            subcomponent: r.subcomponent,
            operation: r.operation,
            workDescription: r.workDescription,
            source: 'ai',
          });
        }
      } catch (e) {
        setAiErr('Ошибка ИИ: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setAiBusy(false);
      }
    };

    const fillByAi = async () => {
      if (aiBusy) return;
      if (!hasKey) {
        setAiErr('Укажите OpenAI ключ в «Настройках».');
        return;
      }
      if (acts.length === 0) {
        setAiErr('Нет ВВ — добавьте хотя бы одно ВВ (вкладка «ВВ»).');
        return;
      }
      setAiBusy(true);
      setAiErr('');
      try {
        const result = await aiProvider().fillTechCardByTemplate({
          model: {
            className: m.className,
            subclassName: m.subclassName,
            normalizedCode: m.normalizedCode,
            rawCode: m.rawCode,
          },
          actions: acts.map((a) => ({
            id: a.id,
            name: a.name,
            periodHours: a.periodHours,
          })),
          operations: ops.map((o) => o.name),
          specialties: specs.map((s) => ({
            name: s.name,
            qualifications: s.qualifications,
          })),
        });
        if (result.length === 0) {
          setAiErr(
            'ИИ вернул пустую техкарту. Проверьте, что класс/подкласс заполнены; попробуйте «Очистить кэш ИИ» в «Настройках» и повторите.',
          );
          return;
        }
        for (const r of result) {
          upsert(modelId, {
            component: r.component,
            subcomponent: r.subcomponent,
            operation: r.operation,
            workDescription: r.workDescription,
            actionId: r.actionId,
            laborHours: r.laborHours,
            workers: r.workers,
            specialty: r.specialty,
            qualification: r.qualification,
            totalLaborHours: r.totalLaborHours,
            tmcName: r.tmcName,
            tmcKind: r.tmcKind,
            tmcUnit: r.tmcUnit,
            tmcQty: r.tmcQty,
            tools: r.tools,
            ppe: r.ppe,
            safety: r.safety,
            source: 'ai',
          });
        }
      } catch (e) {
        setAiErr('Ошибка ИИ: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setAiBusy(false);
      }
    };

    return (
      <div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 6,
            flexWrap: 'wrap',
          }}
        >
          <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            ВВ:
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              title="Показать только строки выбранного вида воздействия. Техкарта подстраивается под выбранный вид (например, «только ТО-1»)."
            >
              <option value="">все</option>
              {acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.periodHours ? ` · ${a.periodHours} ч` : ''}
                </option>
              ))}
              <option value="__none__">— без привязки —</option>
            </select>
          </label>
          <button onClick={addBlankRow}>+ строка</button>
          <button
            onClick={addAggregateRow}
            title="Добавить операцию на сам агрегат (без указания Элемент/Подэлемент)."
          >
            + на агрегат
          </button>
          <button
            onClick={sortByElement}
            disabled={rows.length === 0}
            title="Сортировать строки по Элементу → Подэлементу → Операции."
          >
            ↕ по элементу
          </button>
          <button
            onClick={dedupeRows}
            disabled={rows.length === 0}
            title="Удалить дубли по Элементу+Подэлементу+Операции+Профессии+ТМЦ."
          >
            ✂ убрать дубли
          </button>
          <button
            onClick={fillElementsAi}
            disabled={aiBusy || !hasKey}
            title={
              !hasKey
                ? 'Укажите OpenAI ключ в «Настройках».'
                : 'Этап 3 ручного workflow: ИИ заполняет состав (Элемент / Подэлемент) по правилам заказчика — без крепежа, существ. в им.падеже ед.числе.'
            }
          >
            {aiBusy ? '…' : '🧩 Состав'}
          </button>
          <button
            onClick={fillOperationsAi}
            disabled={aiBusy || !hasKey || rows.length === 0}
            title={
              !hasKey
                ? 'Укажите OpenAI ключ в «Настройках».'
                : rows.length === 0
                  ? 'Сначала заполните состав (кнопка «🧩 Состав»).'
                  : 'Этап 4: ИИ заполняет операции по правилам заказчика — Замена→Демонтаж+Монтаж, обязательная пара Демонтаж/Монтаж.'
            }
          >
            {aiBusy ? '…' : '🔧 Операции'}
          </button>
          <button
            onClick={fillByAi}
            disabled={aiBusy || !hasKey || acts.length === 0}
            title={
              !hasKey
                ? 'Укажите OpenAI ключ в «Настройках».'
                : acts.length === 0
                  ? 'Добавьте хотя бы одно ВВ перед заполнением ИИ.'
                  : 'Сгенерировать техкарту целиком: ИИ ищет в интернете типовые операции и ТМЦ под класс/подкласс и список ВВ.'
            }
          >
            {aiBusy ? '…ИИ работает' : '🌐 Поиск в интернете'}
          </button>
          <button
            onClick={normalizeAllRows}
            disabled={rows.length === 0}
            title={
              rows.length === 0
                ? 'Сначала добавьте строки в техкарту.'
                : 'Нормализовать все наименования: ед.число и им.падеж, первое слово — существительное, без сокращений; крепёж не вносится в Элемент/Подэлемент.'
            }
          >
            🪄 Нормализовать
          </button>
          <button
            onClick={toggleFullscreen}
            title={
              fullscreen
                ? 'Свернуть техкарту обратно к дереву'
                : 'Открыть техкарту на весь экран (отдельно от иерархии)'
            }
          >
            {fullscreen ? '⤤ К дереву' : '⛶ На весь экран'}
          </button>
          <span className="muted small">
            {actionFilter
              ? `${rows.length} из ${allRows.length}`
              : `${rows.length}`} строк
            {ops.length ? ` · справочник операций: ${ops.length}` : ''}
            {specs.length ? ` · специальностей: ${specs.length}` : ''}
            {!ops.length && (
              <> · загрузите «Справочник операций.xlsx» для autocomplete</>
            )}
          </span>
          {aiErr && (
            <span className="small" style={{ color: 'crimson' }}>
              {aiErr}
            </span>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="models">
            <thead>
              <tr>
                <th style={{ width: 140 }}>Элемент</th>
                <th style={{ width: 130 }}>Подэлемент</th>
                <th style={{ width: 170 }}>Операция</th>
                <th style={{ width: 90 }}>ВВ</th>
                <th style={{ width: 70 }}>Период, ч</th>
                <th style={{ width: 130 }}>Профессия</th>
                <th style={{ width: 60 }}>Разряд</th>
                <th style={{ width: 70 }} title="Трудозатраты на отдельную профессию (чел/ч).">Трудозатр.,ч</th>
                <th style={{ width: 140 }}>ТМЦ</th>
                <th style={{ width: 50 }}>Ед.</th>
                <th style={{ width: 60 }}>Кол-во</th>
                <th style={{ width: 80 }}>Источник</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="muted small">
                    Нет строк. Добавьте «+ строка» либо привяжите ВВ
                    (вкладка «ВВ»). Справочники операций, специальностей и
                    стандартных операций — через «Загрузить».
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const specOptions =
                  r.specialty &&
                  specs.find((s) => s.name === r.specialty)?.qualifications;
                // Собираем доп.поля в title, чтобы их было видно по hover
                // и они не съедали ширину таблицы (п.6.5 ТЗ).
                const tipParts: string[] = [];
                if (r.subcomponent) tipParts.push(`Подэлемент: ${r.subcomponent}`);
                if (r.workDescription) tipParts.push(`Содержание: ${r.workDescription}`);
                if (typeof r.workers === 'number')
                  tipParts.push(`Исполнителей: ${r.workers}`);
                if (typeof r.totalLaborHours === 'number')
                  tipParts.push(`Трудоёмкость: ${r.totalLaborHours} чел/ч`);
                if (r.tools) tipParts.push(`Инструмент: ${r.tools}`);
                if (r.ppe) tipParts.push(`СИЗ: ${r.ppe}`);
                if (r.safety) tipParts.push(`Безопасность: ${r.safety}`);
                const rowTitle = tipParts.join('\n');
                const elemWarn = r.component ? normElement(r.component).warnings.length > 0 : false;
                const subWarn = r.subcomponent ? normElement(r.subcomponent).warnings.length > 0 : false;
                return (
                  <tr key={r.id} title={rowTitle || undefined} className={`src-${r.source}`}>
                    <td>
                      {r.isAggregate ? (
                        <span className="muted small" title="Операция на сам агрегат">⟨агрегат⟩</span>
                      ) : (
                        <input
                          className={elemWarn ? 'warn' : undefined}
                          value={r.component ?? ''}
                          onChange={(e) =>
                            upsert(modelId, {
                              id: r.id,
                              component: e.target.value,
                            })
                          }
                          onBlur={(e) => {
                            const norm = normElement(e.target.value);
                            if (norm.text !== e.target.value)
                              upsert(modelId, { id: r.id, component: norm.text });
                          }}
                        />
                      )}
                    </td>
                    <td>
                      {r.isAggregate ? (
                        <span className="muted small">—</span>
                      ) : (
                        <input
                          className={subWarn ? 'warn' : undefined}
                          value={r.subcomponent ?? ''}
                          onChange={(e) =>
                            upsert(modelId, {
                              id: r.id,
                              subcomponent: e.target.value,
                            })
                          }
                          onBlur={(e) => {
                            const norm = normElement(e.target.value);
                            if (norm.text !== e.target.value)
                              upsert(modelId, { id: r.id, subcomponent: norm.text });
                          }}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        list={`ops-${modelId}`}
                        value={r.operation ?? ''}
                        onChange={(e) =>
                          upsert(modelId, {
                            id: r.id,
                            operation: e.target.value,
                          })
                        }
                        onBlur={(e) => {
                          const norm = normOperation(e.target.value);
                          if (norm !== e.target.value)
                            upsert(modelId, { id: r.id, operation: norm });
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={r.actionId ?? ''}
                        onChange={(e) =>
                          upsert(modelId, {
                            id: r.id,
                            actionId: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">—</option>
                        {acts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                            {a.periodHours
                              ? ` · ${a.periodHours} ч`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="muted small mono">
                      {(() => {
                        const a = acts.find((x) => x.id === r.actionId);
                        return a?.periodHours ? a.periodHours : '—';
                      })()}
                    </td>
                    <td>
                      <input
                        list={`specs-${modelId}`}
                        value={r.specialty ?? ''}
                        onChange={(e) =>
                          upsert(modelId, {
                            id: r.id,
                            specialty: e.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      {specOptions && specOptions.length ? (
                        <select
                          value={r.qualification ?? ''}
                          onChange={(e) =>
                            upsert(modelId, {
                              id: r.id,
                              qualification: e.target.value || undefined,
                            })
                          }
                        >
                          <option value="">—</option>
                          {specOptions.map((q) => (
                            <option key={q} value={q}>
                              {q}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={r.qualification ?? ''}
                          onChange={(e) =>
                            upsert(modelId, {
                              id: r.id,
                              qualification: e.target.value,
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={r.totalLaborHours ?? r.laborHours ?? ''}
                        title="Трудозатраты на отдельную профессию (чел/ч)."
                        onChange={(e) =>
                          upsert(modelId, {
                            id: r.id,
                            totalLaborHours: e.target.value
                              ? parseFloat(e.target.value)
                              : undefined,
                            // Сохраняем «норма часов» совместимо со старыми данными
                            // как ту же величину, чтобы экспорт не ломался.
                            laborHours: e.target.value
                              ? parseFloat(e.target.value)
                              : undefined,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={r.tmcName ?? ''}
                        onChange={(e) =>
                          upsert(modelId, {
                            id: r.id,
                            tmcName: e.target.value,
                          })
                        }
                        onBlur={(e) => {
                          const norm = normTmc(e.target.value);
                          if (norm !== e.target.value)
                            upsert(modelId, { id: r.id, tmcName: norm });
                        }}
                        title="Полное название ТМЦ (материалы и запчасти; инструмент исключается)."
                      />
                    </td>
                    <td>
                      <input
                        value={r.tmcUnit ?? ''}
                        onChange={(e) =>
                          upsert(modelId, {
                            id: r.id,
                            tmcUnit: e.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={r.tmcQty ?? ''}
                        onChange={(e) =>
                          upsert(modelId, {
                            id: r.id,
                            tmcQty: e.target.value
                              ? parseFloat(e.target.value)
                              : undefined,
                          })
                        }
                      />
                    </td>
                    <td>
                      <span className={`src-chip src-${r.source}`} title="Источник строки">
                        {r.source === 'document' ? 'документ'
                          : r.source === 'web' ? 'интернет'
                          : r.source === 'analog' ? 'аналог'
                          : r.source === 'ai' ? 'ИИ'
                          : r.source === 'classifier' ? 'классиф.'
                          : 'вручную'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn-as-label"
                        title="Удалить строку"
                        onClick={() => del(modelId, r.id)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {ops.length > 0 && (
          <datalist id={`ops-${modelId}`}>
            {ops.map((o, i) => (
              <option key={i} value={o.name}>
                {o.standard ? '★ стандарт' : ''}
              </option>
            ))}
          </datalist>
        )}
        {specs.length > 0 && (
          <datalist id={`specs-${modelId}`}>
            {specs.map((s, i) => (
              <option key={i} value={s.name} />
            ))}
          </datalist>
        )}
        {rows.length > 0 && (() => {
          const totals = new Map<string, number>();
          let grand = 0;
          for (const r of rows) {
            const lh = r.totalLaborHours ?? r.laborHours;
            if (typeof lh !== 'number') continue;
            grand += lh;
            const key = [
              r.specialty || '—',
              r.qualification ? ` ${r.qualification}` : '',
            ].join('').trim();
            totals.set(key, (totals.get(key) ?? 0) + lh);
          }
          if (totals.size === 0) return null;
          const fmt = (n: number) => Math.round(n * 100) / 100;
          return (
            <div className="muted small" style={{ marginTop: 6 }}>
              <strong>Суммарные трудозатраты:</strong>{' '}
              {Array.from(totals.entries())
                .map(([k, v]) => `${k}: ${fmt(v)} ч`)
                .join(' · ')}
              {' · итого '}
              <strong>{fmt(grand)} ч</strong>
            </div>
          );
        })()}
        <details className="muted small" style={{ marginTop: 6 }}>
          <summary>Правила нормализации (созвон 28.04.2026)</summary>
          <ul style={{ margin: '4px 0 0 16px' }}>
            <li>В Элемент/Подэлемент <strong>не вносим</strong> крепёж: гайки, шайбы, винты, шпильки, хомуты, болты, штифты, шпонки.</li>
            <li>Если в строке несколько слов — первое всегда <strong>существительное</strong>.</li>
            <li>Элемент и Подэлемент — в <strong>единственном числе</strong> и <strong>именительном падеже</strong>.</li>
            <li>Слова <strong>не сокращаем</strong> и не заменяем синонимами.</li>
            <li>Норма часов исключена — используем «Трудозатр.,ч». Тип ТМЦ скрыт, ТМЦ хранится полным наименованием.</li>
          </ul>
        </details>
      </div>
    );
  }

  function ReliabilityTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const allModels = useStore((s) => s.models);
    const setFailures = useStore((s) => s.setFailures);
    if (!m) return null;
    const failures = m.failures ?? [];

    const onFile = async (f: File) => {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
      });
      const parsed: import('../domain/types').FailureRecord[] = [];
      for (const r of rows) {
        // Эвристика: ищем колонки с датой отказа / восстановления / простоем.
        const keys = Object.keys(r);
        const find = (re: RegExp) =>
          keys.find((k) => re.test(k.toLowerCase().trim()));
        const cFailed = find(/отказ|сбой|нач/);
        const cRestored = find(/восстан|конец|оконч|устран/);
        const cDur = find(/простой|длительн|часов/);
        const cDesc = find(/описан|тип|причин|дефект/);
        const failedRaw = cFailed ? r[cFailed] : undefined;
        const restoredRaw = cRestored ? r[cRestored] : undefined;
        const durRaw = cDur ? r[cDur] : undefined;
        const descRaw = cDesc ? r[cDesc] : undefined;
        const failedAt = excelDate(failedRaw);
        if (!failedAt) continue;
        parsed.push({
          id:
            'f-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 6),
          failedAt,
          restoredAt: excelDate(restoredRaw),
          downtimeHours:
            typeof durRaw === 'number'
              ? durRaw
              : durRaw && parseFloat(String(durRaw))
                ? parseFloat(String(durRaw))
                : undefined,
          description: descRaw ? String(descRaw).trim() || undefined : undefined,
        });
      }
      if (!parsed.length) {
        alert(
          'Не удалось распознать ни одной строки. Ожидаются колонки: «Дата отказа», «Дата восстановления» (опц.), «Описание».',
        );
        return;
      }
      setFailures(modelId, parsed);
    };

    const stats = computeReliability(failures);

    // Аналог: оценка через модели того же класса+подкласса.
    const analogs = allModels.filter(
      (x) =>
        x.id !== m.id &&
        x.className === m.className &&
        x.subclassName === m.subclassName &&
        (x.failures ?? []).length > 0,
    );
    const analogStats = analogs.map((x) => ({
      m: x,
      ...computeReliability(x.failures ?? []),
    }));

    return (
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="btn-as-label">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void onFile(f);
                  e.target.value = '';
                }
              }}
            />
            история отказов…
          </label>
          {failures.length > 0 && (
            <button onClick={() => setFailures(modelId, [])}>×</button>
          )}
          <span className="muted small">
            {failures.length} отказ(ов){' '}
            {stats.spanDays
              ? `· период наблюдения ${stats.spanDays.toFixed(0)} дн`
              : ''}
          </span>
        </div>
        {failures.length === 0 && (
          <div className="muted stub" style={{ marginTop: 6 }}>
            Нет данных. Загрузите Excel с колонками: «Дата отказа», «Дата
            восстановления», «Описание». MTBF/MTTR посчитаются автоматически.
            Если истории нет — внизу показаны параметры по аналогам.
          </div>
        )}
        {failures.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
              <Stat
                label="MTBF"
                value={fmtHours(stats.mtbfHours)}
                hint="среднее время между отказами"
              />
              <Stat
                label="MTTR"
                value={fmtHours(stats.mttrHours)}
                hint="среднее время восстановления"
              />
              <Stat
                label="λ"
                value={
                  stats.failureRatePerHour != null
                    ? stats.failureRatePerHour.toExponential(2)
                    : '—'
                }
                hint="интенсивность отказов, 1/ч"
              />
              <Stat
                label="Кг"
                value={
                  stats.mtbfHours != null && stats.mttrHours != null
                    ? (
                        stats.mtbfHours /
                        (stats.mtbfHours + stats.mttrHours)
                      ).toFixed(4)
                    : '—'
                }
                hint="коэффициент готовности = MTBF / (MTBF + MTTR)"
              />
            </div>
            <table className="models">
              <thead>
                <tr>
                  <th>Дата отказа</th>
                  <th>Дата восстановления</th>
                  <th>Простой, ч</th>
                  <th>Описание</th>
                </tr>
              </thead>
              <tbody>
                {failures
                  .slice()
                  .sort((a, b) => a.failedAt.localeCompare(b.failedAt))
                  .map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{f.failedAt.slice(0, 10)}</td>
                      <td className="mono">
                        {f.restoredAt?.slice(0, 10) ?? '—'}
                      </td>
                      <td className="mono">
                        {f.downtimeHours != null
                          ? f.downtimeHours.toFixed(1)
                          : computeDowntime(f)?.toFixed(1) ?? '—'}
                      </td>
                      <td>{f.description ?? ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {failures.length === 0 && analogStats.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted small" style={{ marginBottom: 4 }}>
              Оценка по аналогам ({analogStats.length} моделей того же
              класса/подкласса):
            </div>
            <table className="models">
              <thead>
                <tr>
                  <th>Модель</th>
                  <th>Отказов</th>
                  <th>MTBF</th>
                  <th>MTTR</th>
                </tr>
              </thead>
              <tbody>
                {analogStats.map(({ m: am, count, mtbfHours, mttrHours }) => (
                  <tr key={am.id}>
                    <td className="mono">{am.normalizedCode || am.rawCode}</td>
                    <td>{count}</td>
                    <td>{fmtHours(mtbfHours)}</td>
                    <td>{fmtHours(mttrHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function AnalogsTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const allModels = useStore((s) => s.models);
    if (!m) return null;
    if (!m.className) {
      return (
        <div className="muted stub">
          Не задан класс. Укажите класс/подкласс на вкладке «Свойства» —
          аналоги ищутся внутри одного класса/подкласса.
        </div>
      );
    }
    const sameClass = allModels.filter(
      (x) => x.id !== m.id && x.className === m.className,
    );
    const sameSub = sameClass.filter((x) => x.subclassName === m.subclassName);
    const candidates = sameSub.length > 0 ? sameSub : sameClass;

    // Собираем приоритетные ключи в порядке классификатора + те, что есть в m.
    const priorityKeys: string[] = [];
    for (const p of cls?.priorityChars ?? []) priorityKeys.push(p.key);
    for (const p of sub?.priorityChars ?? []) {
      if (!priorityKeys.includes(p.key)) priorityKeys.push(p.key);
    }
    // Добиваем недостающими ключами из самой модели.
    for (const c of m.characteristics ?? []) {
      if (c.isPriority && !priorityKeys.includes(c.key)) priorityKeys.push(c.key);
    }

    // Скоринг: по приоритетным числовым характеристикам — близость значений.
    const score = (other: typeof m): { score: number; matched: number } => {
      let matched = 0;
      let sum = 0;
      let weight = 0;
      for (const k of priorityKeys) {
        const a = (m.characteristics ?? []).find((c) => c.key === k);
        const b = (other.characteristics ?? []).find((c) => c.key === k);
        if (!a || !b) continue;
        if (a.valueNum != null && b.valueNum != null) {
          matched++;
          const denom = Math.max(Math.abs(a.valueNum), Math.abs(b.valueNum), 1);
          const diff = Math.abs(a.valueNum - b.valueNum) / denom;
          sum += Math.max(0, 1 - diff);
          weight += 1;
        } else if (
          a.valueRaw &&
          b.valueRaw &&
          a.valueRaw.toLowerCase() === b.valueRaw.toLowerCase()
        ) {
          matched++;
          sum += 1;
          weight += 1;
        }
      }
      // Бонус за совпадение подкласса.
      const subBonus =
        other.subclassName === m.subclassName ? 0.1 : 0;
      const s = (weight > 0 ? sum / weight : 0) * 0.9 + subBonus;
      return { score: s, matched };
    };

    const ranked = candidates
      .map((x) => ({ m: x, ...score(x) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (ranked.length === 0) {
      return (
        <div className="muted stub">
          В системе нет других моделей класса «{m.className}»
          {m.subclassName ? ` / «${m.subclassName}»` : ''}.
        </div>
      );
    }

    // Целевая единица (из приоритетных характеристик класса/подкласса).
    const targetUnitFor = (key: string): string | undefined => {
      const inSub = (sub?.priorityChars ?? []).find((p) => p.key === key);
      if (inSub?.unit) return inSub.unit;
      const inCls = (cls?.priorityChars ?? []).find((p) => p.key === key);
      return inCls?.unit;
    };

    return (
      <div>
        <div className="muted small" style={{ marginBottom: 6 }}>
          Аналоги по {sameSub.length > 0 ? 'подклассу' : 'классу'}: {ranked.length}.
          Сравнение по приоритетным характеристикам класса/подкласса.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="models">
            <thead>
              <tr>
                <th style={{ width: 200 }}>Характеристика</th>
                <th style={{ width: 60 }}>Ед.</th>
                <th style={{ width: 100 }}>Текущая</th>
                {ranked.map((r) => (
                  <th key={r.m.id} style={{ width: 100 }}>
                    {r.m.normalizedCode || r.m.rawCode}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {priorityKeys.map((k) => {
                const a = (m.characteristics ?? []).find((c) => c.key === k);
                const targetUnit = targetUnitFor(k);
                return (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="muted small mono">{targetUnit ?? '—'}</td>
                    <td className="mono">
                      {a
                        ? `${a.valueRaw}${a.unit ? ' ' + a.unit : ''}`
                        : '—'}
                    </td>
                    {ranked.map((r) => {
                      const b = (r.m.characteristics ?? []).find(
                        (c) => c.key === k,
                      );
                      const diff =
                        a?.valueNum != null && b?.valueNum != null
                          ? Math.abs(a.valueNum - b.valueNum) /
                            Math.max(Math.abs(a.valueNum), 1)
                          : null;
                      const cls =
                        diff == null
                          ? ''
                          : diff < 0.05
                            ? 'analog-eq'
                            : diff < 0.25
                              ? 'analog-near'
                              : 'analog-far';
                      return (
                        <td key={r.m.id} className={`mono ${cls}`}>
                          {b
                            ? `${b.valueRaw}${b.unit ? ' ' + b.unit : ''}`
                            : '—'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function ActionsTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    if (!m) return null;
    const items = m.actions ?? [];
    const setItems = (next: ActionItem[]) => update(m.id, { actions: next });
    const updateItem = (id: string, patch: Partial<ActionItem>) =>
      setItems(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const removeItem = (id: string) =>
      setItems(items.filter((x) => x.id !== id));
    const add = () =>
      setItems([
        ...items,
        {
          id: newId('a'),
          name: 'ТО-1',
          kind: 'TO',
          source: 'manual',
        },
      ]);
    const aiSuggest = async (sourceTag: 'ai' | 'web' = 'ai') => {
      if (!m.className) {
        alert('Сначала определите класс модели.');
        return;
      }
      try {
        const proposals = await aiProvider().suggestActions({
          model: {
            className: m.className,
            subclassName: m.subclassName,
            normalizedCode: m.normalizedCode || m.rawCode,
          },
        });
        if (!proposals.length) {
          alert(
            sourceTag === 'web'
              ? 'По модели не нашлось общедоступных регламентов ВВ.'
              : 'ИИ не предложил вариантов.',
          );
          return;
        }
        const locked = items.filter((x) => x.lockedByExpert);
        const lockedNames = new Set(
          locked.map((x) => x.name.toLowerCase().trim()),
        );
        const newItems: ActionItem[] = proposals
          .filter((p) => !lockedNames.has(p.name.toLowerCase().trim()))
          .map((p) => ({
            id: newId('a'),
            name: p.name,
            kind: p.kind,
            periodHours: p.periodHours,
            source: sourceTag,
            note: p.reason,
          }));
        setItems([...locked, ...newItems]);
      } catch (e) {
        alert('Ошибка ИИ: ' + (e as Error).message);
      }
    };

    return (
      <div>
        <div className="row-flex" style={{ gap: 6, marginBottom: 6 }}>
          <button
            onClick={() => aiSuggest('ai')}
            disabled={!getApiKey() || !m.className}
            title={
              !getApiKey()
                ? 'Подключите OpenAI ключ в кнопке «ИИ» в шапке'
                : !m.className
                  ? 'Сначала определите класс модели'
                  : 'Предложить ВВ через ИИ (по классу/подклассу/коду)'
            }
          >
            Предложить через ИИ
          </button>
          <button
            onClick={() => aiSuggest('web')}
            disabled={!getApiKey() || !m.className}
            title={
              !getApiKey()
                ? 'Подключите OpenAI ключ в «Настройках»'
                : !m.className
                  ? 'Сначала определите класс модели'
                  : 'Подобрать ВВ из общедоступных регламентов / руководств производителя (п.6.4 ТЗ)'
            }
          >
            Обогатить из интернета
          </button>
          <span className="muted small">
            ВВ: {items.length} (
            {summarizeBySource(items)})
          </span>
        </div>
        <table className="models">
          <thead>
            <tr>
              <th style={{ width: 110 }}>ВВ</th>
              <th style={{ width: 110 }}>Период, ч</th>
              <th style={{ width: 110 }}>Период, ≈</th>
              <th style={{ width: 90 }}>Источник</th>
              <th>Заметка</th>
              <th style={{ width: 28 }}>🔒</th>
              <th style={{ width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Нет ВВ. Загрузите файл «Виды воздействия на ТОР ист/инт.xlsx»
                  кнопкой «Загрузить» в шапке, либо «+ ВВ», либо «Предложить
                  через ИИ».
                </td>
              </tr>
            )}
            {items.map((a) => (
              <tr key={a.id}>
                <td>
                  <input
                    value={a.name}
                    onChange={(e) =>
                      updateItem(a.id, {
                        name: e.target.value,
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    className="mono"
                    inputMode="numeric"
                    value={a.periodHours ?? ''}
                    onChange={(e) =>
                      updateItem(a.id, {
                        periodHours:
                          e.target.value === ''
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                  />
                </td>
                <td className="muted small">
                  {a.periodHours ? humanDuration(a.periodHours) : '—'}
                </td>
                <td className="muted small">
                  <SourceBadge source={a.source} />
                </td>
                <td>
                  <input
                    value={a.note ?? ''}
                    onChange={(e) => updateItem(a.id, { note: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={a.lockedByExpert ?? false}
                    onChange={(e) =>
                      updateItem(a.id, { lockedByExpert: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <button
                    className="danger"
                    onClick={() => removeItem(a.id)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="add-row">
          <button onClick={add}>Добавить ВВ</button>
        </div>
      </div>
    );
  }

  function ImageField({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const [ui, setUi] = useState<UiSettings>(() => getUiSettings());
    useEffect(() => subscribeUiSettings(setUi), []);
    if (!m) return null;
    if (!ui.showModelImages) {
      return (
        <div className="grid2-full muted small" style={{ marginTop: 4 }}>
          Картинка модели скрыта (тоггл в «Настройках» → «Показывать
          картинки моделей»).
        </div>
      );
    }
    const onFile = async (f?: File | null) => {
      if (!f) return;
      const url = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error ?? new Error('FileReader'));
        fr.readAsDataURL(f);
      });
      update(m.id, { imageUrl: url });
    };
    return (
      <div className="grid2-full" style={{ marginTop: 4 }}>
        <div className="muted small" style={{ marginBottom: 4 }}>
          Картинка модели (URL или файл, опционально)
        </div>
        <div className="row-flex" style={{ gap: 6, alignItems: 'flex-start' }}>
          {m.imageUrl && (
            <div className="model-image-box">
              <img src={m.imageUrl} alt="" />
            </div>
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              placeholder="https://... или data:image/..."
              value={m.imageUrl ?? ''}
              onChange={(e) =>
                update(m.id, { imageUrl: e.target.value || undefined })
              }
            />
            <div className="row-flex" style={{ gap: 6 }}>
              <label className="btn-as-label">
                Загрузить файл
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </label>
              {m.imageUrl && (
                <button
                  onClick={() => update(m.id, { imageUrl: undefined })}
                  title="Убрать картинку"
                >
                  Убрать
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function PropsTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const acceptProposal = useStore((s) => s.acceptProposal);
    if (!m) return null;
    const classes = classifier.classes.map((c) => c.name);
    const cur = classifier.classes.find((c) => c.name === m.className);
    const subclasses = cur ? cur.subclasses.map((s) => s.name) : [];
    const proposals = m.classificationProposals ?? [];
    const showProposals = proposals.filter(
      (p) => p.className !== m.className || p.subclassName !== m.subclassName,
    );

    return (
      <div className="grid2">
        <label>
          Код модели
          <div className="row-flex">
            <input
              className="mono"
              value={m.normalizedCode || m.rawCode}
              onChange={(e) => {
                if (m.normalizedCode) {
                  update(m.id, { normalizedCode: e.target.value });
                } else {
                  update(m.id, { rawCode: e.target.value });
                }
              }}
            />
            <button
              title="Применить правила нормализации (п.8.3 ТЗ)"
              onClick={() => {
                const r = normalizeModelCode(
                  m.normalizedCode || m.rawCode,
                  disabledRules,
                );
                update(m.id, { normalizedCode: r.code });
              }}
            >
              Нормализовать
            </button>
          </div>
        </label>
        <label>
          Источник
          <input
            value={
              (m.classificationSource === 'classifier'
                ? 'классификатор'
                : m.classificationSource === 'manual'
                  ? 'ручной'
                  : m.classificationSource === 'ai'
                    ? 'ИИ'
                    : m.classificationSource === 'unresolved'
                      ? 'не определён'
                      : '—') +
              // Процент показываем только для эвристик и ИИ — для прямой привязки
              // и ручного выбора процент не имеет смысла (это всегда 100%).
              (m.classificationConfidence !== undefined &&
              m.classificationConfidence < 1 &&
              m.classificationSource !== 'manual' &&
              m.classificationSource !== 'unresolved'
                ? ` · ${Math.round((m.classificationConfidence ?? 0) * 100)}%`
                : '')
            }
            readOnly
          />
        </label>
        <label>
          Класс
          <input
            list="dl-classes"
            value={m.className ?? ''}
            onChange={(e) =>
              update(m.id, {
                className: e.target.value || undefined,
                classificationSource: 'manual',
                classificationConfidence: 1,
                subclassName:
                  e.target.value !== m.className ? undefined : m.subclassName,
              })
            }
          />
          <datalist id="dl-classes">
            {classes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Подкласс
          <input
            list={`dl-sub-${m.id}`}
            value={m.subclassName ?? ''}
            onChange={(e) =>
              update(m.id, {
                subclassName: e.target.value || undefined,
                classificationSource: 'manual',
                classificationConfidence: 1,
              })
            }
          />
          <datalist id={`dl-sub-${m.id}`}>
            {subclasses.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <div className="grid2-full row-flex" style={{ gap: 8 }}>
          <button
            onClick={() => {
              const r = classifyModel(m, classifier);
              if (r.matched) {
                update(m.id, {
                  className: r.className,
                  subclassName: r.subclassName,
                  classificationSource: 'classifier',
                  classificationConfidence: r.confidence,
                  classificationProposals: r.proposals,
                });
              } else {
                update(m.id, {
                  classificationProposals: r.proposals,
                  classificationConfidence: r.confidence,
                });
              }
            }}
            title="Подобрать класс/подкласс по классификатору"
          >
            Подобрать
          </button>
          <button
            disabled={!getApiKey()}
            title={
              getApiKey()
                ? 'Спросить ИИ — выберет класс из классификатора по коду модели и тексту документов'
                : 'Подключите OpenAI ключ в кнопке «ИИ» в шапке'
            }
            onClick={async () => {
              try {
                const docText = (m.documents ?? [])
                  .map((d) => d.parsedText || '')
                  .filter(Boolean)
                  .join('\n')
                  .slice(0, 4000);
                const proposals = await aiProvider().classify({
                  model: { rawCode: m.rawCode, normalizedCode: m.normalizedCode },
                  classes: classifier.classes,
                  docText,
                });
                if (!proposals.length) {
                  alert('ИИ не предложил вариантов. Подберите вручную.');
                  return;
                }
                const top = proposals[0];
                // Всегда применяем верхнего кандидата как «ИИ» — у пользователя
                // сразу есть результат. Остальные кандидаты остаются как чипы
                // и одним кликом меняют выбор.
                update(m.id, {
                  classificationProposals: [
                    ...proposals,
                    ...(m.classificationProposals ?? []),
                  ],
                  className: top.className,
                  subclassName: top.subclassName,
                  classificationSource: 'ai',
                  classificationConfidence: top.confidence,
                });
              } catch (e) {
                alert('Ошибка ИИ: ' + (e as Error).message);
              }
            }}
          >
            Спросить ИИ
          </button>
          <label className="row-flex">
            <input
              type="checkbox"
              checked={m.validity?.expertVerified ?? false}
              onChange={(e) =>
                update(m.id, {
                  validity: {
                    expertVerified: e.target.checked,
                    confidence: m.validity?.confidence,
                    source: m.validity?.source,
                  },
                })
              }
            />
            Проверено экспертом
          </label>
        </div>
        <ImageField modelId={m.id} />
        {showProposals.length > 0 && (
          <div className="grid2-full">
            <div className="muted small" style={{ marginBottom: 4 }}>
              Кандидаты (нажмите чтобы принять):
            </div>
            <div className="row-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
              {showProposals.map((p, i) => (
                <button
                  key={i}
                  className="chip"
                  title={p.reason}
                  onClick={() => acceptProposal(m.id, p)}
                >
                  {p.className}
                  {p.subclassName ? ` / ${p.subclassName}` : ''}
                  <span className="muted small">
                    {' '}
                    · {Math.round(p.confidence * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function DocsTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const [draft, setDraft] = useState<{ url: string; kind: DocumentRef['kind'] }>({
      url: '',
      kind: 'passport',
    });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    if (!m) return null;
    const docs = m.documents ?? [];

    const saveDoc = () => {
      if (!draft.url.trim()) return;
      const d: DocumentRef = {
        id: newId('d'),
        url: draft.url.trim(),
        kind: draft.kind,
        filename: draft.url.trim().split('/').pop() || undefined,
      };
      update(m.id, { documents: [...docs, d] });
      setDraft({ url: '', kind: 'passport' });
    };
    const removeDoc = (id: string) =>
      update(m.id, { documents: docs.filter((x) => x.id !== id) });
    const updateDoc = (id: string, patch: Partial<DocumentRef>) =>
      update(m.id, {
        documents: docs.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      });

    const onFiles = async (files: FileList | null) => {
      if (!files || !files.length) return;
      setBusy(true);
      setErr('');
      try {
        const newDocs: DocumentRef[] = [];
        for (const f of Array.from(files)) {
          const r = await extractTextFromFile(f);
          newDocs.push({
            id: newId('d'),
            url: f.name,
            kind: draft.kind,
            filename: f.name,
            parsedText: r.text,
            parsedAt: new Date().toISOString(),
          });
        }
        update(m.id, { documents: [...docs, ...newDocs] });
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    };

    const reparseFromUrl = async (id: string, url: string) => {
      setBusy(true);
      setErr('');
      try {
        const r = await extractTextFromUrl(url);
        updateDoc(id, {
          parsedText: r.text,
          parsedAt: new Date().toISOString(),
        });
      } catch (e) {
        setErr(`Не удалось загрузить ${url}: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    };

    return (
      <div>
        <table className="models">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Тип</th>
              <th>URL/Имя</th>
              <th style={{ width: 140 }}>Распознанный текст</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Документы не привязаны. Сами файлы система не хранит — только
                  ссылки и распознанный текст.
                </td>
              </tr>
            )}
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <select
                    value={d.kind}
                    onChange={(e) =>
                      updateDoc(d.id, {
                        kind: e.target.value as DocumentRef['kind'],
                      })
                    }
                  >
                    <option value="passport">паспорт</option>
                    <option value="manual">руководство</option>
                    <option value="datasheet">datasheet</option>
                    <option value="other">прочее</option>
                  </select>
                </td>
                <td>
                  <div className="row-flex" style={{ gap: 4, alignItems: 'center' }}>
                    <FileExtBadge name={d.filename || d.url} />
                    <input
                      className="mono"
                      value={d.url}
                      onChange={(e) => updateDoc(d.id, { url: e.target.value })}
                      style={{ flex: 1 }}
                    />
                  </div>
                </td>
                <td>
                  <div className="row-flex" style={{ gap: 4 }}>
                    <button
                      onClick={() => {
                        setEditingId(editingId === d.id ? null : d.id);
                        setEditText(d.parsedText ?? '');
                      }}
                      title={
                        d.parsedText
                          ? `${d.parsedText.length} символов`
                          : 'Вставить распознанный текст вручную'
                      }
                    >
                      {d.parsedText ? `${d.parsedText.length} симв.` : 'вставить…'}
                    </button>
                    {d.url && /^https?:/i.test(d.url) && (
                      <button
                        onClick={() => reparseFromUrl(d.id, d.url)}
                        disabled={busy}
                        title="Скачать и распознать по URL"
                      >
                        ↓
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  <button className="danger" onClick={() => removeDoc(d.id)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editingId && (
          <div className="card sub">
            <h3>Распознанный текст документа</h3>
            <p className="muted small">
              Демо: вставьте сюда текст «ключ: значение», парсер выделит
              характеристики. В полной версии — извлекается автоматически из
              PDF/DOCX.
            </p>
            <textarea
              rows={10}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder="Мощность: 1,5 кВт&#10;Напряжение: 380 В&#10;..."
            />
            <div className="row-flex" style={{ gap: 6, marginTop: 6 }}>
              <button
                onClick={() => {
                  updateDoc(editingId, {
                    parsedText: editText,
                    parsedAt: new Date().toISOString(),
                  });
                  setEditingId(null);
                }}
              >
                Сохранить
              </button>
              <button onClick={() => setEditingId(null)}>Отмена</button>
            </div>
          </div>
        )}
        <div className="add-row">
          <select
            value={draft.kind}
            onChange={(e) =>
              setDraft({
                ...draft,
                kind: e.target.value as DocumentRef['kind'],
              })
            }
            style={{ flex: '0 0 140px' }}
          >
            <option value="passport">паспорт</option>
            <option value="manual">руководство</option>
            <option value="datasheet">datasheet</option>
            <option value="other">прочее</option>
          </select>
          <input
            placeholder="URL документа (http/https) — нажмите Enter"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveDoc();
            }}
          />
          <button onClick={saveDoc}>+ ссылка</button>
          <label
            className="btn-as-label"
            title="Прикрепить локальный файл pdf/docx — текст извлекается в браузере и сохраняется. Сам файл не загружается."
          >
            файл…
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              hidden
              multiple
              onChange={async (e) => {
                await onFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {busy && <span className="muted small">обработка…</span>}
        </div>
        {err && (
          <div className="warn-text small" style={{ marginTop: 4 }}>
            {err}
          </div>
        )}
      </div>
    );
  }

  function CharsTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const [excerpt, setExcerpt] = useState<{
      key: string;
      value: string;
      docId: string;
    } | null>(null);
    const [dbBusy, setDbBusy] = useState(false);
    if (!m) return null;
    const chars = sortCharacteristics(m.characteristics ?? []);
    const missing = missingPriorityChars(chars, cls, sub);

    const setChars = (next: Characteristic[]) =>
      update(m.id, { characteristics: next });

    const updateChar = (id: string, patch: Partial<Characteristic>) =>
      setChars(
        (m.characteristics ?? []).map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      );
    const removeChar = (id: string) =>
      setChars((m.characteristics ?? []).filter((c) => c.id !== id));

    const addManual = (key: string) => {
      const next: Characteristic = {
        id: newId('c'),
        key,
        valueRaw: '',
        isPriority: !!cls?.priorityChars?.find((p) => p.key === key),
        priorityOrder: cls?.priorityChars?.findIndex((p) => p.key === key),
        targetUnit: cls?.priorityChars?.find((p) => p.key === key)?.unit,
        source: 'manual',
      };
      setChars([...(m.characteristics ?? []), next]);
    };

    const extractFromDocs = () => {
      const docs = m.documents ?? [];
      const fresh: Characteristic[] = [];
      for (const d of docs) {
        if (!d.parsedText) continue;
        fresh.push(...parseCharacteristics(d.parsedText, cls, sub, d.id));
      }
      // Сохраняем зафиксированные экспертом значения, остальные — заменяем извлечёнными.
      const locked = (m.characteristics ?? []).filter((c) => c.lockedByExpert);
      const lockedKeys = new Set(locked.map((c) => c.key.toLowerCase()));
      const filtered = fresh.filter(
        (c) => !lockedKeys.has(c.key.toLowerCase()),
      );
      setChars([...locked, ...filtered]);
    };

    const buildPriorityKeys = (): Array<{ key: string; unit?: string }> => {
      const keys: Array<{ key: string; unit?: string }> = [];
      for (const p of cls?.priorityChars ?? []) keys.push({ key: p.key, unit: p.unit });
      for (const p of sub?.priorityChars ?? []) {
        if (!keys.find((k) => k.key === p.key)) keys.push({ key: p.key, unit: p.unit });
      }
      return keys;
    };

    const enrichFromWeb = async () => {
      if (!m.className) {
        alert('Сначала определите класс модели.');
        return;
      }
      const keys = buildPriorityKeys();
      if (!keys.length) {
        alert(
          'Не заданы приоритетные характеристики класса/подкласса. Загрузите классификатор.',
        );
        return;
      }
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
        if (!items.length) {
          alert(
            'По модели не нашлось общедоступных данных. Попробуйте уточнить код модели или класс.',
          );
          return;
        }
        const existing = m.characteristics ?? [];
        const locked = existing.filter((c) => c.lockedByExpert);
        const lockedKeys = new Set(locked.map((c) => c.key.toLowerCase()));
        // Берём существующие НЕ-приоритетные характеристики и НЕ-перезаписываемые ручные значения
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
        setChars([...locked, ...keepManual, ...webChars]);
      } catch (e) {
        alert('Ошибка ИИ: ' + (e as Error).message);
      }
    };

    const aiExtract = async () => {
      const docs = m.documents ?? [];
      const text = docs
        .map((d) => d.parsedText || '')
        .filter(Boolean)
        .join('\n\n');
      if (!text.trim()) {
        alert(
          'Нет распознанного текста. Загрузите документ во вкладке «Документы».',
        );
        return;
      }
      const keys = buildPriorityKeys();
      if (!keys.length) {
        alert(
          'Не заданы приоритетные характеристики класса/подкласса. Загрузите классификатор.',
        );
        return;
      }
      try {
        const items = await aiProvider().extractCharacteristics({
          text,
          keys,
        });
        if (!items.length) {
          alert('ИИ не нашёл значений в документе.');
          return;
        }
        const locked = (m.characteristics ?? []).filter((c) => c.lockedByExpert);
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
        setChars([...locked, ...aiChars]);
      } catch (e) {
        alert('Ошибка ИИ: ' + (e as Error).message);
      }
    };

    const fillFromDb = async () => {
      const code = m.normalizedCode || m.rawCode;
      if (!code) {
        alert('У модели нет кода — заполните «Код» во вкладке «Свойства».');
        return;
      }
      setDbBusy(true);
      try {
        const db = await loadModelsDb();
        const hit = lookupModel(db, m.rawCode, m.normalizedCode);
        if (!hit) {
          alert(
            `В базе моделей нет записи по коду «${code}». ` +
              `Проверьте написание или используйте «Обогатить из интернета».`,
          );
          return;
        }
        const priorityKeys = buildPriorityKeys();
        const locked = (m.characteristics ?? []).filter((c) => c.lockedByExpert);
        const lockedKeys = new Set(locked.map((c) => c.key.toLowerCase()));
        const fromDb: Characteristic[] = [];
        for (const [k, v] of Object.entries(hit.entry.chars)) {
          if (lockedKeys.has(k.toLowerCase())) continue;
          const priorityIdx = priorityKeys.findIndex(
            (p) => p.key.toLowerCase() === k.toLowerCase(),
          );
          fromDb.push({
            id: newId('c'),
            key: k,
            valueRaw: v.v,
            unit: v.u,
            targetUnit:
              priorityIdx >= 0 ? priorityKeys[priorityIdx].unit : undefined,
            isPriority: priorityIdx >= 0,
            priorityOrder: priorityIdx >= 0 ? priorityIdx : undefined,
            source: 'database' as const,
          });
        }
        if (!fromDb.length) {
          alert('Запись в базе пуста.');
          return;
        }
        setChars([...locked, ...fromDb]);
        const matchNote =
          hit.code === (m.normalizedCode || normalizeModelCode(m.rawCode || '').code)
            ? 'точное совпадение по коду'
            : `совпадение «${hit.code}» (${hit.entry.raw})`;
        // Уведомление через console (без модалок) — заголовок и так показывает источник.
        console.info(
          `[Модели] ${m.rawCode}: ${fromDb.length} характеристик из базы (${matchNote})`,
        );
      } catch (e) {
        alert('Ошибка загрузки базы моделей: ' + (e as Error).message);
      } finally {
        setDbBusy(false);
      }
    };

    return (
      <div>
        <div className="row-flex" style={{ gap: 6, marginBottom: 6 }}>
          <button
            onClick={fillFromDb}
            disabled={dbBusy || !(m.normalizedCode || m.rawCode)}
            title={
              !(m.normalizedCode || m.rawCode)
                ? 'У модели нет кода'
                : 'Заполнить характеристики из встроенной базы 35 000+ моделей оборудования (без обращения к ИИ)'
            }
          >
            {dbBusy ? '⏳ Загрузка базы…' : '📚 Из базы моделей'}
          </button>
          <button
            onClick={extractFromDocs}
            disabled={!(m.documents ?? []).some((d) => d.parsedText)}
            title="Парсить характеристики из распознанного текста документов"
          >
            Извлечь из документов
          </button>
          <button
            onClick={aiExtract}
            disabled={
              !getApiKey() || !(m.documents ?? []).some((d) => d.parsedText)
            }
            title={
              !getApiKey()
                ? 'Подключите OpenAI ключ в кнопке «ИИ» в шапке'
                : 'Извлечь характеристики через ИИ — фоллбек, если парсер пуст'
            }
          >
            Извлечь через ИИ
          </button>
          <button
            onClick={enrichFromWeb}
            disabled={!getApiKey() || !m.className}
            title={
              !getApiKey()
                ? 'Подключите OpenAI ключ в «Настройках»'
                : !m.className
                  ? 'Сначала определите класс модели'
                  : 'Обогатить характеристики типовыми значениями из общедоступных каталогов и руководств производителей (п.6.3 ТЗ)'
            }
          >
            Обогатить из интернета
          </button>
          <button
            onClick={() => {
              // Нормализация наименований и единиц по правилам п.8.5–8.6.
              const next = (m.characteristics ?? []).map((c) => ({
                ...c,
                key: normalizeCharName(c.key),
                unit: normalizeUnit(c.unit),
                targetUnit: normalizeUnit(c.targetUnit),
              }));
              setChars(next);
            }}
            disabled={(m.characteristics ?? []).length === 0}
            title="Нормализовать наименования характеристик и единицы измерения по правилам п.8.5–8.6 ТЗ."
          >
            🪄 Нормализовать
          </button>
          {missing.length > 0 && (
            <span className="muted small">
              Не заполнено приоритетных: {missing.length}
            </span>
          )}
        </div>
        <table className="models">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th style={{ width: 230 }}>Характеристика</th>
              <th style={{ width: 110 }}>Значение</th>
              <th style={{ width: 80 }}>Ед.</th>
              <th style={{ width: 100 }}>Норм.</th>
              <th style={{ width: 90 }}>Источник</th>
              <th style={{ width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {chars.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Характеристики не извлечены. Привяжите документ во вкладке
                  «Документы» и нажмите «Извлечь из документов».
                </td>
              </tr>
            )}
            {chars.map((c) => {
              const norm = parseValue(c.valueRaw);
              return (
                <tr key={c.id} className={c.isPriority ? 'priority' : ''}>
                  <td title={c.isPriority ? 'Приоритетная' : ''}>
                    {c.isPriority ? '★' : ''}
                  </td>
                  <td>
                    <input
                      value={c.key}
                      onChange={(e) =>
                        updateChar(c.id, { key: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="mono"
                      value={c.valueRaw}
                      onChange={(e) => {
                        const pv = parseValue(e.target.value);
                        updateChar(c.id, {
                          valueRaw: e.target.value,
                          valueNum: pv.num,
                          unit: pv.unit ?? c.unit,
                        });
                      }}
                    />
                  </td>
                  <td className="muted small">
                    {c.unit ?? '—'}
                    {c.targetUnit && c.unit && c.unit !== c.targetUnit && (
                      <span className="warn-text" title="Не совпадает с целевой">
                        {' '}
                        → {c.targetUnit}
                      </span>
                    )}
                  </td>
                  <td className="mono small">
                    {fmtNum(norm.num) ||
                      (c.valueNum !== undefined ? fmtNum(c.valueNum) : '—')}
                  </td>
                  <td className="muted small">
                    <SourceBadge source={c.source} />
                    <button
                      className="link-btn"
                      title="Окно с обоснованием (п.7.5 ТЗ): фрагмент документа, источник или правило, на основании которого заполнено поле."
                      style={{ marginLeft: 4 }}
                      onClick={() =>
                        setExcerpt({
                          key: c.key,
                          value: c.valueRaw,
                          docId: c.documentId ?? '',
                        })
                      }
                    >
                      📎
                    </button>
                    {c.lockedByExpert ? ' 🔒' : ''}
                  </td>
                  <td>
                    <button
                      title={
                        c.lockedByExpert
                          ? 'Снять фиксацию'
                          : 'Зафиксировать экспертом'
                      }
                      onClick={() =>
                        updateChar(c.id, { lockedByExpert: !c.lockedByExpert })
                      }
                    >
                      {c.lockedByExpert ? '🔒' : '○'}
                    </button>
                    <button
                      className="danger"
                      onClick={() => removeChar(c.id)}
                      style={{ marginLeft: 2 }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {missing.length > 0 && (
          <div className="add-row">
            <span className="muted small">Добавить приоритетную:</span>
            {missing.map((p) => (
              <button key={p.key} onClick={() => addManual(p.key)}>
                + {p.key}
              </button>
            ))}
          </div>
        )}
        {excerpt && (
          <DocExcerptModal
            doc={(m.documents ?? []).find((d) => d.id === excerpt.docId)}
            charKey={excerpt.key}
            charValue={excerpt.value}
            char={(m.characteristics ?? []).find(
              (c) => c.key === excerpt.key,
            )}
            allDocs={m.documents ?? []}
            onClose={() => setExcerpt(null)}
          />
        )}
      </div>
    );
  }

  function SpecsTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const allModels = useStore((s) => s.models);
    const upsertTcRow = useStore((s) => s.upsertTechCardRow);
    const [busy, setBusy] = useState<'bom' | 'apl' | null>(null);
    const [webSuggestions, setWebSuggestions] = useState<{
      mode: 'bom' | 'apl';
      items: Array<{
        actionId?: string;
        actionName?: string;
        tmcName: string;
        tmcKind: 'material' | 'spare';
        tmcUnit?: string;
        tmcQty?: number;
        confidence?: number;
        reason?: string;
      }>;
    } | null>(null);
    const [analogsOpen, setAnalogsOpen] = useState<'bom' | 'apl' | null>(null);
    if (!m) return null;
    const rows = m.techCard ?? [];
    const acts = m.actions ?? [];
    const hasKey = !!getApiKey();

    async function enrichFromWeb(mode: 'bom' | 'apl') {
      if (!m || busy) return;
      if (!hasKey) {
        alert('Укажите OpenAI ключ в «Настройках».');
        return;
      }
      setBusy(mode);
      try {
        const items = await aiProvider().enrichBomFromWeb({
          model: {
            className: m.className,
            subclassName: m.subclassName,
            normalizedCode: m.normalizedCode,
            rawCode: m.rawCode,
          },
          actions: acts.map((a) => ({ id: a.id, name: a.name })),
          mode,
        });
        if (items.length === 0) {
          alert(
            'Из открытых источников не удалось предложить позиции — попробуйте указать класс/подкласс точнее.',
          );
        } else {
          setWebSuggestions({ mode, items });
        }
      } catch (e) {
        alert(
          'Ошибка обогащения из интернета: ' +
            (e instanceof Error ? e.message : String(e)),
        );
      } finally {
        setBusy(null);
      }
    }

    // BOM = плоский список всех ТМЦ из техкарт, агрегированный по
    // (наименование + ед.); инструмент в спецификацию не попадает (п.6.6 + созвон).
    type BomKey = string;
    const bomMap = new Map<
      BomKey,
      { name: string; kind: 'material' | 'spare'; unit?: string; qty: number; refs: number }
    >();
    for (const r of rows) {
      if (!r.tmcName || !r.tmcKind) continue;
      const key = `${r.tmcName.trim().toLowerCase()}|${(r.tmcUnit ?? '').toLowerCase()}|${r.tmcKind}`;
      const cur = bomMap.get(key);
      const qty = r.tmcQty ?? 0;
      if (cur) {
        cur.qty += qty;
        cur.refs += 1;
      } else {
        bomMap.set(key, {
          name: r.tmcName.trim(),
          kind: r.tmcKind,
          unit: r.tmcUnit,
          qty,
          refs: 1,
        });
      }
    }
    const bom = Array.from(bomMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'ru'),
    );

    // APL (Application Parts List, п.6.6 / п.4 ТЗ) = «список компонентов для ВВ
    // ТОиР, БЕЗ расходных материалов» — поэтому группируем по ВВ и фильтруем
    // tmcKind === 'spare'. Расходники (масла, прокладки, фильтры) идут в BOM.
    const aplGroups = new Map<
      string,
      { actionName: string; actionKind?: ActionKind; items: typeof bom }
    >();
    for (const r of rows) {
      if (!r.tmcName || r.tmcKind !== 'spare') continue;
      const act = r.actionId ? acts.find((a) => a.id === r.actionId) : undefined;
      const groupId = act?.id ?? '__none__';
      const groupName = act?.name ?? 'Без привязки к ВВ';
      const groupKind = act?.kind;
      let g = aplGroups.get(groupId);
      if (!g) {
        g = { actionName: groupName, actionKind: groupKind, items: [] };
        aplGroups.set(groupId, g);
      }
      const found = g.items.find(
        (x) =>
          x.name.toLowerCase() === r.tmcName!.trim().toLowerCase() &&
          (x.unit ?? '').toLowerCase() === (r.tmcUnit ?? '').toLowerCase() &&
          x.kind === r.tmcKind,
      );
      if (found) {
        found.qty += r.tmcQty ?? 0;
        found.refs += 1;
      } else {
        g.items.push({
          name: r.tmcName.trim(),
          kind: r.tmcKind,
          unit: r.tmcUnit,
          qty: r.tmcQty ?? 0,
          refs: 1,
        });
      }
    }
    const aplCount = Array.from(aplGroups.values()).reduce(
      (sum, g) => sum + g.items.length,
      0,
    );

    // AOPL (Aggregate-Operation Parts List, п.6.6 ТЗ) = запчасти/материалы
    // в разрезе компонент агрегата (Элемент → Подэлемент). Помогает понять,
    // какие ТМЦ нужны для каждой части агрегата вне зависимости от ВВ.
    const aoplGroups = new Map<
      string,
      {
        component: string;
        subcomponent?: string;
        items: Array<{
          name: string;
          kind: 'material' | 'spare';
          unit?: string;
          qty: number;
          refs: number;
        }>;
      }
    >();
    for (const r of rows) {
      if (!r.tmcName || !r.tmcKind) continue;
      if (!r.component) continue;
      const key = `${r.component.trim().toLowerCase()}|${(r.subcomponent ?? '').trim().toLowerCase()}`;
      let g = aoplGroups.get(key);
      if (!g) {
        g = {
          component: r.component.trim(),
          subcomponent: r.subcomponent?.trim() || undefined,
          items: [],
        };
        aoplGroups.set(key, g);
      }
      const found = g.items.find(
        (x) =>
          x.name.toLowerCase() === r.tmcName!.trim().toLowerCase() &&
          (x.unit ?? '').toLowerCase() === (r.tmcUnit ?? '').toLowerCase() &&
          x.kind === r.tmcKind,
      );
      if (found) {
        found.qty += r.tmcQty ?? 0;
        found.refs += 1;
      } else {
        g.items.push({
          name: r.tmcName.trim(),
          kind: r.tmcKind,
          unit: r.tmcUnit,
          qty: r.tmcQty ?? 0,
          refs: 1,
        });
      }
    }
    const aoplCount = Array.from(aoplGroups.values()).reduce(
      (sum, g) => sum + g.items.length,
      0,
    );

    const exportXlsx = () => {
      const ws1 = XLSX.utils.json_to_sheet(
        bom.map((x) => ({
          Наименование: x.name,
          Тип: x.kind === 'material' ? 'материал' : 'запчасть',
          Ед: x.unit ?? '',
          Кол_во: x.qty,
          В_тех_картах: x.refs,
        })),
      );
      const aplRows: Array<Record<string, string | number>> = [];
      for (const g of aplGroups.values()) {
        for (const x of g.items) {
          aplRows.push({
            ВВ: g.actionName,
            Тип_ВВ: g.actionKind ?? '',
            Наименование: x.name,
            Тип: x.kind === 'material' ? 'материал' : 'запчасть',
            Ед: x.unit ?? '',
            Кол_во: x.qty,
          });
        }
      }
      const ws2 = XLSX.utils.json_to_sheet(aplRows);
      const aoplRows: Array<Record<string, string | number>> = [];
      for (const g of aoplGroups.values()) {
        for (const x of g.items) {
          aoplRows.push({
            Элемент: g.component,
            Подэлемент: g.subcomponent ?? '',
            Наименование: x.name,
            Тип: x.kind === 'material' ? 'материал' : 'запчасть',
            Ед: x.unit ?? '',
            Кол_во: x.qty,
          });
        }
      }
      const ws3 = XLSX.utils.json_to_sheet(aoplRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'BOM');
      XLSX.utils.book_append_sheet(wb, ws2, 'APL');
      XLSX.utils.book_append_sheet(wb, ws3, 'AOPL');
      XLSX.writeFile(
        wb,
        `Спецификация_${m.normalizedCode || m.rawCode}.xlsx`,
      );
    };

    const isEmpty = rows.length === 0;

    return (
      <div>
        <div className="row-flex" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <span className="muted small">
            {isEmpty
              ? 'Техкарт нет. Дополните спецификацию из интернета или из аналогов — позиции добавятся в техкарты автоматически.'
              : `BOM: ${bom.length} · APL: ${aplCount} в ${aplGroups.size} ВВ · AOPL: ${aoplCount} в ${aoplGroups.size} компонент(ах) · из ${rows.length} строк техкарт. Инструмент в спецификацию не попадает (п.6.6 ТЗ).`}
          </span>
          <span className="spacer" />
          <button onClick={exportXlsx} disabled={!bom.length}>
            Экспорт xlsx
          </button>
        </div>
        <div className="row-flex" style={{ gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            disabled={!hasKey || !!busy || acts.length === 0}
            title={
              !hasKey
                ? 'Укажите OpenAI ключ в «Настройках»'
                : acts.length === 0
                  ? 'Сначала добавьте ВВ во вкладке «ВВ»'
                  : 'Дополнить BOM типовыми позициями из открытых источников (п.6.6 ТЗ)'
            }
            onClick={() => enrichFromWeb('bom')}
          >
            {busy === 'bom' ? '…' : 'BOM из интернета'}
          </button>
          <button
            disabled={!hasKey || !!busy || acts.length === 0}
            title={
              !hasKey
                ? 'Укажите OpenAI ключ в «Настройках»'
                : acts.length === 0
                  ? 'Сначала добавьте ВВ во вкладке «ВВ»'
                  : 'Дополнить APL типовыми запчастями из открытых источников (п.6.6 ТЗ)'
            }
            onClick={() => enrichFromWeb('apl')}
          >
            {busy === 'apl' ? '…' : 'APL из интернета'}
          </button>
          <button
            disabled={!m.className}
            title={
              !m.className
                ? 'Сначала классифицируйте модель'
                : 'Найти аналоги BOM в других моделях того же класса/подкласса'
            }
            onClick={() => setAnalogsOpen('bom')}
          >
            Поиск аналогов BOM
          </button>
          <button
            disabled={!m.className}
            title={
              !m.className
                ? 'Сначала классифицируйте модель'
                : 'Найти аналоги APL в других моделях того же класса/подкласса'
            }
            onClick={() => setAnalogsOpen('apl')}
          >
            Поиск аналогов APL
          </button>
        </div>

        <h4 style={{ margin: '8px 0 4px' }}>BOM — все ТМЦ (материалы + запчасти)</h4>
        <table className="models">
          <thead>
            <tr>
              <th>Наименование</th>
              <th style={{ width: 90 }}>Тип</th>
              <th style={{ width: 80 }}>Ед.</th>
              <th style={{ width: 80 }}>Кол-во</th>
              <th style={{ width: 110 }}>В техкартах</th>
            </tr>
          </thead>
          <tbody>
            {bom.map((x, i) => (
              <tr key={i}>
                <td>{x.name}</td>
                <td>{x.kind === 'material' ? 'материал' : 'запчасть'}</td>
                <td>{x.unit ?? '—'}</td>
                <td className="mono">{fmtQty(x.qty)}</td>
                <td className="muted small">{x.refs}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ margin: '12px 0 4px' }}>
          APL — запчасти в разрезе ВВ (без расходных материалов)
        </h4>
        {Array.from(aplGroups.values()).map((g, gi) => (
          <div key={gi} style={{ marginBottom: 8 }}>
            <div className="muted small" style={{ marginBottom: 2 }}>
              <b>{g.actionName}</b>
              {g.actionKind ? ` · ${labelKind(g.actionKind)}` : ''} ·
              {' '}
              {g.items.length} позиц.
            </div>
            <table className="models">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th style={{ width: 90 }}>Тип</th>
                  <th style={{ width: 80 }}>Ед.</th>
                  <th style={{ width: 80 }}>Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((x, i) => (
                  <tr key={i}>
                    <td>{x.name}</td>
                    <td>
                      {x.kind === 'material' ? 'материал' : 'запчасть'}
                    </td>
                    <td>{x.unit ?? '—'}</td>
                    <td className="mono">{fmtQty(x.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <h4 style={{ margin: '12px 0 4px' }}>
          AOPL — детали в разрезе компонент агрегата
        </h4>
        {aoplGroups.size === 0 && (
          <div className="muted small">
            Не заполнено: добавьте «Элемент» в строки техкарты — AOPL соберётся автоматически.
          </div>
        )}
        {Array.from(aoplGroups.values()).map((g, gi) => (
          <div key={`aopl-${gi}`} style={{ marginBottom: 8 }}>
            <div className="muted small" style={{ marginBottom: 2 }}>
              <b>{g.component}</b>
              {g.subcomponent ? ` / ${g.subcomponent}` : ''} · {g.items.length} позиц.
            </div>
            <table className="models">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th style={{ width: 90 }}>Тип</th>
                  <th style={{ width: 80 }}>Ед.</th>
                  <th style={{ width: 80 }}>Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((x, i) => (
                  <tr key={i}>
                    <td>{x.name}</td>
                    <td>{x.kind === 'material' ? 'материал' : 'запчасть'}</td>
                    <td>{x.unit ?? '—'}</td>
                    <td className="mono">{fmtQty(x.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {webSuggestions && (
          <BomSuggestionsModal
            modelId={modelId}
            mode={webSuggestions.mode}
            items={webSuggestions.items}
            actions={acts}
            onAccept={(picked) => {
              for (const x of picked) {
                upsertTcRow(modelId, {
                  actionId: x.actionId,
                  tmcName: x.tmcName,
                  tmcKind: x.tmcKind,
                  tmcUnit: x.tmcUnit,
                  tmcQty: x.tmcQty,
                  source: 'web',
                });
              }
              setWebSuggestions(null);
            }}
            onClose={() => setWebSuggestions(null)}
          />
        )}
        {analogsOpen && (
          <BomAnalogsModal
            modelId={modelId}
            mode={analogsOpen}
            currentModel={m}
            allModels={allModels}
            onAccept={(picked) => {
              for (const x of picked) {
                upsertTcRow(modelId, {
                  actionId: x.actionId,
                  tmcName: x.tmcName,
                  tmcKind: x.tmcKind,
                  tmcUnit: x.tmcUnit,
                  tmcQty: x.tmcQty,
                  source: 'analog',
                });
              }
              setAnalogsOpen(null);
            }}
            onClose={() => setAnalogsOpen(null)}
          />
        )}
      </div>
    );
  }

  function PprTab({ modelId }: { modelId: string }) {
    const m = useStore((s) => s.models.find((x) => x.id === modelId));
    const [horizonYears, setHorizonYears] = useState(2);
    const [startStr, setStartStr] = useState(() =>
      new Date().toISOString().slice(0, 10),
    );
    if (!m) return null;
    const acts = (m.actions ?? []).filter((a) => a.periodHours && a.periodHours > 0);
    if (acts.length === 0) {
      return (
        <div className="muted">
          Нет ВВ с периодичностью. Загрузите файл «Виды воздействия на ТОР
          ист/инт.xlsx» или добавьте ВВ во вкладке «ВВ».
        </div>
      );
    }
    // Календарь ППР: для каждого ВВ выводим даты следующих исполнений
    // на горизонте N лет, считая по периодичности от стартовой даты.
    // Допущение: 24 ч работы в сутки (для оборудования непрерывного
    // режима — типовое предположение, можно изменить через атрибут модели).
    const hoursPerDay = 24;
    const start = new Date(startStr);
    const horizonDays = horizonYears * 365;
    type Ev = { actionId: string; name: string; kind?: ActionKind; date: Date };
    const events: Ev[] = [];
    for (const a of acts) {
      const periodDays = (a.periodHours as number) / hoursPerDay;
      let day = periodDays;
      while (day <= horizonDays) {
        const d = new Date(start);
        d.setDate(d.getDate() + Math.round(day));
        events.push({ actionId: a.id, name: a.name, kind: a.kind, date: d });
        day += periodDays;
      }
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    // Группируем по годам и месяцам.
    const byYearMonth = new Map<string, Ev[]>();
    for (const e of events) {
      const k = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, '0')}`;
      (byYearMonth.get(k) ?? byYearMonth.set(k, []).get(k)!).push(e);
    }
    return (
      <div>
        <div className="row-flex" style={{ gap: 8, marginBottom: 8 }}>
          <label className="row-flex" style={{ gap: 4 }}>
            Старт
            <input
              type="date"
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
            />
          </label>
          <label className="row-flex" style={{ gap: 4 }}>
            Горизонт, лет
            <select
              value={horizonYears}
              onChange={(e) => setHorizonYears(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
            </select>
          </label>
          <span className="muted small">
            ВВ с периодичностью: {acts.length} · событий на горизонте:{' '}
            {events.length} · режим: 24 ч/сут
          </span>
        </div>
        <table className="models">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Месяц</th>
              <th>События</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byYearMonth.entries()).map(([ym, evs]) => (
              <tr key={ym}>
                <td className="mono">{ym}</td>
                <td>
                  {evs.map((e, i) => (
                    <span
                      key={i}
                      className="chip"
                      title={`${e.kind ?? ''} · ${e.date.toLocaleDateString('ru')}`}
                      style={{ marginRight: 4, marginBottom: 2, display: 'inline-block' }}
                    >
                      {e.date.getDate().toString().padStart(2, '0')}.{String(e.date.getMonth() + 1).padStart(2, '0')} · {e.name}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('ru', { maximumFractionDigits: 3 });
}

function labelKind(k: ActionKind): string {
  switch (k) {
    case 'TO':
      return 'ТО';
    case 'repair':
      return 'Ремонт';
    case 'inspection':
      return 'Осмотр';
    case 'diagnostic':
      return 'Диагностика';
    default:
      return 'Прочее';
  }
}

function summarizeBySource(items: ActionItem[]): string {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.source, (counts.get(it.source) ?? 0) + 1);
  if (!counts.size) return 'нет';
  return Array.from(counts.entries())
    .map(([s, n]) => `${labelSource(s as ActionItem['source'])}: ${n}`)
    .join(', ');
}

function labelSource(s: ActionItem['source']): string {
  switch (s) {
    case 'analog':
      return 'ист';
    case 'web':
      return 'инт';
    case 'document':
      return 'документ';
    case 'classifier':
      return 'классификатор';
    case 'manual':
      return 'ручной';
    case 'ai':
      return 'ИИ';
    case 'database':
      return 'база моделей';
    default:
      return String(s);
  }
}

/** Общая обёртка модального окна (затемнение + стоп-пропагация). */
function ModalShell({
  title,
  onClose,
  children,
  width = 760,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          padding: 14,
          minWidth: 520,
          maxWidth: width,
          width,
          maxHeight: '85vh',
          overflow: 'auto',
          border: '1px solid #999',
        }}
      >
        <div className="row-flex" style={{ alignItems: 'center', gap: 6 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <span className="spacer" />
          <button onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Модалка «Предложения BOM/APL из интернета» — выбор позиций и добавление. */
function BomSuggestionsModal({
  mode,
  items,
  actions,
  onAccept,
  onClose,
}: {
  modelId: string;
  mode: 'bom' | 'apl';
  items: Array<{
    actionId?: string;
    actionName?: string;
    tmcName: string;
    tmcKind: 'material' | 'spare';
    tmcUnit?: string;
    tmcQty?: number;
    confidence?: number;
    reason?: string;
  }>;
  actions: ActionItem[];
  onAccept: (
    picked: Array<{
      actionId?: string;
      tmcName: string;
      tmcKind: 'material' | 'spare';
      tmcUnit?: string;
      tmcQty?: number;
    }>,
  ) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(items.map((_, i) => i)),
  );
  const toggle = (i: number) => {
    const next = new Set(checked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setChecked(next);
  };
  const picked = items.filter((_, i) => checked.has(i));
  const titlePrefix = mode === 'bom' ? 'BOM' : 'APL';
  return (
    <ModalShell
      title={`${titlePrefix} из интернета — выбор позиций`}
      onClose={onClose}
    >
      <div className="muted small" style={{ margin: '6px 0' }}>
        Отметьте позиции, которые добавить в техкарту с источником «инт.»
        (фиолетовый бейдж). Привязка к ВВ берётся из ответа провайдера.
      </div>
      <table className="models">
        <thead>
          <tr>
            <th style={{ width: 28 }}>+</th>
            <th>Наименование</th>
            <th style={{ width: 80 }}>Тип</th>
            <th style={{ width: 70 }}>Ед.</th>
            <th style={{ width: 60 }}>Кол.</th>
            <th>ВВ</th>
            <th style={{ width: 56 }}>Conf.</th>
          </tr>
        </thead>
        <tbody>
          {items.map((x, i) => {
            const act = x.actionId
              ? actions.find((a) => a.id === x.actionId)
              : undefined;
            return (
              <tr key={i} title={x.reason ?? ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={checked.has(i)}
                    onChange={() => toggle(i)}
                  />
                </td>
                <td>{x.tmcName}</td>
                <td>
                  {x.tmcKind === 'material' ? 'материал' : 'запчасть'}
                </td>
                <td>{x.tmcUnit ?? '—'}</td>
                <td className="mono">{x.tmcQty ?? '—'}</td>
                <td className="muted small">{act?.name ?? x.actionName ?? '—'}</td>
                <td className="mono small">
                  {x.confidence !== undefined
                    ? Math.round(x.confidence * 100) + '%'
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div
        className="row-flex"
        style={{ marginTop: 10, gap: 6, justifyContent: 'flex-end' }}
      >
        <button onClick={onClose}>Отмена</button>
        <button
          disabled={picked.length === 0}
          onClick={() =>
            onAccept(
              picked.map((x) => ({
                actionId: x.actionId,
                tmcName: x.tmcName,
                tmcKind: x.tmcKind,
                tmcUnit: x.tmcUnit,
                tmcQty: x.tmcQty,
              })),
            )
          }
        >
          Добавить выбранные ({picked.length})
        </button>
      </div>
    </ModalShell>
  );
}

/** Модалка «Поиск аналогов BOM/APL» — поиск похожих моделей и копирование позиций. */
function BomAnalogsModal({
  modelId,
  mode,
  currentModel,
  allModels,
  onAccept,
  onClose,
}: {
  modelId: string;
  mode: 'bom' | 'apl';
  currentModel: import('../domain/types').EquipmentModel;
  allModels: import('../domain/types').EquipmentModel[];
  onAccept: (
    picked: Array<{
      actionId?: string;
      tmcName: string;
      tmcKind: 'material' | 'spare';
      tmcUnit?: string;
      tmcQty?: number;
    }>,
  ) => void;
  onClose: () => void;
}) {
  // Аналоги — модели того же класса/подкласса, исключая текущую.
  const analogs = allModels.filter(
    (x) =>
      x.id !== modelId &&
      x.className === currentModel.className &&
      (currentModel.subclassName == null ||
        x.subclassName === currentModel.subclassName),
  );

  // Соберём кандидатные ТМЦ из аналогов: уникальные по (name + unit + kind),
  // с подсчётом «у скольких аналогов встречается».
  type Cand = {
    actionId?: string;
    actionName?: string;
    tmcName: string;
    tmcKind: 'material' | 'spare';
    tmcUnit?: string;
    tmcQty?: number;
    sources: number; // у скольких моделей встретилась
    fromModels: string[];
  };
  const candMap = new Map<string, Cand>();
  for (const a of analogs) {
    const seenInThisModel = new Set<string>();
    for (const r of a.techCard ?? []) {
      if (!r.tmcName || !r.tmcKind) continue;
      if (mode === 'apl' && r.tmcKind !== 'spare') continue;
      const key = `${r.tmcName.trim().toLowerCase()}|${(r.tmcUnit ?? '').toLowerCase()}|${r.tmcKind}`;
      if (seenInThisModel.has(key)) continue;
      seenInThisModel.add(key);
      const exist = candMap.get(key);
      const actName = r.actionId
        ? a.actions?.find((x) => x.id === r.actionId)?.name
        : undefined;
      if (exist) {
        exist.sources += 1;
        exist.fromModels.push(a.normalizedCode || a.rawCode);
      } else {
        candMap.set(key, {
          tmcName: r.tmcName.trim(),
          tmcKind: r.tmcKind,
          tmcUnit: r.tmcUnit,
          tmcQty: r.tmcQty,
          actionName: actName,
          sources: 1,
          fromModels: [a.normalizedCode || a.rawCode],
        });
      }
    }
  }

  // Помечаем уже присутствующие позиции в нашей модели — чтобы не дублировать.
  const existingKeys = new Set(
    (currentModel.techCard ?? [])
      .filter((r) => r.tmcName && r.tmcKind)
      .map(
        (r) =>
          `${r.tmcName!.trim().toLowerCase()}|${(r.tmcUnit ?? '').toLowerCase()}|${r.tmcKind}`,
      ),
  );

  const candidates = Array.from(candMap.entries())
    .map(([key, v]) => ({ key, v, exists: existingKeys.has(key) }))
    .sort((a, b) => b.v.sources - a.v.sources);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (k: string) => {
    const next = new Set(checked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setChecked(next);
  };

  const titlePrefix = mode === 'bom' ? 'BOM' : 'APL';
  return (
    <ModalShell
      title={`Поиск аналогов ${titlePrefix} — ${analogs.length} модел${
        analogs.length === 1 ? 'ь' : 'и'
      } того же класса`}
      onClose={onClose}
      width={820}
    >
      <div className="muted small" style={{ margin: '6px 0' }}>
        Класс: <b>{currentModel.className ?? '—'}</b>
        {currentModel.subclassName && (
          <> · подкласс: <b>{currentModel.subclassName}</b></>
        )}
        . Источник позиций — <code>techCard</code> аналогов; подмеченные позиции
        копируются с источником «аналог» (красный бейдж).
      </div>
      {analogs.length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>
          Аналогов не найдено. Создайте ещё хотя бы одну модель того же
          класса/подкласса с заполненной техкартой.
        </div>
      ) : candidates.length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>
          Аналоги найдены, но в их техкартах нет {mode === 'apl' ? 'запчастей' : 'ТМЦ'}.
        </div>
      ) : (
        <table className="models">
          <thead>
            <tr>
              <th style={{ width: 28 }}>+</th>
              <th>Наименование</th>
              <th style={{ width: 80 }}>Тип</th>
              <th style={{ width: 70 }}>Ед.</th>
              <th style={{ width: 60 }}>Кол.</th>
              <th style={{ width: 64 }}>В моей</th>
              <th>Из моделей</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr
                key={c.key}
                style={c.exists ? { opacity: 0.5 } : undefined}
                title={c.exists ? 'Уже есть в текущей модели' : ''}
              >
                <td>
                  <input
                    type="checkbox"
                    disabled={c.exists}
                    checked={checked.has(c.key)}
                    onChange={() => toggle(c.key)}
                  />
                </td>
                <td>{c.v.tmcName}</td>
                <td>{c.v.tmcKind === 'material' ? 'материал' : 'запчасть'}</td>
                <td>{c.v.tmcUnit ?? '—'}</td>
                <td className="mono">{c.v.tmcQty ?? '—'}</td>
                <td className="mono small">{c.exists ? 'есть' : '—'}</td>
                <td className="muted small">
                  {c.v.fromModels.slice(0, 3).join(', ')}
                  {c.v.fromModels.length > 3 && ` +${c.v.fromModels.length - 3}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div
        className="row-flex"
        style={{ marginTop: 10, gap: 6, justifyContent: 'flex-end' }}
      >
        <button onClick={onClose}>Закрыть</button>
        <button
          disabled={checked.size === 0}
          onClick={() => {
            const picked: Array<{
              actionId?: string;
              tmcName: string;
              tmcKind: 'material' | 'spare';
              tmcUnit?: string;
              tmcQty?: number;
            }> = [];
            for (const c of candidates) {
              if (!checked.has(c.key) || c.exists) continue;
              picked.push({
                tmcName: c.v.tmcName,
                tmcKind: c.v.tmcKind,
                tmcUnit: c.v.tmcUnit,
                tmcQty: c.v.tmcQty,
              });
            }
            onAccept(picked);
          }}
        >
          Скопировать выбранные ({checked.size})
        </button>
      </div>
    </ModalShell>
  );
}

/** Окно с фрагментом документа, на основании которого получено значение
 * (п.7 ТЗ — «Окно с выводом части документа на основании которого
 * сгенерированы данные с применением сигнальных символов»). */
function DocExcerptModal({
  doc,
  charKey,
  charValue,
  char,
  allDocs,
  onClose,
}: {
  doc?: DocumentRef;
  charKey: string;
  charValue: string;
  char?: Characteristic;
  allDocs?: DocumentRef[];
  onClose: () => void;
}) {
  // Если документ не привязан напрямую — попробуем найти первый
  // документ, в котором встречается ключ/значение (п.7.5 ТЗ — окно
  // с цитатой документа должно работать, даже если документ привязан
  // через индекс, а не явный link).
  const keyLc = charKey.toLowerCase();
  const valLc = (charValue ?? '').toLowerCase();
  const fallback = !doc
    ? (allDocs ?? []).find((d) => {
        const t = (d.parsedText ?? '').toLowerCase();
        return (keyLc && t.includes(keyLc)) || (valLc && t.includes(valLc));
      })
    : undefined;
  const usedDoc = doc ?? fallback;
  const text = usedDoc?.parsedText ?? '';
  const lines = text.split(/\r?\n/);
  // Помечаем строки, в которых упомянут ключ или значение.
  const matches: Array<{ idx: number; line: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const lc = lines[i].toLowerCase();
    if ((keyLc && lc.includes(keyLc)) || (valLc && lc.includes(valLc))) {
      matches.push({ idx: i, line: lines[i] });
    }
  }
  const sourceExplain: Record<string, string> = {
    document: 'Извлечено парсером из загруженного документа.',
    web: 'Получено из общедоступных источников через ИИ-поиск (gpt-4o + интернет).',
    ai: 'Сгенерировано ИИ-моделью (gpt-4o) на основе паспортных данных и общедоступных каталогов.',
    classifier: 'Привязано классификатором по ключевым словам / regex.',
    manual: 'Внесено вручную пользователем.',
    analog: 'Получено по аналогии — взято из модели того же класса/подкласса.',
    database: 'Совпадение по нормализованному коду в офлайн-базе моделей (35 181 запись).',
  };
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          padding: 14,
          minWidth: 520,
          maxWidth: 760,
          maxHeight: '80vh',
          overflow: 'auto',
          border: '1px solid #999',
        }}
      >
        <div className="row-flex" style={{ alignItems: 'center', gap: 6 }}>
          <h3 style={{ margin: 0 }}>
            Обоснование значения · п.7.5 ТЗ
          </h3>
          <span className="spacer" />
          <button onClick={onClose}>×</button>
        </div>
        <div className="muted small" style={{ marginTop: 4 }}>
          «<b>{charKey}</b>» = <b>{charValue || '—'}</b>
          {char?.source && (
            <>
              {' · '}
              <SourceBadge source={char.source} />
            </>
          )}
          {usedDoc?.url && (
            <>
              {' · '}
              <a href={usedDoc.url} target="_blank" rel="noreferrer">
                открыть документ
              </a>
            </>
          )}
          {usedDoc?.filename && <> · {usedDoc.filename}</>}
        </div>
        {char?.source && (
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: 'var(--bg-alt)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          >
            <div className="muted small" style={{ marginBottom: 4 }}>
              Тип источника: <b>{char.source}</b>
            </div>
            <div className="small">{sourceExplain[char.source] ?? '—'}</div>
            {char.lockedByExpert && (
              <div className="small" style={{ marginTop: 4 }}>
                🔒 Зафиксировано экспертом — автоматика не перезапишет.
              </div>
            )}
          </div>
        )}
        {!usedDoc && (
          <div className="muted small" style={{ marginTop: 8 }}>
            К этой строке документ не привязан. Если значение должно быть
            проверено по паспорту — загрузите PDF/DOCX во вкладке «Документы»,
            и тогда здесь появится цитата.
          </div>
        )}
        {usedDoc && !text.trim() && (
          <div className="muted" style={{ marginTop: 8 }}>
            Распознанный текст для документа отсутствует. Откройте «Документы» →
            «вставить…» и вставьте текст вручную, либо загрузите файл.
          </div>
        )}
        {usedDoc && text.trim() && (
          <div style={{ marginTop: 8 }}>
            {matches.length === 0 ? (
              <div className="muted small">
                Прямых упоминаний «{charKey}» / «{charValue}» в тексте не
                найдено. Полный текст ниже.
              </div>
            ) : (
              <div>
                <div className="muted small" style={{ marginBottom: 4 }}>
                  Найденные строки ({matches.length}):
                </div>
                <pre
                  className="mono small"
                  style={{
                    background: '#fffbe5',
                    border: '1px solid #d8c97a',
                    padding: 8,
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                  }}
                >
                  {matches
                    .map(({ idx, line }) => `стр. ${idx + 1}: ${line}`)
                    .join('\n')}
                </pre>
              </div>
            )}
            <details style={{ marginTop: 8 }}>
              <summary className="muted small">
                Полный распознанный текст ({text.length} симв.)
              </summary>
              <pre
                className="mono small"
                style={{
                  whiteSpace: 'pre-wrap',
                  background: 'var(--bg-alt)',
                  padding: 8,
                  margin: '4px 0 0',
                }}
              >
                {text}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

/** Бейдж источника информации (п.7 ТЗ — оценка качества данных). */
function SourceBadge({
  source,
  confidence,
  title,
}: {
  source?: string;
  confidence?: number;
  title?: string;
}) {
  if (!source) return null;
  const cls = `src-${source}`;
  const pct =
    typeof confidence === 'number' && confidence > 0 && confidence <= 1
      ? ` ${Math.round(confidence * 100)}%`
      : '';
  return (
    <span
      className={`src-badge ${cls}`}
      title={title ?? `Источник: ${labelSource(source as ActionItem['source'])}${pct ? `, уверенность${pct}` : ''}`}
    >
      {labelSource(source as ActionItem['source'])}
      {pct}
    </span>
  );
}

function humanDuration(hours: number): string {
  if (!isFinite(hours) || hours <= 0) return '—';
  if (hours < 24) return `${hours} ч`;
  const days = hours / 24;
  if (days < 31) return `${round(days)} дн`;
  const months = days / 30;
  if (months < 24) return `${round(months)} мес`;
  return `${round(months / 12)} лет`;
}
function round(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      title={hint}
      style={{
        border: '1px solid #ccc',
        padding: '4px 10px',
        minWidth: 100,
      }}
    >
      <div className="muted small">{label}</div>
      <div className="mono" style={{ fontSize: 16 }}>
        {value}
      </div>
    </div>
  );
}

function fmtHours(h: number | undefined | null): string {
  if (h == null || !isFinite(h)) return '—';
  if (h < 24) return `${round(h)} ч`;
  const days = h / 24;
  if (days < 60) return `${round(days)} дн`;
  const months = days / 30;
  if (months < 24) return `${round(months)} мес`;
  return `${round(months / 12)} лет`;
}

function computeDowntime(
  f: import('../domain/types').FailureRecord,
): number | undefined {
  if (f.downtimeHours != null) return f.downtimeHours;
  if (f.failedAt && f.restoredAt) {
    const a = Date.parse(f.failedAt);
    const b = Date.parse(f.restoredAt);
    if (isFinite(a) && isFinite(b) && b > a) return (b - a) / 36e5;
  }
  return undefined;
}

function computeReliability(
  failures: import('../domain/types').FailureRecord[],
): {
  count: number;
  spanDays?: number;
  mtbfHours?: number;
  mttrHours?: number;
  failureRatePerHour?: number;
} {
  if (!failures.length) return { count: 0 };
  const sorted = failures
    .filter((f) => f.failedAt)
    .map((f) => ({ ...f, ts: Date.parse(f.failedAt) }))
    .filter((f) => isFinite(f.ts))
    .sort((a, b) => a.ts - b.ts);
  if (!sorted.length) return { count: 0 };
  const first = sorted[0].ts;
  const last = sorted[sorted.length - 1].ts;
  const spanHours = Math.max(1, (last - first) / 36e5);
  const spanDays = spanHours / 24;
  const mtbfHours = sorted.length > 1 ? spanHours / (sorted.length - 1) : undefined;
  const downtimes = sorted
    .map((f) => computeDowntime(f))
    .filter((x): x is number => x != null && isFinite(x));
  const mttrHours = downtimes.length
    ? downtimes.reduce((s, x) => s + x, 0) / downtimes.length
    : undefined;
  const failureRatePerHour = mtbfHours ? 1 / mtbfHours : undefined;
  return {
    count: sorted.length,
    spanDays,
    mtbfHours,
    mttrHours,
    failureRatePerHour,
  };
}

function excelDate(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  // Excel сериализует даты как число дней с 1899-12-30.
  if (typeof v === 'number' && isFinite(v) && v > 25569 && v < 80000) {
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms).toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  // dd.mm.yyyy / dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (m) {
    const d = parseInt(m[1]);
    const mo = parseInt(m[2]) - 1;
    let y = parseInt(m[3]);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, mo, d));
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  const ts = Date.parse(s);
  if (isFinite(ts)) return new Date(ts).toISOString();
  return undefined;
}
