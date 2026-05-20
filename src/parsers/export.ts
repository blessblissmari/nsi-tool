import * as XLSX from 'xlsx';
import type {
  EquipmentModel,
  HierarchyNode,
  ActionItem,
  Characteristic,
  TechCardRow,
} from '../domain/types';

/**
 * Экспорт данных инструмента в XLSX (п.7 «Оценка качества данных», п.6
 * каждого раздела). Структура листов повторяет формат исходных
 * справочников Простоев.Нет, чтобы результат можно было использовать как
 * вход при повторной загрузке.
 */

type LeafRow = { path: string[]; labels: string[]; model: EquipmentModel };

/** Обходит дерево, возвращая листовые узлы с накопленными путём. */
function walkLeaves(
  node: HierarchyNode,
  path: string[],
  labels: string[],
  models: EquipmentModel[],
  out: LeafRow[],
): void {
  const nextPath = [...path, node.name || ''];
  const nextLabels = [...labels, node.levelLabel ?? ''];
  const ids = node.modelIds ?? [];
  for (const mid of ids) {
    const m = models.find((x) => x.id === mid);
    if (m) out.push({ path: nextPath, labels: nextLabels, model: m });
  }
  for (const c of node.children ?? []) {
    walkLeaves(c, nextPath, nextLabels, models, out);
  }
}

