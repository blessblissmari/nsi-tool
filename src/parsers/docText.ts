/**
 * Извлечение текста из PDF/DOCX в браузере.
 *  - PDF: pdfjs-dist (legacy build для совместимости).
 *  - DOCX: mammoth (raw text).
 * Сами файлы НЕ хранятся — извлечённый текст и имя/URL прикрепляются к модели.
 */
// legacy-сборка совместима со старыми Chrome и не использует Uint8Array.toHex.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// mammoth не имеет официальных типов — импорт без типов.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - no types
import mammoth from 'mammoth';

export interface ExtractResult {
  text: string;
  pages?: number;
  warnings?: string[];
}

export async function extractTextFromFile(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return extractPdf(await file.arrayBuffer());
  if (name.endsWith('.docx')) return extractDocx(await file.arrayBuffer());
  if (name.endsWith('.txt') || name.endsWith('.csv')) {
    return { text: await file.text() };
  }
  throw new Error(`Не поддерживается формат «${file.name}» (только pdf, docx, txt)`);
}

export async function extractTextFromUrl(url: string): Promise<ExtractResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const ct = res.headers.get('content-type') || '';
  const u = url.toLowerCase();
  if (ct.includes('pdf') || u.endsWith('.pdf')) return extractPdf(buf);
  if (
    ct.includes('officedocument.wordprocessingml') ||
    u.endsWith('.docx')
  ) {
    return extractDocx(buf);
  }
  // Текст по умолчанию.
  return { text: new TextDecoder().decode(buf) };
}

async function extractPdf(buf: ArrayBuffer): Promise<ExtractResult> {
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items as Array<{ str: string; transform?: number[] }>;
    // Группируем элементы в строки по координате Y (transform[5]).
    const byY = new Map<number, string[]>();
    for (const it of items) {
      const y = Math.round((it.transform?.[5] ?? 0) * 10) / 10;
      const arr = byY.get(y) ?? [];
      arr.push(it.str);
      byY.set(y, arr);
    }
    const ys = Array.from(byY.keys()).sort((a, b) => b - a);
    for (const y of ys) lines.push((byY.get(y) ?? []).join(' '));
    lines.push('');
  }
  return { text: lines.join('\n').replace(/[ \t]+/g, ' ').trim(), pages: doc.numPages };
}

async function extractDocx(buf: ArrayBuffer): Promise<ExtractResult> {
  const r = await mammoth.extractRawText({ arrayBuffer: buf });
  return {
    text: r.value || '',
    warnings: r.messages?.map((m) => m.message),
  };
}
