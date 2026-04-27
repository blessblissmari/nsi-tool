import { useRef, useState } from 'react';
import { useStore } from '../store';
import { autoImportFile } from '../parsers/autoImport';
import { downloadWorkbook } from '../parsers/export';
import { aiProvider } from '../domain/ai';
import { getApiKey } from '../domain/openai';

export function Toolbar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const setHierarchy = useStore((s) => s.setHierarchy);
  const setClassifier = useStore((s) => s.setClassifier);
  const expandAll = useStore((s) => s.expandAll);
  const collapseAll = useStore((s) => s.collapseAll);
  const normalizeAll = useStore((s) => s.normalizeAll);
  const classifyByClassifier = useStore((s) => s.classifyByClassifier);
  const applyClassification = useStore((s) => s.applyClassification);
  const applyActions = useStore((s) => s.applyActions);
  const applyCharacteristics = useStore((s) => s.applyCharacteristics);
  const applyReference = useStore((s) => s.applyReference);

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const lines: string[] = [];
    for (const f of list) {
      try {
        const r = await autoImportFile(f);
        if (r.kind === 'hierarchy' && r.hierarchy) {
          setHierarchy(r.hierarchy.hierarchy, r.hierarchy.models);
          lines.push(`${r.fileName}: ${r.message}`);
        } else if (r.kind === 'classifier' && r.classifier) {
          setClassifier(r.classifier);
          lines.push(`${r.fileName}: ${r.message}`);
        } else if (r.kind === 'classification' && r.classification) {
          const res = applyClassification(r.classification);
          lines.push(
            `${r.fileName}: привязано ${res.matched}/${res.total}` +
              (res.unmatched.length ? `, не найдено в иерархии: ${res.unmatched.length}` : ''),
          );
        } else if (r.kind === 'actions' && r.actions) {
          const res = applyActions(r.actions);
          lines.push(
            `${r.fileName}: ВВ привязано к ${res.matched}/${res.total} моделей (${res.items} операций)`,
          );
        } else if (r.kind === 'reference' && r.reference) {
          const res = applyReference(r.reference.kind, r.reference.data);
          const labels: Record<string, string> = {
            actionsRef: 'справочник ВВ и периодичностей',
            operationsRef: 'справочник операций',
            specialtiesRef: 'справочник специальностей',
            unitsRef: 'справочник ед. измерения',
          };
          lines.push(
            `${r.fileName}: ${labels[res.kind] ?? res.kind} — ${res.count} строк`,
          );
        } else if (r.kind === 'characteristics' && r.characteristics) {
          const res = applyCharacteristics(r.characteristics);
          lines.push(
            `${r.fileName}: характеристики привязаны к ${res.matched}/${res.total} моделей (${res.items} полей)`,
          );
        } else {
          lines.push(`${r.fileName}: ${r.message}`);
        }
      } catch (err) {
        lines.push(`${f.name}: ошибка — ${(err as Error).message}`);
      }
    }
    setMsg(lines.join(' · '));
  };

  return (
    <div className="toolbar">
      <button
        onClick={() => fileInput.current?.click()}
        title="Загрузить xlsx/csv: иерархия с моделями, классификатор, сопоставление модель→класс или виды воздействия. Тип определяется автоматически по колонкам."
      >
        Загрузить
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        hidden
        onChange={async (e) => {
          if (e.target.files) await importFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <span className="sep" />

      <button
        onClick={() => {
          const r = normalizeAll();
          setMsg(`Нормализовано моделей: ${r.done}`);
        }}
        title="Применить правила нормализации (п.8.3 ТЗ) к коду модели"
      >
        Нормализовать
      </button>
      <button
        onClick={() => {
          const cls = useStore.getState().classifier;
          const hasRules = cls.classes.some((c) =>
            (c.keywords?.length ?? 0) > 0 ||
            c.subclasses.some(
              (s) => (s.keywords?.length ?? 0) > 0 || (s.patterns?.length ?? 0) > 0,
            ),
          );
          const r = classifyByClassifier();
          let m = `Классифицировано: ${r.matched} из ${r.total}`;
          if (r.suggested) m += `, подсказок: ${r.suggested}`;
          if (!hasRules && r.matched === 0) {
            m +=
              '. В классификаторе нет ключевых слов/regex. Загрузите файл «Классификация моделей.xlsx» (Класс/Подкласс/Модель) или дождитесь модуля ИИ.';
          }
          setMsg(m);
        }}
        title="Подобрать класс/подкласс по классификатору. Уверенные совпадения проставляются автоматически, остальные — как подсказки в карточке модели."
      >
        Классифицировать
      </button>
      <button
        disabled={!getApiKey()}
        title={
          !getApiKey()
            ? 'Подключите OpenAI ключ кнопкой «ИИ» в шапке'
            : 'Спросить ИИ для всех моделей без класса (использует кэш — повторный клик бесплатен).'
        }
        onClick={async () => {
          const state = useStore.getState();
          const update = state.updateModel;
          const classes = state.classifier.classes;
          if (!classes.length) {
            setMsg('Сначала загрузите классификатор.');
            return;
          }
          const need = state.models.filter(
            (m) =>
              m.classificationSource !== 'classifier' &&
              m.classificationSource !== 'manual' &&
              !m.className,
          );
          if (!need.length) {
            setMsg('Нет моделей без класса — все уже классифицированы.');
            return;
          }
          let ok = 0;
          let fail = 0;
          setMsg(`ИИ: 0 из ${need.length}…`);
          for (let i = 0; i < need.length; i++) {
            const m = need[i];
            try {
              const docText = (m.documents ?? [])
                .map((d) => d.parsedText || '')
                .filter(Boolean)
                .join('\n')
                .slice(0, 2000);
              const proposals = await aiProvider().classify({
                model: { rawCode: m.rawCode, normalizedCode: m.normalizedCode },
                classes,
                docText,
              });
              if (proposals.length) {
                const top = proposals[0];
                update(m.id, {
                  className: top.className,
                  subclassName: top.subclassName,
                  classificationSource: 'ai',
                  classificationConfidence: top.confidence,
                  classificationProposals: proposals,
                });
                ok++;
              } else {
                fail++;
              }
            } catch {
              fail++;
            }
            setMsg(
              `ИИ: ${i + 1} из ${need.length} (применено: ${ok}, без результата: ${fail})`,
            );
          }
          setMsg(
            `ИИ: классифицировано ${ok} из ${need.length}` +
              (fail ? `, без результата: ${fail}` : ''),
          );
        }}
      >
        Классифицировать ИИ
      </button>

      <span className="sep" />
      <button onClick={expandAll} title="Развернуть всё дерево">Развернуть</button>
      <button onClick={collapseAll} title="Свернуть дерево">Свернуть</button>

      <span className="sep" />
      <button
        title="Экспорт в XLSX: листы «Иерархия», «Классификация», «Характеристики», «ВВ»."
        onClick={() => {
          const s = useStore.getState();
          const stamp = new Date().toISOString().slice(0, 10);
          downloadWorkbook(s.hierarchy, s.models, `nsi-${stamp}.xlsx`);
          setMsg('Экспорт сформирован.');
        }}
      >
        Экспорт
      </button>

      <span className="sep" />
      <button
        title="Перезагрузить встроенные демо-данные (иерархия «Северал», классификатор «Простоев.Нет»). Затрёт текущие данные."
        onClick={() => {
          if (
            confirm(
              'Перезагрузить демо-данные? Текущая иерархия и модели будут заменены на встроенный пример «Северал».',
            )
          ) {
            useStore.getState().resetToSeed();
            setMsg('Демо-данные восстановлены.');
          }
        }}
      >
        Сбросить демо
      </button>
      <button
        title="Очистить иерархию и модели (оставить только пустой корень)."
        onClick={() => {
          if (confirm('Очистить иерархию и удалить все модели? Действие необратимо.')) {
            useStore.getState().clearAll();
            setMsg('Иерархия очищена.');
          }
        }}
      >
        Очистить
      </button>

      <span className="status">{msg}</span>
    </div>
  );
}
