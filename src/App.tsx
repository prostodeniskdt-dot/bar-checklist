import React, { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import fontUrl from "./fonts/Roboto-Regular.ttf?url"; // наш TTF как URL-ресурс

/** Базовые пункты чек-листа */
const DEFAULT_ITEMS = [
  "Оборудование включено и исправно; журнал температур заполнен",
  "Чистота стойки, раковин и поверхностей; мусор вынесен",
  "Стекло/посуда доведены до пар-уровней",
  "Станция укомплектована: трубочки/салфетки/гарниры/сиропы",
  "Заготовки и полуфабрикаты дозатарены по пар-уровням",
  "Кофе прогрет и откалиброван; молоко/сливки свежие",
  "Лёд ≥ 70% бункера; резервные вёдра заполнены",
  "Стоп-лист обновлён; заказ по бару отправлен",
  "Касса/терминал проверены; лента и зип-пакеты есть",
  "Бар готов за 10 минут до открытия: свет/музыка/форма"
];

const STORAGE_KEY = "barChecklist_v1";
const HISTORY_KEY = "barChecklist_history_v1";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function nowISO() {
  return new Date().toISOString();
}

/** Сжать фото перед сохранением (в DataURL) */
async function fileToDataUrlCompressed(file: File, maxSide = 1280, quality = 0.85) {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  let { width, height } = img;
  const scale = maxSide / Math.max(width, height);
  if (scale < 1) {
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** LocalStorage утилиты */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveState(state: any) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveHistory(arr: any[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch {}
}

/** Хелперы для PDF */
async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}
function fitWithin(w: number, h: number, maxW: number, maxH: number) {
  const k = Math.min(maxW / w, maxH / h);
  return { w: w * k, h: h * k };
}

/** Новый пустой чек-лист */
const emptyChecklist = () => ({
  id: uid(),
  createdAt: nowISO(),
  items: DEFAULT_ITEMS.map((t, idx) => ({
    id: uid(),
    title: t,
    done: false,
    note: "",
    photos: [] as string[],
    order: idx + 1
  }))
});

export default function App() {
  const [checklist, setChecklist] = useState(() => loadState() || emptyChecklist());
  const [history, setHistory] = useState(() => loadHistory());
  const [tab, setTab] = useState<"today" | "history" | "settings">("today");
  const [isMakingPdf, setIsMakingPdf] = useState(false);

  useEffect(() => saveState(checklist), [checklist]);
  useEffect(() => saveHistory(history), [history]);

  const completed = useMemo(() => checklist.items.filter((i: any) => i.done).length, [checklist]);
  const total = checklist.items.length;

  function resetChecklist() {
    setChecklist(emptyChecklist());
  }
  function updateItem(id: string, patch: any) {
    setChecklist((c: any) => ({
      ...c,
      items: c.items.map((it: any) => (it.id === id ? { ...it, ...patch } : it))
    }));
  }

  async function handleAddPhoto(itemId: string, files: FileList | null) {
    if (!files || !files.length) return;
    const maxPhotos = 4;
    const arr: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.type.startsWith("image/")) continue;
      const dataUrl = await fileToDataUrlCompressed(f);
      arr.push(dataUrl);
    }
    setChecklist((c: any) => ({
      ...c,
      items: c.items.map((it: any) =>
        it.id === itemId
          ? { ...it, photos: [...it.photos, ...arr].slice(0, maxPhotos), done: true }
          : it
      )
    }));
  }

  function removePhoto(itemId: string, idx: number) {
    setChecklist((c: any) => ({
      ...c,
      items: c.items.map((it: any) =>
        it.id === itemId ? { ...it, photos: it.photos.filter((_: any, i: number) => i !== idx) } : it
      )
    }));
  }

  function addCustomItem() {
    const t = prompt("Новый пункт (формулировка):");
    if (!t) return;
    setChecklist((c: any) => ({
      ...c,
      items: [...c.items, { id: uid(), title: t, done: false, note: "", photos: [], order: c.items.length + 1 }]
    }));
  }

  function removeItem(id: string) {
    if (!confirm("Удалить пункт?")) return;
    setChecklist((c: any) => ({
      ...c,
      items: c.items.filter((i: any) => i.id !== id).map((i: any, k: number) => ({ ...i, order: k + 1 }))
    }));
  }

  /** Генерация PDF с вшитым шрифтом и аккуратными фото */
  async function generatePdfAndShare(dataForPdf: any) {
    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

    // 1) Вшиваем кириллический шрифт
    const fontB64 = await urlToBase64(fontUrl);
    doc.addFileToVFS("Roboto-Regular.ttf", fontB64);
    doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
    doc.setFont("Roboto", "normal");

    // 2) Поля и сетка под фото (2 колонки)
    const margin = 12;
    const pageW = 210;
    const pageH = 297;
    const gap = 4;
    const cols = 2;
    const cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
    const cellH = 70; // фото крупнее
    let y = margin;

    const title = "Отчёт — Чек-лист открытия бара";
    const ts = new Date().toLocaleString();

    doc.setFontSize(16);
    doc.text(title, margin, y);
    y += 8;

    doc.setFontSize(11);
    doc.text(`Дата/время: ${ts}`, margin, y);
    y += 6;
    doc.text(`Чек-лист: ${dataForPdf.id}`, margin, y);
    y += 8;

    for (const it of dataForPdf.items) {
      const text = `${it.order}. ${it.title}`;
      const status = it.done ? "[Выполнено]" : "[Не выполнено]";
      const note = it.note ? `\nЗаметка: ${it.note}` : "";

      doc.setFontSize(12);
      const lines = doc.splitTextToSize(`${text} ${status}${note}`, pageW - margin * 2);
      for (const line of lines) {
        if (y > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += 6;
      }

      // Фото — по 2 на строку, с сохранением пропорций
      if (it.photos && it.photos.length) {
        let col = 0;
        let x = margin;

        for (const src of it.photos) {
          if (y + cellH > pageH - margin) {
            doc.addPage(); y = margin; col = 0; x = margin;
          }
          const img = await loadImg(src);
          const { w, h } = fitWithin(img.width, img.height, cellW, cellH);
          const dx = (cellW - w) / 2; // выровнять по центру ячейки
          doc.addImage(src, "JPEG", x + dx, y, w, h, undefined, "FAST");

          col++;
          if (col >= cols) {
            col = 0;
            x = margin;
            y += cellH + gap;
          } else {
            x += cellW + gap;
          }
        }

        if (col !== 0) y += cellH + 2; // дорисовать отступ, если строка неполная
      } else {
        y += 2;
      }

      if (y > pageH - margin) { doc.addPage(); y = margin; }
      doc.setLineWidth(0.2);
      doc.line(margin, y, pageW - margin, y);
      y += 4;
    }

    // 3) Сохранение/шаринг
    const blob = doc.output("blob");
    const fileName = `BarChecklist_Report_${new Date().toISOString().slice(0, 10)}.pdf`;

    try {
      const file = new File([blob], fileName, { type: "application/pdf" });
      const navAny = navigator as any;
      if (navAny.canShare && navAny.canShare({ files: [file] })) {
        await navAny.share({ files: [file], title: "Отчёт чек-лист" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }
  }

  async function finalizeReport() {
    setIsMakingPdf(true);
    try {
      const dataForPdf = { ...checklist, finalizedAt: nowISO() };
      const newHistory = [
        {
          id: dataForPdf.id,
          createdAt: dataForPdf.createdAt,
          finalizedAt: (dataForPdf as any).finalizedAt,
          items: dataForPdf.items,
          completed: dataForPdf.items.filter((i: any) => i.done).length,
          total: dataForPdf.items.length
        },
        ...history
      ].slice(0, 5);
      setHistory(newHistory);
      await generatePdfAndShare(dataForPdf);
      resetChecklist();
      setTab("today");
    } finally {
      setIsMakingPdf(false);
    }
  }

  function restoreFromHistory(h: any) {
    setChecklist({ id: h.id, createdAt: h.createdAt, items: h.items.map((it: any) => ({ ...it, id: uid() })) });
    setTab("today");
  }

  function clearHistory() {
    if (!confirm("Очистить историю отчётов?")) return;
    setHistory([]);
  }

  return (
    <div className="min-h-screen bg-black text-yellow-50">
      <header className="sticky top-0 z-10 bg-black/90 backdrop-blur border-b border-yellow-700/40">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-yellow-300">Чек-лист открытия бара</h1>
          <nav className="flex gap-1">
            <button className={`px-3 py-1.5 rounded-lg text-sm ${tab === "today" ? "bg-yellow-400 text-black" : "bg-zinc-800 text-yellow-50 hover:bg-zinc-700"}`} onClick={() => setTab("today")}>Сегодня</button>
            <button className={`px-3 py-1.5 rounded-lg text-sm ${tab === "history" ? "bg-yellow-400 text-black" : "bg-zinc-800 text-yellow-50 hover:bg-zinc-700"}`} onClick={() => setTab("history")}>История</button>
            <button className={`px-3 py-1.5 rounded-lg text-sm ${tab === "settings" ? "bg-yellow-400 text-black" : "bg-zinc-800 text-yellow-50 hover:bg-zinc-700"}`} onClick={() => setTab("settings")}>Настройки</button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {tab === "today" && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-yellow-400/80">Чек-лист: {checklist.id.slice(-8)}</div>
                <div className="text-base font-medium">Выполнено <span className="text-yellow-300">{completed}</span> из {total}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm" onClick={addCustomItem}>+ Пункт</button>
                <button className="px-3 py-2 rounded-lg bg-black border border-yellow-700/40 text-sm" onClick={resetChecklist}>Сбросить</button>
                <button disabled={isMakingPdf} className="px-3 py-2 rounded-lg bg-yellow-400 text-black text-sm disabled:opacity-60" onClick={finalizeReport}>{isMakingPdf ? "Формируем PDF…" : "Сформировать отчёт (PDF)"}</button>
              </div>
            </div>

            <ul className="space-y-3">
              {checklist.items.map((item: any) => (
                <li key={item.id} className="bg-zinc-900 rounded-2xl border border-yellow-700/40 p-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={e => updateItem(item.id, { done: e.target.checked })}
                      className="mt-1 h-5 w-5 accent-yellow-400"
                      aria-label="Отметить выполненным"
                    />
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-medium leading-6">
                          <span className="text-yellow-400/80 mr-1">{item.order}.</span>
                          {item.title}
                        </h3>
                        <button onClick={() => removeItem(item.id)} className="text-xs text-yellow-400/80 hover:text-red-400">Удалить</button>
                      </div>

                      <div className="mt-2 grid gap-2">
                        <textarea
                          value={item.note}
                          onChange={e => updateItem(item.id, { note: e.target.value })}
                          placeholder="Заметка / что сделали / проблемы"
                          className="w-full min-h-[56px] rounded-xl border border-yellow-700/40 bg-black px-3 py-2 text-sm placeholder-yellow-400/60 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        />

                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-zinc-800 rounded-xl cursor-pointer hover:bg-zinc-700">
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              multiple
                              className="hidden"
                              onChange={e => handleAddPhoto(item.id, e.target.files)}
                            />
                            📷 Добавить фото
                          </label>
                          <span className="text-xs text-yellow-400/80">Фото закрепятся за этим пунктом</span>
                        </div>

                        {item.photos.length > 0 && (
                          <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {item.photos.map((src: string, idx: number) => (
                              <figure key={idx} className="relative group">
                                <img src={src} alt={`Фото ${idx + 1}`} className="w-full h-28 object-cover rounded-xl border border-yellow-700/40" />
                                <button
                                  onClick={() => removePhoto(item.id, idx)}
                                  className="absolute top-1 right-1 text-xs bg-black/80 px-2 py-1 rounded-full border border-yellow-700/40 opacity-0 group-hover:opacity-100"
                                >Удалить</button>
                              </figure>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "history" && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-yellow-300">История отчётов</h2>
              {history.length > 0 && (
                <button className="px-3 py-2 rounded-lg bg-black border border-yellow-700/40 text-sm" onClick={clearHistory}>Очистить</button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="text-yellow-400/80">Ещё нет сохранённых отчётов.</p>
            ) : (
              <ul className="space-y-3">
                {history.map((h: any) => (
                  <li key={h.id} className="bg-zinc-900 rounded-2xl border border-yellow-700/40 p-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">Отчёт {h.id.slice(-8)}</div>
                        <div className="text-sm text-yellow-400/80">
                          Создан: {new Date(h.createdAt).toLocaleString()} {h.finalizedAt ? `· Финализирован: ${new Date(h.finalizedAt).toLocaleString()}` : ""}
                        </div>
                        <div className="text-sm">Выполнено: <span className="text-yellow-300">{h.completed}</span>/{h.total}</div>
                      </div>
                      <div className="flex gap-2">
                        <button className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm" onClick={() => restoreFromHistory(h)}>Открыть</button>
                        <button className="px-3 py-2 rounded-lg bg-yellow-400 text-black text-sm" onClick={() => generatePdfAndShare(h)}>PDF</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "settings" && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-yellow-300">Настройки</h2>
            <div className="bg-zinc-900 rounded-2xl border border-yellow-700/40 p-4 space-y-3">
              <div>
                <div className="font-medium mb-1">Пункты чек-листа по умолчанию</div>
                <p className="text-sm text-yellow-400/80">Эти пункты подставляются при создании нового чек-листа. Текущий список не меняется автоматически.</p>
                <EditableDefaults />
              </div>
              <div className="pt-2 border-t border-yellow-700/40">
                <button
                  className="px-3 py-2 rounded-lg bg-black border border-yellow-700/40 text-sm"
                  onClick={() => { localStorage.removeItem(STORAGE_KEY); setChecklist(emptyChecklist()); }}
                >Сбросить сегодня</button>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="mx-auto max-w-4xl px-4 pb-6 text-center text-xs text-yellow-400/70">
        Фото и данные сохраняются локально на устройстве (localStorage).
      </footer>
    </div>
  );
}

function EditableDefaults() {
  const [draft, setDraft] = useState(DEFAULT_ITEMS.join("\n"));

  function apply() {
    const lines = draft.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return alert("Нужно хотя бы 1 пункт");
    DEFAULT_ITEMS.length = 0;
    lines.forEach(l => DEFAULT_ITEMS.push(l));
    alert("Шаблон обновлён. Создайте новый чек-лист — он подставит обновлённые пункты.");
  }

  return (
    <div>
      <textarea
        className="w-full min-h-[200px] rounded-xl border border-yellow-700/40 bg-black px-3 py-2 text-sm text-yellow-50 placeholder-yellow-400/60 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        value={draft}
        onChange={e => setDraft(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <button className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm" onClick={apply}>Сохранить шаблон</button>
        <button className="px-3 py-2 rounded-lg bg-black border border-yellow-700/40 text-sm" onClick={() => setDraft(DEFAULT_ITEMS.join("\n"))}>Отменить</button>
      </div>
    </div>
  );
}
