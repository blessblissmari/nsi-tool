/**
 * Настройки UI инструмента, которые не относятся к доменным данным
 * (картинки моделей, режим карточки на весь экран и т.п.).
 *
 * Храним в localStorage, событие "nsi:ui-settings" уведомляет подписчиков.
 */
export interface UiSettings {
  /** Показывать картинки моделей в карточке и в таблице. */
  showModelImages: boolean;
  /** Карточка модели разворачивается на весь экран (скрывает дерево). */
  modelCardFullscreen: boolean;
}

const KEY = 'nsi_ui_settings';

const DEFAULTS: UiSettings = {
  showModelImages: true,
  modelCardFullscreen: false,
};

let cached: UiSettings | null = null;

function read(): UiSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiSettings>;
      cached = { ...DEFAULTS, ...parsed };
      return cached;
    }
  } catch {
    /* ignore */
  }
  cached = { ...DEFAULTS };
  return cached;
}

export function getUiSettings(): UiSettings {
  return read();
}

export function setUiSettings(patch: Partial<UiSettings>): UiSettings {
  cached = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    /* ignore quota/private mode */
  }
  window.dispatchEvent(
    new CustomEvent<UiSettings>('nsi:ui-settings', { detail: cached }),
  );
  return cached;
}

/** Подписка для React-компонентов — вызывает cb при каждом изменении настроек. */
export function subscribeUiSettings(
  cb: (s: UiSettings) => void,
): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<UiSettings>).detail;
    cb(detail ?? read());
  };
  window.addEventListener('nsi:ui-settings', handler);
  return () => window.removeEventListener('nsi:ui-settings', handler);
}
