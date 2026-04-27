import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Classifier,
  EquipmentModel,
  HierarchyNode,
  NormalizationRules,
  TOR,
} from './domain/types';
import { classifyModel } from './domain/classify';
import { normalizeModelCode } from './domain/normalize';
import type { ClassificationRow } from './parsers/classification';
import type { ActionsImportRow } from './parsers/actions';
import type { CharsImportRow } from './parsers/charsImport';
import type { ReferenceData } from './domain/types';
import type { ReferenceKind } from './parsers/references';
import { parseValue } from './domain/units';
import {
  SEED_CLASSIFIER,
  SEED_NORMALIZATION_RULES,
  buildSeedHierarchy,
} from './data/seed';

interface Store {
  hierarchy: HierarchyNode;
  models: EquipmentModel[];
  classifier: Classifier;
  rules: NormalizationRules;
  references: ReferenceData;
  selectedNodeId?: string;
  selectedModelId?: string;
  expandedIds: Set<string>;

  setHierarchy(h: HierarchyNode, models: EquipmentModel[]): void;
  setClassifier(c: Classifier): void;
  setRules(r: NormalizationRules): void;
  selectNode(id: string | undefined): void;
  selectModel(id: string | undefined): void;
  toggleExpand(id: string): void;
  expandAll(): void;
  collapseAll(): void;

  // Hierarchy editing
  renameNode(id: string, name: string): void;
  updateNode(id: string, patch: Partial<HierarchyNode>): void;
  addChildNode(parentId: string, type: HierarchyNode['type'], name: string): void;
  deleteNode(id: string): void;

  // Models
  addModel(nodeId: string, rawCode: string): void;
  updateModel(id: string, patch: Partial<EquipmentModel>): void;
  deleteModel(id: string): void;

  // Bulk actions
  normalizeAll(): { done: number };
  classifyByClassifier(): {
    matched: number;
    suggested: number;
    total: number;
  };
  applyClassification(rows: ClassificationRow[]): {
    matched: number;
    total: number;
    unmatched: string[];
  };
  acceptProposal(
    modelId: string,
    proposal: import('./domain/types').ClassificationProposal,
  ): void;
  applyActions(rows: ActionsImportRow[]): {
    matched: number;
    total: number;
    items: number;
  };
  applyCharacteristics(rows: CharsImportRow[]): {
    matched: number;
    total: number;
    items: number;
  };
  applyReference(kind: ReferenceKind, data: Partial<ReferenceData>): {
    kind: ReferenceKind;
    count: number;
  };
  // Tech card editing
  upsertTechCardRow(
    modelId: string,
    row: Partial<import('./domain/types').TechCardRow> & { id?: string },
  ): void;
  deleteTechCardRow(modelId: string, rowId: string): void;
  // Reliability
  setFailures(
    modelId: string,
    failures: import('./domain/types').FailureRecord[],
  ): void;
}

