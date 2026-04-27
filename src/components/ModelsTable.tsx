import { useStore } from '../store';
import type { EquipmentModel } from '../domain/types';
import { useState } from 'react';
import { ModelCard } from './ModelCard';

export function ModelsTable({
  models,
  nodeId,
}: {
  models: EquipmentModel[];
  nodeId: string;
}) {
  const addModel = useStore((s) => s.addModel);
  const selectModel = useStore((s) => s.selectModel);
  const selectedId = useStore((s) => s.selectedModelId);
  const [draft, setDraft] = useState('');

  return (
    <div>
      <table className="models">
        <thead>
          <tr>
            <th style={{ width: 280 }}>Код модели</th>
            <th style={{ width: 200 }}>Класс</th>
            <th style={{ width: 220 }}>Подкласс</th>
            <th style={{ width: 90 }}>ТОР</th>
            <th style={{ width: 110 }}>Источник</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const tor = m.className && m.subclassName && m.normalizedCode;
            const code = m.normalizedCode || m.rawCode;
            return (
              <tr
                key={m.id}
                className={selectedId === m.id ? 'sel' : ''}
                onClick={() => selectModel(m.id)}
              >
                <td className="mono">{code}</td>
                <td>{m.className || <span className="muted">—</span>}</td>
                <td>{m.subclassName || <span className="muted">—</span>}</td>
                <td>
                  {tor ? (
                    <span className="badge ok">ТОР</span>
                  ) : (
                    <span className="badge warn">не ТОР</span>
                  )}
                </td>
                <td className="muted small">
                  {m.classificationSource === 'classifier'
                    ? 'классификатор'
                    : m.classificationSource === 'manual'
                      ? 'ручной'
                      : m.classificationSource === 'ai'
                        ? 'ИИ'
                        : m.classificationSource === 'unresolved'
                          ? 'нет'
                          : '—'}
                </td>
              </tr>
            );
          })}
          {models.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Нет моделей
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="add-row">
        <input
          placeholder="новый код модели…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              addModel(nodeId, draft);
              setDraft('');
            }
          }}
        />
        <button
          onClick={() => {
            if (!draft.trim()) return;
            addModel(nodeId, draft);
            setDraft('');
          }}
        >
          Добавить модель
        </button>
      </div>

      {selectedId && <ModelCard modelId={selectedId} />}
    </div>
  );
}