/** Иерархия с моделями — формат «Уровень 1… Уровень N + Модель». */
function hierarchySheet(
  hierarchy: HierarchyNode,
  models: EquipmentModel[],
): XLSX.WorkSheet {
  const rows: LeafRow[] = [];
  walkLeaves(hierarchy, [], [], models, rows);
  // Нет моделей — всё равно отдадим скелет иерархии (листы без моделей).
  if (rows.length === 0) {
    const skeleton: LeafRow[] = [];
    function walkSkeleton(
      n: HierarchyNode,
      p: string[],
      l: string[],
    ): void {
      const np = [...p, n.name || ''];
      const nl = [...l, n.levelLabel ?? ''];
      if (!(n.children && n.children.length > 0)) {
        skeleton.push({
          path: np,
          labels: nl,
          model: {} as EquipmentModel,
        });
      } else {
        for (const c of n.children) walkSkeleton(c, np, nl);
      }
    }
    walkSkeleton(hierarchy, [], []);
    rows.push(...skeleton);
  }
  const maxDepth = rows.reduce((a, r) => Math.max(a, r.path.length), 0);
  // Заголовки: если есть levelLabel — используем, иначе «Уровень N».
  const headers: string[] = [];
  for (let i = 0; i < maxDepth; i++) {
    const label = rows.find((r) => r.labels[i])?.labels[i];
    headers.push(label || `Уровень ${i + 1}`);
  }
  headers.push('Модель');
  headers.push('Код нормализованный');
  headers.push('Класс');
  headers.push('Подкласс');
  headers.push('ТОР');
  headers.push('Источник класс.');
  const aoa: (string | number | null)[][] = [headers];
  for (const r of rows) {
    const m = r.model;
    const row: (string | number | null)[] = [];
    for (let i = 0; i < maxDepth; i++) row.push(r.path[i] ?? '');
    row.push(m.rawCode ?? '');
    row.push(m.normalizedCode ?? '');
    row.push(m.className ?? '');
    row.push(m.subclassName ?? '');
    const isTor =
      m.className && m.subclassName && m.normalizedCode ? 'ТОР' : '';
    row.push(isTor);
    row.push(m.classificationSource ?? '');
    aoa.push(row);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function charsSheet(models: EquipmentModel[]): XLSX.WorkSheet {
  const maxChars = models.reduce(
    (a, m) => Math.max(a, (m.characteristics ?? []).length),
    0,
  );
  const headers: string[] = ['Класс', 'Подкласс', 'Модель'];
  for (let i = 0; i < maxChars; i++) {
    headers.push(
      `Характеристика ${i + 1}`,
      `Значение ${i + 1}`,
      `Ед.измерения ${i + 1}`,
    );
  }
  const aoa: (string | number | null)[][] = [headers];
  for (const m of models) {
    const row: (string | number | null)[] = [
      m.className ?? '',
      m.subclassName ?? '',
      m.normalizedCode ?? m.rawCode ?? '',
    ];
    const chars: Characteristic[] = [...(m.characteristics ?? [])].sort(
      (a, b) => (a.priorityOrder ?? 999) - (b.priorityOrder ?? 999),
    );
    for (let i = 0; i < maxChars; i++) {
      const c = chars[i];
      row.push(
        c?.key ?? '',
        c
          ? c.valueNum !== undefined
            ? c.valueNum
            : (c.valueRaw ?? '')
          : '',
        c?.unit ?? '',
      );
    }
    aoa.push(row);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function actionsSheet(models: EquipmentModel[]): XLSX.WorkSheet {
  const maxActs = models.reduce(
    (a, m) => Math.max(a, (m.actions ?? []).length),
    0,
  );
  const headers: string[] = ['Класс', 'Подкласс', 'Модель'];
  for (let i = 0; i < maxActs; i++) {
    headers.push(`ВВ ${i + 1}`, `Периодичность ${i + 1}`);
  }
  const aoa: (string | number | null)[][] = [headers];
  for (const m of models) {
    const row: (string | number | null)[] = [
      m.className ?? '',
      m.subclassName ?? '',
      m.normalizedCode ?? m.rawCode ?? '',
    ];
    const acts: ActionItem[] = m.actions ?? [];
    for (let i = 0; i < maxActs; i++) {
      const a = acts[i];
      row.push(a?.name ?? '', a?.periodHours ?? '');
    }
    aoa.push(row);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function classificationSheet(models: EquipmentModel[]): XLSX.WorkSheet {
  const aoa: (string | number | null)[][] = [
    ['Класс', 'Подкласс', 'Модель', 'Источник', 'Уверенность'],
  ];
  for (const m of models) {
    aoa.push([
      m.className ?? '',
      m.subclassName ?? '',
      m.normalizedCode ?? m.rawCode ?? '',
      m.classificationSource ?? '',
      m.classificationConfidence ?? '',
    ]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function techCardsSheet(models: EquipmentModel[]): XLSX.WorkSheet {
  // Формат повторяет «Шаблон ТехКарты.xlsx» Простоев.Нет (п.6.5 ТЗ).
  const aoa: (string | number | null)[][] = [
    [
      'Класс',
      'Подкласс',
      'Нормализованный код модели',
      'Элемент',
      'Подэлемент',
      'Наименование операции',
      'Краткое содержание работ',
      'Вид ТОиР',
      'Периодичность',
      'Норма времени, часов',
      'Количество исполнителей',
      'Профессия/Квалификация',
      'Трудоёмкость, человеко/часов',
      'Наименование ТМЦ',
      'Количество ТМЦ',
      'Единицы измерения ТМЦ',
      'Наименование инструменты',
      'Средства индивидуальной защиты',
      'Требования по безопасности',
    ],
  ];
  for (const m of models) {
    const rows: TechCardRow[] = m.techCard ?? [];
    const acts = m.actions ?? [];
    for (const r of rows) {
      const act = r.actionId ? acts.find((a) => a.id === r.actionId) : undefined;
      const prof =
        r.specialty && r.qualification
          ? `${r.specialty}, ${r.qualification}`
          : (r.specialty ?? '');
      aoa.push([
        m.className ?? '',
        m.subclassName ?? '',
        m.normalizedCode ?? m.rawCode ?? '',
        r.component ?? '',
        r.subcomponent ?? '',
        r.operation ?? '',
        r.workDescription ?? '',
        act?.name ?? '',
        act?.periodHours ?? '',
        r.laborHours ?? '',
        r.workers ?? '',
        prof,
        r.totalLaborHours ?? '',
        r.tmcName ?? '',
        r.tmcQty ?? '',
        r.tmcUnit ?? '',
        r.tools ?? '',
        r.ppe ?? '',
        r.safety ?? '',
      ]);
    }
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

export function exportWorkbook(
  hierarchy: HierarchyNode,
  models: EquipmentModel[],
): Blob {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hierarchySheet(hierarchy, models), 'Иерархия');
  XLSX.utils.book_append_sheet(
    wb,
    classificationSheet(models),
    'Классификация',
  );
  XLSX.utils.book_append_sheet(wb, charsSheet(models), 'Характеристики');
  XLSX.utils.book_append_sheet(wb, actionsSheet(models), 'ВВ');
  XLSX.utils.book_append_sheet(wb, techCardsSheet(models), 'Техкарты');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function downloadWorkbook(
  hierarchy: HierarchyNode,
  models: EquipmentModel[],
  fileName = 'nsi-export.xlsx',
): void {
  const blob = exportWorkbook(hierarchy, models);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Use requestAnimationFrame to delay removal
  requestAnimationFrame(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}