const seed = buildSeedHierarchy();

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
  hierarchy: seed.hierarchy,
  models: seed.models,
  classifier: SEED_CLASSIFIER,
  rules: SEED_NORMALIZATION_RULES,
  references: { actions: [], operations: [], specialties: [], units: [] },
  selectedNodeId: seed.hierarchy.id,
  selectedModelId: undefined,
  expandedIds: new Set([seed.hierarchy.id]),

  setHierarchy(h, models) {
    set({
      hierarchy: h,
      models,
      selectedNodeId: h.id,
      selectedModelId: undefined,
      expandedIds: new Set([h.id]),
    });
  },
  setClassifier(c) {
    set({ classifier: c });
  },
  setRules(r) {
    set({ rules: r });
  },
  selectNode(id) {
    set({ selectedNodeId: id, selectedModelId: undefined });
  },
  selectModel(id) {
    set({ selectedModelId: id });
  },
  toggleExpand(id) {
    const ids = new Set(get().expandedIds);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    set({ expandedIds: ids });
  },
  expandAll() {
    const all = new Set<string>();
    walk(get().hierarchy, (n) => all.add(n.id));
    set({ expandedIds: all });
  },
  collapseAll() {
    set({ expandedIds: new Set([get().hierarchy.id]) });
  },

  renameNode(id, name) {
    const h = clone(get().hierarchy);
    const n = findNode(h, id);
    if (n) n.name = name;
    set({ hierarchy: h });
  },
  updateNode(id, patch) {
    const h = clone(get().hierarchy);
    const n = findNode(h, id);
    if (n) Object.assign(n, patch);
    set({ hierarchy: h });
  },
  addChildNode(parentId, type, name) {
    const h = clone(get().hierarchy);
    const p = findNode(h, parentId);
    if (!p) return;
    p.children.push({
      id: `${type}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      type,
      name,
      children: [],
    });
    const ids = new Set(get().expandedIds);
    ids.add(parentId);
    set({ hierarchy: h, expandedIds: ids });
  },
  deleteNode(id) {
    if (id === get().hierarchy.id) return;
    const h = clone(get().hierarchy);
    const ids: string[] = [];
    detach(h, id, ids);
    const models = get().models.filter((m) => !ids.includes(m.nodeId));
    set({
      hierarchy: h,
      models,
      selectedNodeId: ids.includes(get().selectedNodeId ?? '')
        ? h.id
        : get().selectedNodeId,
    });
  },

  addModel(nodeId, rawCode) {
    const code = rawCode.trim();
    if (!code) return;
    const m: EquipmentModel = {
      id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      nodeId,
      rawCode: code,
    };
    const h = clone(get().hierarchy);
    const n = findNode(h, nodeId);
    if (!n) return;
    n.modelIds = (n.modelIds ?? []).concat(m.id);
    set({ hierarchy: h, models: get().models.concat(m), selectedModelId: m.id });
  },
  updateModel(id, patch) {
    set({
      models: get().models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  },
  deleteModel(id) {
    const h = clone(get().hierarchy);
    walk(h, (n) => {
      if (n.modelIds) n.modelIds = n.modelIds.filter((x) => x !== id);
    });
    set({
      hierarchy: h,
      models: get().models.filter((m) => m.id !== id),
      selectedModelId:
        get().selectedModelId === id ? undefined : get().selectedModelId,
    });
  },

  normalizeAll() {
    let done = 0;
    const next = get().models.map((m) => {
      const r = normalizeModelCode(m.rawCode);
      if (r.code && r.code !== m.normalizedCode) done++;
      return { ...m, normalizedCode: r.code };
    });
    set({ models: next });
    return { done };
  },
  classifyByClassifier() {
    const { classifier } = get();
    let matched = 0;
    let suggested = 0;
    const next = get().models.map((m) => {
      // Не трогаем модели, у которых класс уже определён прямой привязкой
      // или вручную — иначе теряем уверенность 100% из файла привязок.
      if (
        m.classificationSource === 'manual' ||
        (m.classificationSource === 'classifier' && m.className)
      ) {
        return m;
      }
      const r = classifyModel(m, classifier);
      if (r.matched) {
        matched++;
        return {
          ...m,
          className: r.className ?? m.className,
          subclassName: r.subclassName ?? m.subclassName,
          classificationSource: 'classifier' as const,
          classificationConfidence: r.confidence,
          classificationProposals: r.proposals,
        };
      }
      if (r.proposals.length) suggested++;
      return {
        ...m,
        classificationSource: m.className
          ? m.classificationSource
          : ('unresolved' as const),
        classificationConfidence: m.className
          ? m.classificationConfidence
          : r.confidence,
        classificationProposals: r.proposals,
      };
    });
    set({ models: next });
    return { matched, suggested, total: next.length };
  },
  acceptProposal(modelId, proposal) {
    const next = get().models.map((m) =>
      m.id === modelId
        ? {
            ...m,
            className: proposal.className,
            subclassName: proposal.subclassName,
            classificationSource: 'manual' as const,
            classificationConfidence: 1,
          }
        : m,
    );
    set({ models: next });
  },
  applyClassification(rows) {
    // Индексируем по обоим вариантам коду (как пришёл и нормализованному).
    const byCode = new Map<string, ClassificationRow>();
    for (const r of rows) {
      const k = canon(r.modelCode);
      if (k) byCode.set(k, r);
      const norm = canon(normalizeModelCode(r.modelCode).code);
      if (norm && norm !== k) byCode.set(norm, r);
    }
    let matched = 0;
    const matchedKeys = new Set<string>();
    const next = get().models.map((m) => {
      // Кандидаты: нормализованный код, сырой код, и нормализация сырого «на лету».
      const onTheFlyNorm = m.rawCode
        ? normalizeModelCode(m.rawCode).code
        : '';
      const candidates = Array.from(
        new Set(
          [m.normalizedCode, m.rawCode, onTheFlyNorm]
            .filter(Boolean)
            .map((x) => canon(String(x))),
        ),
      );
      for (const c of candidates) {
        const r = byCode.get(c);
        if (r) {
          matchedKeys.add(canon(r.modelCode));
          matched++;
          return {
            ...m,
            className: r.className,
            subclassName: r.subclassName ?? m.subclassName,
            classificationSource: 'classifier' as const,
            classificationConfidence: 1,
          };
        }
      }
      return m;
    });
    const unmatched: string[] = [];
    for (const r of rows) {
      if (!matchedKeys.has(canon(r.modelCode))) unmatched.push(r.modelCode);
    }
    set({ models: next });
    return { matched, total: rows.length, unmatched };
  },
  applyActions(rows) {
    // Индексируем строки ВВ по нормализованному и сырому коду модели.
    const byCode = new Map<string, ActionsImportRow>();
    for (const r of rows) {
      const k = canon(r.modelCode);
      if (k) byCode.set(k, r);
      const norm = canon(normalizeModelCode(r.modelCode).code);
      if (norm && norm !== k) byCode.set(norm, r);
    }
    let matched = 0;
    let totalItems = 0;
    const next = get().models.map((m) => {
      const onTheFlyNorm = m.rawCode
        ? normalizeModelCode(m.rawCode).code
        : '';
      const candidates = Array.from(
        new Set(
          [m.normalizedCode, m.rawCode, onTheFlyNorm]
            .filter(Boolean)
            .map((x) => canon(String(x))),
        ),
      );
      let row: ActionsImportRow | undefined;
      for (const c of candidates) {
        row = byCode.get(c);
        if (row) break;
      }
      if (!row) return m;
      matched++;
      // Сохраняем зафиксированные экспертом ВВ + ВВ из других источников
      // (например, ист и инт могут идти одновременно).
      const existing = m.actions ?? [];
      const lockedKeys = new Set(
        existing.filter((a) => a.lockedByExpert).map((a) => a.name + '|' + a.source),
      );
      const fromOtherSources = existing.filter(
        (a) => a.source !== row!.source && !lockedKeys.has(a.name + '|' + a.source),
      );
      const lockedFromThis = existing.filter(
        (a) => a.lockedByExpert && a.source === row!.source,
      );
      const fresh = row.items.map((it) => ({
        id:
          'a-' +
          Date.now().toString(36) +
          '-' +
          Math.random().toString(36).slice(2, 6),
        name: it.name,
        kind: it.kind,
        periodHours: it.periodHours,
        source: row!.source,
      }));
      totalItems += fresh.length;
      return {
        ...m,
        actions: [...lockedFromThis, ...fromOtherSources, ...fresh],
      };
    });
    set({ models: next });
    return { matched, total: rows.length, items: totalItems };
  },
  applyCharacteristics(rows) {
    const byCode = new Map<string, CharsImportRow>();
    for (const r of rows) {
      const k = canon(r.modelCode);
      if (k) byCode.set(k, r);
      const norm = canon(normalizeModelCode(r.modelCode).code);
      if (norm && norm !== k) byCode.set(norm, r);
    }
    const classifier = get().classifier;
    let matched = 0;
    let totalItems = 0;
    const next = get().models.map((m) => {
      const onTheFlyNorm = m.rawCode
        ? normalizeModelCode(m.rawCode).code
        : '';
      const candidates = Array.from(
        new Set(
          [m.normalizedCode, m.rawCode, onTheFlyNorm]
            .filter(Boolean)
            .map((x) => canon(String(x))),
        ),
      );
      let row: CharsImportRow | undefined;
      for (const c of candidates) {
        row = byCode.get(c);
        if (row) break;
      }
      if (!row) return m;
      matched++;
      // Определяем приоритеты по классификатору.
      const cls = classifier.classes.find((c) => c.name === m.className);
      const sub = cls?.subclasses.find((s) => s.name === m.subclassName);
      const priority = [
        ...(cls?.priorityChars ?? []),
        ...(sub?.priorityChars ?? []),
      ];
      // Сохраняем зафиксированные экспертом, перезаписываем остальные.
      const existing = m.characteristics ?? [];
      const lockedKeys = new Set(
        existing.filter((c) => c.lockedByExpert).map((c) => c.key.toLowerCase()),
      );
      const locked = existing.filter((c) => c.lockedByExpert);
      const fresh = row.items
        .filter((it) => !lockedKeys.has(it.key.toLowerCase()))
        .map((it) => {
          const pv = parseValue(`${it.valueRaw}${it.unit ? ' ' + it.unit : ''}`);
          const pi = priority.findIndex(
            (p) => p.key.toLowerCase() === it.key.toLowerCase(),
          );
          return {
            id:
              'c-' +
              Date.now().toString(36) +
              '-' +
              Math.random().toString(36).slice(2, 6),
            key: it.key,
            valueRaw: it.valueRaw,
            valueNum: pv.num,
            unit: it.unit ?? pv.unit,
            isPriority: pi >= 0,
            priorityOrder: pi >= 0 ? pi : undefined,
            targetUnit: pi >= 0 ? priority[pi].unit : undefined,
            source: row!.source,
            confidence: 1,
          };
        });
      totalItems += fresh.length;
      return { ...m, characteristics: [...locked, ...fresh] };
    });
    set({ models: next });
    return { matched, total: rows.length, items: totalItems };
  },
  applyReference(kind, data) {
    const cur = get().references;
    const next: ReferenceData = { ...cur };
    let count = 0;
    if (kind === 'actionsRef' && data.actions) {
      next.actions = data.actions;
      count = data.actions.length;
    }
    if (kind === 'operationsRef' && data.operations) {
      next.operations = data.operations;
      count = data.operations.length;
    }
    if (kind === 'specialtiesRef' && data.specialties) {
      next.specialties = data.specialties;
      count = data.specialties.length;
    }
    if (kind === 'unitsRef' && data.units) {
      next.units = data.units;
      count = data.units.length;
    }
    set({ references: next });
    return { kind, count };
  },
  upsertTechCardRow(modelId, row) {
    const next = get().models.map((m) => {
      if (m.id !== modelId) return m;
      const list = m.techCard ?? [];
      if (row.id) {
        const idx = list.findIndex((r) => r.id === row.id);
        if (idx >= 0) {
          const merged = { ...list[idx], ...row } as import('./domain/types').TechCardRow;
          const out = list.slice();
          out[idx] = merged;
          return { ...m, techCard: out };
        }
      }
      const id =
        'tc-' +
        Date.now().toString(36) +
        '-' +
        Math.random().toString(36).slice(2, 6);
      const created: import('./domain/types').TechCardRow = {
        id,
        source: row.source ?? 'manual',
        ...row,
      } as import('./domain/types').TechCardRow;
      return { ...m, techCard: [...list, created] };
    });
    set({ models: next });
  },
  deleteTechCardRow(modelId, rowId) {
    const next = get().models.map((m) =>
      m.id === modelId
        ? { ...m, techCard: (m.techCard ?? []).filter((r) => r.id !== rowId) }
        : m,
    );
    set({ models: next });
  },
  setFailures(modelId, failures) {
    const next = get().models.map((m) =>
      m.id === modelId ? { ...m, failures } : m,
    );
    set({ models: next });
  },
    }),
    {
      name: 'nsi_store_v1',
      version: 1,
      storage: createJSONStorage(() => localStorage, {
        // Сериализуем Set как массив, чтобы JSON корректно его сохранял.
        replacer: (_k, v) => (v instanceof Set ? { __set: Array.from(v) } : v),
        reviver: (_k, v) => {
          if (
            v &&
            typeof v === 'object' &&
            Array.isArray((v as { __set?: unknown[] }).__set)
          ) {
            return new Set((v as { __set: string[] }).__set);
          }
          return v;
        },
      }),
      // Не сохраняем выбор узла/модели — эфемерный UI-стейт.
      partialize: (s) => ({
        hierarchy: s.hierarchy,
        models: s.models,
        classifier: s.classifier,
        rules: s.rules,
        references: s.references,
        expandedIds: s.expandedIds,
      }),
    },
  ),
);

function canon(s: string): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
function walk(n: HierarchyNode, f: (x: HierarchyNode) => void) {
  f(n);
  n.children.forEach((c) => walk(c, f));
}
function findNode(n: HierarchyNode, id: string): HierarchyNode | undefined {
  if (n.id === id) return n;
  for (const c of n.children) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return undefined;
}
function detach(n: HierarchyNode, id: string, removed: string[]): boolean {
  const idx = n.children.findIndex((c) => c.id === id);
  if (idx >= 0) {
    walk(n.children[idx], (x) => removed.push(x.id));
    n.children.splice(idx, 1);
    return true;
  }
  for (const c of n.children) if (detach(c, id, removed)) return true;
  return false;
}

/** Все ТОР (классифицированные модели) под заданным узлом (рекурсивно). */
export function torsForNode(
  store: Pick<Store, 'hierarchy' | 'models'>,
  nodeId: string,
): TOR[] {
  const node = findNode(store.hierarchy, nodeId);
  if (!node) return [];
  const ids = new Set<string>();
  walk(node, (n) => n.modelIds?.forEach((id) => ids.add(id)));
  return store.models
    .filter((m) => ids.has(m.id))
    .filter((m) => m.className && m.subclassName && m.normalizedCode)
    .map<TOR>((m) => ({
      id: m.id,
      className: m.className!,
      subclassName: m.subclassName!,
      modelCode: m.normalizedCode!,
      modelId: m.id,
    }));
}

/** Все модели под узлом. */
export function modelsForNode(
  store: Pick<Store, 'hierarchy' | 'models'>,
  nodeId: string,
): EquipmentModel[] {
  const node = findNode(store.hierarchy, nodeId);
  if (!node) return [];
  const ids = new Set<string>();
  walk(node, (n) => n.modelIds?.forEach((id) => ids.add(id)));
  return store.models.filter((m) => ids.has(m.id));
}
