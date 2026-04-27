import * as XLSX from 'xlsx';
import type { EquipmentModel, HierarchyNode, NodeType } from '../domain/types';

let counter = 0;
const newId = (p: string) => `${p}-imp-${++counter}-${Date.now().toString(36)}`;

/**
 * Импорт иерархии из Excel/CSV.
 *
 * Поддерживаются два формата:
 *
 * (A) «Уровень 1», «Уровень 2», …, «Уровень N», «Модель»
 *     — общая древовидная структура произвольной глубины (как в файле
 *       «Иерархия с моделями.xlsx»). Метка уровня (заголовок колонки)
 *       сохраняется в `levelLabel` узла, тип определяется глубиной.
 *
 * (B) Именованные колонки: «Предприятие», «Завод», «Цех», «Участок»,
 *     «Группа», «Код модели». Это исторический формат — оставлен для
 *     совместимости.
 *
 * Дополнительно поддерживаются колонки «Класс» и «Подкласс» — они,
 * если присутствуют, прокидываются в модель.
 */
export interface ImportResult {
  hierarchy: HierarchyNode;
  models: EquipmentModel[];
  warnings: string[];
}

const NAMED_ALIASES: Record<string, string> = {
  предприятие: 'enterprise',
  компания: 'enterprise',
  завод: 'plant',
  площадка: 'plant',
  цех: 'workshop',
  отделение: 'workshop',
  участок: 'site',
  линия: 'site',
  группа: 'group',
  оборудование: 'group',
};

const NAMED_ORDER: NodeType[] = [
  'enterprise',
  'plant',
  'workshop',
  'site',
  'group',
];

const DEPTH_TYPE: NodeType[] = [
  'enterprise',
  'plant',
  'workshop',
  'site',
  'group',
  'group',
  'group',
  'group',
  'group',
];

const MODEL_KEYS = ['модель', 'код модели', 'код'];
const CLASS_KEYS = ['класс'];
const SUBCLASS_KEYS = ['подкласс'];

export async function parseHierarchyFile(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  return rowsToHierarchy(rows);
}

export function rowsToHierarchy(rows: Array<Record<string, unknown>>): ImportResult {
  const warnings: string[] = [];
  const models: EquipmentModel[] = [];

  // Резолвим колонки.
  const sample = rows[0] || {};
  const headers = Object.keys(sample);

  // Найти Колонку «Уровень N» (включая «Уровень N - …»). Возвращаем массив
  // {column, label, depth}, отсортированный по depth.
  const levelCols: Array<{ column: string; label: string; depth: number }> = [];
  const levelRe = /^уровень\s*(\d+)\b\s*[-–—:]?\s*(.*)$/i;
  let modelCol: string | undefined;
  let classCol: string | undefined;
  let subclassCol: string | undefined;
  const namedCols: Partial<Record<NodeType, string>> = {};

  for (const h of headers) {
    const norm = String(h).trim().toLowerCase();
    const m = levelRe.exec(norm);
    if (m) {
      levelCols.push({
        column: h,
        label: (m[2] || `Уровень ${m[1]}`).trim() || `Уровень ${m[1]}`,
        depth: parseInt(m[1], 10),
      });
      continue;
    }
    if (MODEL_KEYS.includes(norm)) modelCol = modelCol ?? h;
    else if (CLASS_KEYS.includes(norm)) classCol = h;
    else if (SUBCLASS_KEYS.includes(norm)) subclassCol = h;
    else if (NAMED_ALIASES[norm]) {
      const role = NAMED_ALIASES[norm] as NodeType;
      namedCols[role] = namedCols[role] ?? h;
    }
  }
  levelCols.sort((a, b) => a.depth - b.depth);

  const useLevels = levelCols.length > 0;

  if (!useLevels && Object.keys(namedCols).length === 0) {
    warnings.push('Не найдены колонки уровней («Уровень 1…N» или Предприятие/Завод/Цех/…)');
  }

  // Корень.
  const root: HierarchyNode = {
    id: newId('enterprise'),
    type: 'enterprise',
    name: 'Импорт',
    levelLabel: useLevels ? levelCols[0]?.label : undefined,
    children: [],
  };

  // Кэш для дедупликации узлов по пути.
  const cache = new Map<string, HierarchyNode>();

  for (const row of rows) {
    const path: Array<{ name: string; depth: number; label: string }> = [];

    if (useLevels) {
      for (const lc of levelCols) {
        const v = String(row[lc.column] ?? '').trim();
        if (v) path.push({ name: v, depth: lc.depth, label: lc.label });
      }
    } else {
      let depth = 1;
      for (const t of NAMED_ORDER) {
        const col = namedCols[t];
        const v = col ? String(row[col] ?? '').trim() : '';
        if (v) path.push({ name: v, depth, label: t });
        depth++;
      }
    }

    const modelCode = modelCol ? String(row[modelCol] ?? '').trim() : '';
    const className = classCol ? String(row[classCol] ?? '').trim() || undefined : undefined;
    const subclassName = subclassCol
      ? String(row[subclassCol] ?? '').trim() || undefined
      : undefined;

    if (!path.length && !modelCode) continue;

    // Заменяем имя корня на первый сегмент, если его ещё не клали.
    if (path.length && root.name === 'Импорт') {
      root.name = path[0].name;
      root.levelLabel = path[0].label;
      path.shift();
    } else if (path.length && path[0].name === root.name) {
      path.shift();
    }

    let parent = root;
    let pathKey = root.name;
    for (const seg of path) {
      pathKey += `\u0001${seg.depth}:${seg.name}`;
      let node = cache.get(pathKey);
      if (!node) {
        const tIdx = Math.min(seg.depth - 1, DEPTH_TYPE.length - 1);
        node = {
          id: newId(DEPTH_TYPE[tIdx]),
          type: DEPTH_TYPE[Math.max(0, tIdx)],
          name: seg.name,
          levelLabel: seg.label,
          children: [],
        };
        parent.children.push(node);
        cache.set(pathKey, node);
      }
      parent = node;
    }

    if (modelCode) {
      const m: EquipmentModel = {
        id: newId('m'),
        nodeId: parent.id,
        rawCode: modelCode,
        className,
        subclassName,
      };
      models.push(m);
      parent.modelIds = parent.modelIds ?? [];
      parent.modelIds.push(m.id);
    }
  }

  return { hierarchy: root, models, warnings };
}
