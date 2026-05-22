/**
 * Store migration logic — extracted from the monolithic store
 * for readability. Handles schema upgrades v1→v6.
 */
import type { Characteristic } from '../domain/types';
import type { Store } from './types';
import {
  SEED_CLASSIFIER,
  SEED_REFERENCES,
  buildSeedHierarchy,
} from '../data/seed';
import { PROSTOEV_CLASSIFIER } from '../data/prostoev';

export function migrateStore(persisted: unknown): Partial<Store> {
  const ps = (persisted ?? {}) as Partial<Store>;
  let next = ps;

  // ── v1→v2: seed classifier if empty ───────────────────────
  const cls = next.classifier;
  if (!cls || !cls.classes || cls.classes.length === 0) {
    next = { ...next, classifier: SEED_CLASSIFIER };
  } else if (cls.classes.length < PROSTOEV_CLASSIFIER.classes.length) {
    next = { ...next, classifier: SEED_CLASSIFIER };
  }

  // ── v2→v3: seed hierarchy if empty ────────────────────────
  const h = next.hierarchy;
  const hasAny =
    h && ((h.children?.length ?? 0) > 0 || (h.modelIds?.length ?? 0) > 0);
  if (!hasAny) {
    const seeded = buildSeedHierarchy();
    next = {
      ...next,
      hierarchy: seeded.hierarchy,
      models: seeded.models,
      expandedIds: new Set([seeded.hierarchy.id]),
    };
  }

  // ── v3→v4: seed references if empty ───────────────────────
  const r = next.references;
  const refsEmpty =
    !r ||
    ((r.actions?.length ?? 0) === 0 &&
      (r.operations?.length ?? 0) === 0 &&
      (r.specialties?.length ?? 0) === 0 &&
      (r.units?.length ?? 0) === 0);
  if (refsEmpty) {
    next = { ...next, references: SEED_REFERENCES };
  }

  // ── v4→v5: backfill characteristics from seed ─────────────
  const seedModels = buildSeedHierarchy().models;
  const seedCharsByCode = new Map<string, Characteristic[]>();
  for (const sm of seedModels) {
    if (sm.characteristics?.length && sm.normalizedCode) {
      seedCharsByCode.set(sm.normalizedCode, sm.characteristics);
    }
  }
  const curModels = next.models ?? [];
  const expanded = curModels.map((m) => {
    if (!m.normalizedCode) return m;
    const seedChars = seedCharsByCode.get(m.normalizedCode);
    if (!seedChars) return m;
    const existing = m.characteristics ?? [];
    const lockedKeys = new Set(
      existing
        .filter((c) => c.lockedByExpert)
        .map((c) => c.key.toLowerCase()),
    );
    const isUserModified = existing.some(
      (c) => c.lockedByExpert || c.source === 'manual',
    );
    if (isUserModified) {
      const haveKeys = new Set(existing.map((c) => c.key.toLowerCase()));
      const extra = seedChars.filter(
        (c) => !haveKeys.has(c.key.toLowerCase()),
      );
      if (!extra.length) return m;
      return { ...m, characteristics: [...existing, ...extra] };
    }
    const merged = seedChars.map((c) => {
      if (lockedKeys.has(c.key.toLowerCase())) {
        return existing.find(
          (e) => e.key.toLowerCase() === c.key.toLowerCase(),
        )!;
      }
      return c;
    });
    return { ...m, characteristics: merged };
  });
  next = { ...next, models: expanded };

  // ── v5→v6: clean "текст" units ────────────────────────────
  const cleanUnit = (u?: string) => (u && u !== 'текст' ? u : undefined);
  const cleanedModels = (next.models ?? []).map((mm) => ({
    ...mm,
    characteristics: (mm.characteristics ?? []).map((c) => ({
      ...c,
      unit: cleanUnit(c.unit),
      targetUnit: cleanUnit(c.targetUnit),
    })),
  }));
  next = { ...next, models: cleanedModels };

  if (next.classifier?.classes) {
    next.classifier = {
      ...next.classifier,
      classes: next.classifier.classes.map((klass) => ({
        ...klass,
        priorityChars: klass.priorityChars?.map((p) => ({
          ...p,
          unit: cleanUnit(p.unit),
        })),
        subclasses: klass.subclasses?.map((sub) => ({
          ...sub,
          priorityChars: sub.priorityChars?.map((p) => ({
            ...p,
            unit: cleanUnit(p.unit),
          })),
        })),
      })),
    };
  }

  return next as Partial<Store>;
}
