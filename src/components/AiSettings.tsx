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

interface Props {
  onClose: () => void;
}

export function AiSettings({ onClose }: Props) {
  const [key, setKey] = useState(() => getApiKey() ?? '');
  const [usage, setUsage] = useState<AiUsage>(() => readUsage());
  const [revealed, setRevealed] = useState(false);
  const [ui, setUi] = useState<UiSettings>(() => getUiSettings());

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
          maxWidth: 600,
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
        </div>
      </div>
    </div>
  );
}
