import { useEffect, useMemo, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Tree } from './components/Tree';
import { NodePanel } from './components/NodePanel';
import { AiSettings } from './components/AiSettings';
import { useStore } from './store';
import { setAiProvider } from './domain/ai';
import {
  openaiAiProvider,
  readUsage,
  getApiKey,
  type AiUsage,
} from './domain/openai';
import {
  getUiSettings,
  subscribeUiSettings,
  type UiSettings,
} from './domain/uiSettings';
import './App.css';

setAiProvider(openaiAiProvider);

export default function App() {
  const [usage, setUsage] = useState<AiUsage>(() => readUsage());
  const [hasKey, setHasKey] = useState(() => !!getApiKey());
  const [showSettings, setShowSettings] = useState(false);
  const [ui, setUi] = useState<UiSettings>(() => getUiSettings());
  useEffect(() => {
    const onU = (e: Event) =>
      setUsage((e as CustomEvent<AiUsage>).detail ?? readUsage());
    const onK = () => setHasKey(!!getApiKey());
    window.addEventListener('nsi:ai-usage', onU);
    window.addEventListener('nsi:ai-key-changed', onK);
    const off = subscribeUiSettings(setUi);
    return () => {
      window.removeEventListener('nsi:ai-usage', onU);
      window.removeEventListener('nsi:ai-key-changed', onK);
      off();
    };
  }, []);

  return (
    <Inner
      usage={usage}
      hasKey={hasKey}
      setShowSettings={setShowSettings}
      showSettings={showSettings}
      ui={ui}
    />
  );
}

function Inner({
  usage,
  hasKey,
  setShowSettings,
  showSettings,
  ui,
}: {
  usage: AiUsage;
  hasKey: boolean;
  setShowSettings: (b: boolean) => void;
  showSettings: boolean;
  ui: UiSettings;
}) {
  const selectedModelId = useStore((s) => s.selectedModelId);
  const models = useStore((s) => s.models);
  const classifier = useStore((s) => s.classifier);
  const stats = useMemo(() => {
    const total = models.length;
    const norm = models.filter((x) => !!x.normalizedCode).length;
    const tor = models.filter(
      (x) => x.className && x.subclassName && x.normalizedCode,
    ).length;
    const unresolved = models.filter(
      (x) => x.classificationSource === 'unresolved',
    ).length;
    // п.7 Оценка качества данных:
    //  - полнота: средняя доля заполненных приоритетных характеристик по моделям с классом
    //  - проверено экспертом: доля моделей с галочкой
    //  - источник: распределение по classificationSource
    let priorTotal = 0;
    let priorFilled = 0;
    let expertOk = 0;
    for (const m of models) {
      if (m.validity?.expertVerified) expertOk++;
      const cls = classifier.classes.find((c) => c.name === m.className);
      const sub = cls?.subclasses.find((s) => s.name === m.subclassName);
      const prio = [
        ...(cls?.priorityChars ?? []),
        ...(sub?.priorityChars ?? []),
      ];
      if (!prio.length) continue;
      const keys = new Set(prio.map((p) => p.key));
      priorTotal += keys.size;
      const have = (m.characteristics ?? []).filter(
        (c) => keys.has(c.key) && c.valueRaw,
      );
      priorFilled += have.length;
    }
    const completeness = priorTotal > 0 ? priorFilled / priorTotal : 0;
    const expertPct = total > 0 ? expertOk / total : 0;
    return { total, norm, tor, unresolved, completeness, expertOk, expertPct };
  }, [models, classifier]);

  return (
    <div className="app">
      <header className="app-head">
        <span className="brand">НСИ</span>
        <span className="spacer" />
        <span className="stats">
          {stats.total > 0 ? (
            <>
              Моделей {stats.total} · ТОР {stats.tor}
              {stats.unresolved > 0 && <> · без класса {stats.unresolved}</>}
              {stats.total > 0 && (
                <>
                  {' · '}
                  <span title="п.7 ТЗ — средняя полнота приоритетных характеристик">
                    хар-к {Math.round(stats.completeness * 100)}%
                  </span>
                  {' · '}
                  <span title="п.7 ТЗ — доля моделей, проверенных экспертом">
                    проверено {stats.expertOk}/{stats.total}
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="muted">Нет данных — нажмите «Загрузить»</span>
          )}
        </span>
        <button
          onClick={() => setShowSettings(true)}
          title={
            hasKey
              ? `ИИ ${usage.requests} запросов · $${usage.costUsd.toFixed(4)}`
              : 'Настройки (ИИ-ключ, картинки, сброс демо)'
          }
        >
          Настройки{hasKey ? ` · ИИ $${usage.costUsd.toFixed(4)}` : ''}
        </button>
      </header>
      <Toolbar />
      <main
        className={
          'layout' +
          (ui.modelCardFullscreen && selectedModelId ? ' fullscreen-card' : '')
        }
      >
        <aside className="left">
          <Tree />
        </aside>
        <section className="right">
          <NodePanel />
        </section>
      </main>
      {showSettings && <AiSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
