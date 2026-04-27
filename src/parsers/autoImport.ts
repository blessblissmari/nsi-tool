import * as XLSX from 'xlsx';
import { rowsToHierarchy, type ImportResult } from './hierarchy';
import { rowsToClassifier } from './classifier';
import { rowsToClassification, type ClassificationRow } from './classification';
import { rowsToActions, type ActionsImportRow } from './actions';
import { rowsToCharsImport, type CharsImportRow } from './charsImport';
import { parseReferenceFile, type ReferenceKind } from './references';
import type {
  Classifier,
  ReferenceData,
  SourceKind,
} from '../domain/types';

export type DetectedKind =
  | 'hierarchy'
  | 'classifier'
  | 'classification'
  | 'actions'
  | 'characteristics'
  | 'reference'
  | 'unknown';

export interface AutoImportResult {
  kind: DetectedKind;
  fileName: string;
  hierarchy?: ImportResult;
  classifier?: Classifier;
  classification?: ClassificationRow[];
  actions?: ActionsImportRow[];
  characteristics?: CharsImportRow[];
  reference?: { kind: ReferenceKind; data: Partial<ReferenceData> };
  message: string;
}

/**
 * Автоопределение типа файла по заголовкам колонок.
 *
 *  - «Уровень N» / «Предприятие/Завод/Цех/...» + (опц.) «Модель» → иерархия.
 *  - «Класс» + «Характеристика 1» (или «Ключевые слова»)         → классификатор.
 *  - «Класс» + «Подкласс» + «Модель» (без характеристик)         → привязки.
 */
export async function autoImportFile(file: File): Promise<AutoImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
  });
  const headers = Object.keys(rows[0] || {}).map((h) =>
    String(h).trim().toLowerCase(),
  );
  const has = (test: (h: string) => boolean) => headers.some(test);
  const hasLevel = has((h) => /^уровень\s*\d+/.test(h));
  const hasNamed = has((h) =>
    /^(предприятие|завод|цех|участок|группа|оборудование|компания|площадка|отделение|линия)$/.test(
      h,
    ),
  );
  const hasModel = has((h) => /^(модель|код модели|код)$/.test(h));
  const hasClass = has((h) => h === 'класс');
  const hasSubclass = has((h) => h === 'подкласс');
  const hasChar = has((h) => /^хар(акт)?[а-яё.-]*\s*\d+$/.test(h));
  const hasValue = has((h) => /^значени[ея]\s*\d+$/.test(h));
  const hasKw = has((h) => h === 'ключевые слова');
  const hasVV = has((h) => /^вв\s*\d+$/.test(h));

  // Сначала пробуем справочники (ВВ, операции, специальности, единицы измерения).
  // Реализация перебирает все листы файла, поэтому работает и с многолистовыми книгами.
  const ref = await parseReferenceFile(file);
  if (ref) {
    return {
      kind: 'reference',
      fileName: file.name,
      reference: { kind: ref.kind, data: ref.data },
      message: ref.message,
    };
  }

  // Характеристики моделей: «Характеристика N» + «Значение N» + «Ед.измерения N».
  if (hasModel && hasChar && hasValue) {
    const items = rowsToCharsImport(rows, 'document');
    return {
      kind: 'characteristics',
      fileName: file.name,
      characteristics: items,
      message: `Характеристики моделей: ${items.length}`,
    };
  }

  // ВВ имеет уникальный признак — колонки «ВВ N».
  if (hasVV && hasModel) {
    // «инт»/«интернет» в имени → web; «ист»/«история» → analog.
    const fnLower = file.name.toLowerCase();
    const src: SourceKind = /(^|[^а-яё])инт([^а-яё]|$)|интернет/.test(fnLower)
      ? 'web'
      : 'analog';
    const items = rowsToActions(rows, src);
    return {
      kind: 'actions',
      fileName: file.name,
      actions: items,
      message: `ВВ (${src === 'web' ? 'инт' : 'ист'}): ${items.length} моделей`,
    };
  }

  // Иерархия определяется первой: «Уровень N» или именованная иерархия имеют
  // приоритет над просто «Класс/Модель», т.к. файл «Иерархия с моделями.xlsx»
  // тоже может содержать колонку «Класс».
  if (hasLevel || hasNamed) {
    const r = rowsToHierarchy(rows);
    return {
      kind: 'hierarchy',
      fileName: file.name,
      hierarchy: r,
      message: `Иерархия: ${r.models.length} моделей`,
    };
  }
  if (hasClass && (hasChar || hasKw)) {
    const c = rowsToClassifier(rows);
    return {
      kind: 'classifier',
      fileName: file.name,
      classifier: c,
      message: `Классификатор: ${c.classes.length} классов, ${c.classes.reduce(
        (n, x) => n + x.subclasses.length,
        0,
      )} подклассов`,
    };
  }
  if (hasClass && hasModel && !hasChar) {
    const cls = rowsToClassification(rows);
    return {
      kind: 'classification',
      fileName: file.name,
      classification: cls,
      message: `Привязки модель→класс: ${cls.length}`,
    };
  }
  if (hasModel) {
    const r = rowsToHierarchy(rows);
    return {
      kind: 'hierarchy',
      fileName: file.name,
      hierarchy: r,
      message: `Иерархия: ${r.models.length} моделей`,
    };
  }
  // Эвристика последнего шанса: если есть «Класс»+«Подкласс» — классификатор без хар-к.
  if (hasClass && hasSubclass) {
    const c = rowsToClassifier(rows);
    return {
      kind: 'classifier',
      fileName: file.name,
      classifier: c,
      message: `Классификатор: ${c.classes.length} классов`,
    };
  }
  return {
    kind: 'unknown',
    fileName: file.name,
    message: `Не распознан формат «${file.name}»: колонки ${headers.join(', ') || '—'}`,
  };
}
