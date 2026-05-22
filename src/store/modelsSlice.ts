/**
 * Models slice — CRUD for equipment models, normalization, classification,
 * actions, characteristics, tech cards, reliability.
 */
import type { StateCreator } from 'zustand';
import type { EquipmentModel, TechCardRow } from '../domain/types';
import type { Store } from './types';
import { classifyModel } from '../domain/classify';
import { normalizeModelCode } from '../domain/normalize';
import { parseValue } from '../domain/units';
import { canon, clone, walk, findNode, uid, collectNodePath } from './helpers';
import { buildSeedHierarchy } from '../data/seed';

export type ModelsSlice = Pick<
  Store,
  | 'models'
  | 'addModel'
  | 'updateModel'
  | 'deleteModel'
  | 'normalizeAll'
  | 'classifyByClassifier'
  | 'applyClassification'
  | 'acceptProposal'
  | 'applyActions'
  | 'applyCharacteristics'
  | 'upsertTechCardRow'
  | 'deleteTechCardRow'
  | 'dedupeTechCard'
  | 'setTechCard'
  | 'setFailures'
>;

export const createModelsSlice: StateCreator<Store, [], [], ModelsSlice> = (
  set,
  get,
) => {
  const seed = buildSeedHierarchy();

  return {
    models: seed.models,

    addModel(nodeId, rawCode) {
      const code = rawCode.trim();
      if (!code) return;
      const m: EquipmentModel = {
        id: uid('m'),
        nodeId,
        rawCode: code,
      };
      const h = clone(get().hierarchy);
      const n = findNode(h, nodeId);
      if (!n) return;
      n.modelIds = (n.modelIds ?? []).concat(m.id);
      set({
        hierarchy: h,
        models: get().models.concat(m),
        selectedModelId: m.id,
      });
    },

    updateModel(id, patch) {
      set({
        models: get().models.map((m) =>
          m.id === id ? { ...m, ...patch } : m,
        ),
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

    normalizeAll(scope) {
      let done = 0;
      const disabled = new Set(
        get().rules.modelRules.filter((r) => !r.enabled).map((r) => r.id),
      );
      const next = get().models.map((m) => {
        if (scope && !scope.has(m.id)) return m;
        const r = normalizeModelCode(m.rawCode, disabled);
        if (r.code && r.code !== m.normalizedCode) done++;
        return { ...m, normalizedCode: r.code };
      });
      set({ models: next });
      return { done };
    },

    classifyByClassifier(scope) {
      const { classifier, hierarchy } = get();
      let matched = 0;
      let suggested = 0;
      const next = get().models.map((m) => {
        if (scope && !scope.has(m.id)) return m;
        if (
          m.classificationSource === 'manual' ||
          (m.classificationSource === 'classifier' && m.className)
        ) {
          return m;
        }
        const nodeContext = m.nodeId
          ? collectNodePath(hierarchy, m.nodeId)
          : undefined;
        const r = classifyModel(m, classifier, nodeContext);
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
      const byCode = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const k = canon(r.modelCode);
        if (k) byCode.set(k, r);
        const norm = canon(normalizeModelCode(r.modelCode).code);
        if (norm && norm !== k) byCode.set(norm, r);
      }
      let matched = 0;
      const matchedKeys = new Set<string>();
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
      const byCode = new Map<string, (typeof rows)[number]>();
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
        let row: (typeof rows)[number] | undefined;
        for (const c of candidates) {
          row = byCode.get(c);
          if (row) break;
        }
        if (!row) return m;
        matched++;
        const existing = m.actions ?? [];
        const lockedKeys = new Set(
          existing
            .filter((a) => a.lockedByExpert)
            .map((a) => a.name + '|' + a.source),
        );
        const fromOtherSources = existing.filter(
          (a) =>
            a.source !== row!.source &&
            !lockedKeys.has(a.name + '|' + a.source),
        );
        const lockedFromThis = existing.filter(
          (a) => a.lockedByExpert && a.source === row!.source,
        );
        const fresh = row.items.map((it) => ({
          id: uid('a'),
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
      const byCode = new Map<string, (typeof rows)[number]>();
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
        let row: (typeof rows)[number] | undefined;
        for (const c of candidates) {
          row = byCode.get(c);
          if (row) break;
        }
        if (!row) return m;
        matched++;
        const cls = classifier.classes.find((c) => c.name === m.className);
        const sub = cls?.subclasses.find((s) => s.name === m.subclassName);
        const priority = [
          ...(cls?.priorityChars ?? []),
          ...(sub?.priorityChars ?? []),
        ];
        const existing = m.characteristics ?? [];
        const lockedKeys = new Set(
          existing
            .filter((c) => c.lockedByExpert)
            .map((c) => c.key.toLowerCase()),
        );
        const locked = existing.filter((c) => c.lockedByExpert);
        const fresh = row.items
          .filter((it) => !lockedKeys.has(it.key.toLowerCase()))
          .map((it) => {
            const pv = parseValue(
              `${it.valueRaw}${it.unit ? ' ' + it.unit : ''}`,
            );
            const pi = priority.findIndex(
              (p) => p.key.toLowerCase() === it.key.toLowerCase(),
            );
            return {
              id: uid('c'),
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

    upsertTechCardRow(modelId, row) {
      const next = get().models.map((m) => {
        if (m.id !== modelId) return m;
        const list = m.techCard ?? [];
        if (row.id) {
          const idx = list.findIndex((r) => r.id === row.id);
          if (idx >= 0) {
            const merged = { ...list[idx], ...row } as TechCardRow;
            const out = list.slice();
            out[idx] = merged;
            return { ...m, techCard: out };
          }
        }
        const created: TechCardRow = {
          id: uid('tc'),
          source: row.source ?? 'manual',
          ...row,
        } as TechCardRow;
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

    setTechCard(modelId, rows) {
      const next = get().models.map((m) =>
        m.id === modelId ? { ...m, techCard: rows } : m,
      );
      set({ models: next });
    },

    dedupeTechCard(modelId) {
      let removed = 0;
      const next = get().models.map((m) => {
        if (m.id !== modelId) return m;
        const list = m.techCard ?? [];
        const seen = new Set<string>();
        const out: TechCardRow[] = [];
        for (const r of list) {
          const key = [
            r.isAggregate
              ? 'AGG'
              : (r.component ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
            (r.subcomponent ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
            (r.operation ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
            (r.specialty ?? '').trim().toLowerCase().replace(/\s+/g, ' '),
          ].join('|');
          const isEmpty =
            !r.component &&
            !r.operation &&
            !r.tmcName &&
            !r.specialty &&
            !r.isAggregate;
          if (!isEmpty && seen.has(key)) {
            removed++;
            continue;
          }
          if (!isEmpty) seen.add(key);
          out.push(r);
        }
        return { ...m, techCard: out };
      });
      if (removed > 0) set({ models: next });
      return removed;
    },

    setFailures(modelId, failures) {
      const next = get().models.map((m) =>
        m.id === modelId ? { ...m, failures } : m,
      );
      set({ models: next });
    },
  };
};
