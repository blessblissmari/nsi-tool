import { useEffect, useState } from 'react';
import {
  clearCache,
  getApiKey,
  resetUsage,
  setApiKey,
  readUsage,
  type AiUsage,
} from '../domain/openai';
import {
  getUiSettings,
  setUiSettings,
  subscribeUiSettings,
  type UiSettings,
} from '../domain/uiSettings';
import { useStore } from '../store';
import { SEED_NORMALIZATION_RULES } from '../data/seed';
import type { NormalizationRule } from '../domain/types';

interface Props {
  onClose: () => void;
}

export function AiSettings({ onClose }: Props) {
  const [key, setKey] = useState(() => getApiKey() ?? '');
  const [usage, setUsage] = useState<AiUsage>(() => readUsage());
  const [revealed, setRevealed] = useState(false);
  const [ui, setUi] = useState<UiSettings>(() => getUiSettings());
  const rules = useStore((s) => s.rules);
  const setRules = useStore((s) => s.setRules);
  const toggleRule = (kind: 'modelRules' | 'classRules', id: string) => {
    const list = rules[kind].map((r: NormalizationRule) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r,
    );
    setRules({ ...rules, [kind]: list });
  };
  const resetRules = () => setRules(SEED_NORMALIZATION_RULES);

  useEffect(() => {
    const onU = (e: Event) =>
      setUsage((e as CustomEvent<AiUsage>).detail ?? readUsage());
    window.addEventListener('nsi:ai-usage', onU);
    const off = subscribeUiSettings(setUi);
    return () => {
      window.removeEventListener('nsi:ai-usage', onU);
      off();
    };
  }, []);

  const toggleUi = (patch: Partial<UiSettings>) =>
    setUi(setUiSettings(patch));

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
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          padding: 16,
          minWidth: 460,
          maxWidth: 720,
          maxHeight: '85vh',
          overflow: 'auto',
          border: '1px solid #999',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <h3 style={{ margin: 0 }}>Настройки</h3>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="muted small" style={{ fontWeight: 600 }}>
            Интерфейс
          </div>
          <label
            className="row-flex"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <input
              type="checkbox"
              checked={ui.showModelImages}
              onChange={(e) =>
                toggleUi({ showModelImages: e.target.checked })
              }
            />
            <span>Показывать картинки моделей</span>
          </label>
          <label
            className="row-flex"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <input
              type="checkbox"
              checked={ui.modelCardFullscreen}
              onChange={(e) =>
                toggleUi({ modelCardFullscreen: e.target.checked })
              }
            />
            <span>Открывать карточку модели на весь экран</span>
          </label>

          <hr />
          <div className="muted small" style={{ fontWeight: 600 }}>
            ИИ (OpenAI)
          </div>
          <label className="muted small">
            OpenAI API ключ (gpt-4o-mini). Хранится в localStorage браузера, на
            сервер не уходит.
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={revealed ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
              style={{ flex: 1, fontFamily: 'monospace' }}
              autoComplete="off"
            />
            <button onClick={() => setRevealed((x) => !x)}>
              {revealed ? 'скрыть' : 'показать'}
            </button>
            <button
              onClick={() => {
                setApiKey(key);
                onClose();
              }}
            >
              сохранить
            </button>
            <button
              onClick={() => {
                setKey('');
                setApiKey('');
              }}
            >
              удалить
            </button>
          </div>

          <hr />
          <div className="muted small">Расход</div>
          <table className="models">
            <tbody>
              <tr>
                <td>Запросов всего</td>
                <td>{usage.requests}</td>
              </tr>
              <tr>
                <td>Входных токенов</td>
                <td>{usage.promptTokens.toLocaleString('ru')}</td>
              </tr>
              <tr>
                <td>Выходных токенов</td>
                <td>{usage.completionTokens.toLocaleString('ru')}</td>
              </tr>
              <tr>
                <td>Стоимость, USD</td>
                <td>${usage.costUsd.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => resetUsage()}>обнулить счётчик</button>
            <button
              onClick={() => {
                clearCache();
                alert('Кэш ИИ очищен');
              }}
            >
              очистить кэш
            </button>
          </div>
          <div className="muted small">
            Модель: <b>gpt-4o-mini</b> · $0.15 / 1M вход · $0.60 / 1M выход.
            Все ответы кэшируются по содержимому запроса — повторный клик не
            тратит токены.
          </div>

          <hr />
          <div
            className="row-flex"
            style={{ alignItems: 'center', gap: 6 }}
          >
            <span className="muted small" style={{ fontWeight: 600 }}>
              Правила нормализации (п.8.2 / п.8.3 ТЗ)
            </span>
            <span className="spacer" />
            <button
              onClick={() => {
                // Экспорт правил в JSON — п.6.1.6 ТЗ.
                const blob = new Blob(
                  [JSON.stringify(rules, null, 2)],
                  { type: 'application/json' },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'normalization-rules.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="Сохранить текущий набор правил в JSON-файл"
            >
              экспорт
            </button>
            <label
              className="button-like"
              title="Загрузить набор правил из JSON-файла (п.6.1.5 ТЗ)"
              style={{
                font: 'inherit',
                background: 'linear-gradient(180deg,#fff 0%,var(--bg-alt) 100%)',
                border: '1px solid var(--border)',
                padding: '3px 9px',
                cursor: 'pointer',
                borderRadius: 4,
                color: 'var(--fg)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              загрузить
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (
                      !data ||
                      !Array.isArray(data.modelRules) ||
                      !Array.isArray(data.classRules)
                    ) {
                      alert(
                        'Неверный формат: ожидается JSON с полями modelRules[] и classRules[].',
                      );
                      return;
                    }
                    setRules(data);
                    alert(
                      `Загружено правил: модели ${data.modelRules.length}, классы ${data.classRules.length}.`,
                    );
                  } catch (err) {
                    alert('Не удалось прочитать JSON: ' + (err as Error).message);
                  }
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <button
              onClick={resetRules}
              title="Сбросить к правилам «Простоев.Нет» по умолчанию"
            >
              сбросить
            </button>
          </div>
          <div className="muted small">
            Отключённые правила не применяются в «Нормализовать» и при
            ручной нормализации кода модели.
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <div>
              <div className="muted small" style={{ marginBottom: 4 }}>
                Модели (п.8.3, {rules.modelRules.length} правил)
              </div>
              {rules.modelRules.map((r) => (
                <label
                  key={r.id}
                  className="row-flex small"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}
                >
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggleRule('modelRules', r.id)}
                  />
                  <span>{r.description}</span>
                </label>
              ))}
            </div>
            <div>
              <div className="muted small" style={{ marginBottom: 4 }}>
                Классы/Подклассы (п.8.2, {rules.classRules.length})
              </div>
              {rules.classRules.map((r) => (
                <label
                  key={r.id}
                  className="row-flex small"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}
                >
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggleRule('classRules', r.id)}
                  />
                  <span>{r.description}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
