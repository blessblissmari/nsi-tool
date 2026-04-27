import type {
  Classifier,
  ClassificationProposal,
  ClassDef,
  EquipmentModel,
  SubclassDef,
} from './types';

export interface ClassificationResult {
  className?: string;
  subclassName?: string;
  matched: boolean;
  confidence: number;
  reason: string;
  proposals: ClassificationProposal[];
}

/**
 * Классификация модели. Стратегии (в порядке убывания приоритета):
 *  1) regex-шаблоны подкласса по коду (если задан `patterns`);
 *  2) ключевые слова подкласса/класса в коде;
 *  3) совпадение слов имени класса/подкласса в коде модели;
 *  4) (заглушка) — место для ИИ. Если в `classifier` подключён внешний ИИ-провайдер,
 *     он вернёт топ-N кандидатов.
 *
 * Функция всегда возвращает массив `proposals`. Самый уверенный — также проставляется
 * как `className/subclassName` (если уверенность ≥ 0.6). При уверенности 0.6..0.85
 * UI показывает «требует подтверждения», ниже — кандидат, но автоматически класс не
 * назначается.
 */
export function classifyModel(
  model: Pick<EquipmentModel, 'rawCode' | 'normalizedCode'>,
  classifier: Classifier,
): ClassificationResult {
  const code = (model.normalizedCode || model.rawCode || '').toUpperCase();
  if (!code) {
    return {
      matched: false,
      confidence: 0,
      reason: 'Пустой код модели',
      proposals: [],
    };
  }
  if (!classifier.classes.length) {
    return {
      matched: false,
      confidence: 0,
      reason: 'Классификатор не загружен',
      proposals: [],
    };
  }

  const proposals: ClassificationProposal[] = [];
  for (const cls of classifier.classes) {
    for (const sub of cls.subclasses) {
      collectProposals(code, cls, sub, proposals);
    }
    // Класс без подкласса (или общие keywords у класса)
    collectProposals(code, cls, undefined, proposals);
  }

  // Удаляем дубли — оставляем один с лучшей уверенностью.
  const dedup = new Map<string, ClassificationProposal>();
  for (const p of proposals) {
    const key = `${p.className}\u0001${p.subclassName ?? ''}`;
    const cur = dedup.get(key);
    if (!cur || p.confidence > cur.confidence) dedup.set(key, p);
  }
  const list = Array.from(dedup.values()).sort(
    (a, b) => b.confidence - a.confidence,
  );

  if (!list.length) {
    return {
      matched: false,
      confidence: 0,
      reason: 'Совпадений не найдено',
      proposals: [],
    };
  }

  const top = list[0];
  // Авто-применение только при уверенности ≥ 0.6.
  if (top.confidence >= 0.6) {
    return {
      className: top.className,
      subclassName: top.subclassName,
      matched: true,
      confidence: top.confidence,
      reason: top.reason,
      proposals: list.slice(0, 5),
    };
  }
  return {
    matched: false,
    confidence: top.confidence,
    reason: `Только подсказки (топ: ${top.reason})`,
    proposals: list.slice(0, 5),
  };
}

function collectProposals(
  code: string,
  cls: ClassDef,
  sub: SubclassDef | undefined,
  out: ClassificationProposal[],
): void {
  const subName = sub?.name;
  const name = sub?.name ?? cls.name;

  // 1) regex-шаблоны (только из подкласса).
  for (const pat of sub?.patterns ?? []) {
    try {
      const re = new RegExp(pat, 'i');
      if (re.test(code)) {
        out.push({
          className: cls.name,
          subclassName: subName,
          confidence: Math.min(0.95, 0.7 + Math.min(0.25, pat.length / 20)),
          reason: `regex «${pat}»`,
          source: 'classifier',
        });
      }
    } catch {
      // пропускаем кривые regex
    }
  }

  // 2) ключевые слова — приоритет более длинного совпадения.
  const keywords = [...(sub?.keywords ?? []), ...(!sub ? cls.keywords ?? [] : [])];
  for (const kw of keywords) {
    if (!kw) continue;
    const KW = kw.toUpperCase();
    if (code.includes(KW)) {
      out.push({
        className: cls.name,
        subclassName: subName,
        confidence: Math.min(0.9, 0.5 + KW.length / 12),
        reason: `ключевое слово «${kw}»`,
        source: 'classifier',
      });
    }
  }

  // 3) Слова имени класса/подкласса встречаются в коде. Это слабая эвристика —
  // confidence 0.4..0.55. Используется как «пред-предложение» и как задел под ИИ.
  const nameTokens = tokenize(name);
  let hits = 0;
  for (const t of nameTokens) {
    if (t.length >= 4 && code.includes(t.toUpperCase())) hits++;
  }
  if (hits > 0 && nameTokens.length > 0) {
    const ratio = hits / nameTokens.length;
    out.push({
      className: cls.name,
      subclassName: subName,
      confidence: 0.35 + 0.25 * ratio,
      reason: `совпадение слов в имени (${hits}/${nameTokens.length})`,
      source: 'heuristic',
    });
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((x) => x.length >= 3);
}
