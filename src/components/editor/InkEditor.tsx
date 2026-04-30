import { useCallback, useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { useNotesStore } from "../../stores/notesStore";
import { useAutoSave } from "../../hooks/useAutoSave";

// ---- InkDoc types ----
interface Stroke {
  pts: [number, number][];
  size: number;
  color: string;
  isEraser?: boolean;
}

interface InkDoc {
  version: 1;
  canvasWidth: number;
  height: number;
  strokes: Stroke[];
}

const CANVAS_MAX_WIDTH = 720;
const INITIAL_HEIGHT = 1500;
const EXTEND_THRESHOLD = 200;
const EXTEND_BY = 500;
const ERASER_SIZE = 24;
const FREEHAND_OPTIONS = { thinning: 0, smoothing: 0.5, streamline: 0.5 };

const PEN_COLORS = [
  { label: "Black",      light: "#000000", dark: "#FFFFFF" },
  { label: "Dark Blue",  light: "#1D4ED8", dark: "#60A5FA" },
  { label: "Red",        light: "#DC2626", dark: "#F87171" },
  { label: "Green",      light: "#16A34A", dark: "#4ADE80" },
  { label: "Orange",     light: "#EA580C", dark: "#FB923C" },
  { label: "Purple",     light: "#7C3AED", dark: "#A78BFA" },
] as const;

const PEN_SIZES = [
  { label: "S", size: 2 },
  { label: "M", size: 4 },
  { label: "L", size: 8 },
  { label: "XL", size: 16 },
] as const;

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getDefaultColor(): string {
  return isDarkMode() ? PEN_COLORS[0].dark : PEN_COLORS[0].light;
}

function svgPathFromStroke(stroke: number[][]): string {
  if (stroke.length < 2) return "";
  const d: string[] = [`M ${stroke[0][0]} ${stroke[0][1]}`];
  for (let i = 1; i < stroke.length - 1; i++) {
    const mx = (stroke[i][0] + stroke[i + 1][0]) / 2;
    const my = (stroke[i][1] + stroke[i + 1][1]) / 2;
    d.push(`Q ${stroke[i][0]} ${stroke[i][1]} ${mx} ${my}`);
  }
  d.push("Z");
  return d.join(" ");
}

function drawStrokeOnCtx(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  size: number,
  color: string,
  isEraser = false,
  scaleX = 1,
) {
  const scaledPts = pts.map(([x, y]) => [x * scaleX, y] as [number, number]);
  const outline = getStroke(scaledPts, { ...FREEHAND_OPTIONS, size: size * scaleX });
  if (outline.length === 0) return;
  const path = new Path2D(svgPathFromStroke(outline));
  if (isEraser) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fill(path);
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
}

function parseInkDoc(raw: string): InkDoc | null {
  try {
    const doc = JSON.parse(raw) as InkDoc;
    if (doc.version === 1 && Array.isArray(doc.strokes)) return doc;
  } catch {
    // ignore
  }
  return null;
}

export default function InkEditor() {
  const {
    activeId,
    activeContent,
    activeTitle,
    setActiveTitle,
    markDirty,
    syncing,
    dirty,
    loading,
  } = useNotesStore();
  useAutoSave();

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLCanvasElement>(null);

  const [canvasHeight, setCanvasHeight] = useState(INITIAL_HEIGHT);
  const [strokeCount, setStrokeCount] = useState(0);

  // ---- Tool state ----
  const [penColor, setPenColor] = useState(getDefaultColor);
  const [penSize, setPenSize] = useState(4);
  const [mode, setMode] = useState<"pen" | "eraser">("pen");
  // Keep mutable refs for use inside event handlers without stale closures
  const penColorRef = useRef(penColor);
  const penSizeRef = useRef(penSize);
  const modeRef = useRef(mode);
  useEffect(() => { penColorRef.current = penColor; }, [penColor]);
  useEffect(() => { penSizeRef.current = penSize; }, [penSize]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Track dark mode changes
  const [isDark, setIsDark] = useState(() => isDarkMode());
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dark = isDarkMode();
      setIsDark(dark);
      // Shift the default (first) color to match the new theme
      setPenColor(prev => {
        const match = PEN_COLORS.find(c => c.light === prev || c.dark === prev);
        return match ? (dark ? match.dark : match.light) : (dark ? "#FFFFFF" : "#000000");
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Mutable refs — not in state to avoid re-renders during drawing
  const inkDocRef = useRef<InkDoc>({
    version: 1,
    canvasWidth: CANVAS_MAX_WIDTH,
    height: INITIAL_HEIGHT,
    strokes: [],
  });
  const currentPts = useRef<[number, number][]>([]);
  const isDrawing = useRef(false);

  // ---- Canvas width (responsive) ----
  const canvasWidthRef = useRef(CANVAS_MAX_WIDTH);
  const [canvasWidth, setCanvasWidthState] = useState(CANVAS_MAX_WIDTH);

  const measureWidth = useCallback(() => {
    const el = committedRef.current;
    if (!el) return;
    const w = Math.min(el.parentElement?.clientWidth ?? CANVAS_MAX_WIDTH, CANVAS_MAX_WIDTH);
    canvasWidthRef.current = w;
    setCanvasWidthState(w);
  }, []);

  useEffect(() => {
    measureWidth();
    const ro = new ResizeObserver(measureWidth);
    if (committedRef.current?.parentElement) ro.observe(committedRef.current.parentElement);
    return () => ro.disconnect();
  }, [measureWidth]);

  // ---- Redraw committed canvas from inkDoc ----
  const redrawCommitted = useCallback((doc: InkDoc, targetWidth: number) => {
    const canvas = committedRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scaleX = targetWidth / (doc.canvasWidth || targetWidth);
    const dark = isDarkMode();
    for (const s of doc.strokes) {
      const color = s.isEraser ? "rgba(0,0,0,1)" : (s.color || (dark ? "#FFFFFF" : "#000000"));
      drawStrokeOnCtx(ctx, s.pts, s.size, color, s.isEraser ?? false, scaleX);
    }
  }, []);

  // ---- Load ink content when note changes ----
  useEffect(() => {
    if (!activeContent) {
      inkDocRef.current = {
        version: 1,
        canvasWidth: CANVAS_MAX_WIDTH,
        height: INITIAL_HEIGHT,
        strokes: [],
      };
      setCanvasHeight(INITIAL_HEIGHT);
      setStrokeCount(0);
      const ctx = committedRef.current?.getContext("2d");
      ctx?.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    const doc = parseInkDoc(activeContent);
    if (!doc) return;
    inkDocRef.current = doc;
    const h = Math.max(doc.height, INITIAL_HEIGHT);
    setCanvasHeight(h);
    setStrokeCount(doc.strokes.length);
    requestAnimationFrame(() => {
      redrawCommitted(doc, canvasWidthRef.current);
    });
  }, [activeId, activeContent, redrawCommitted]);

  // Redraw when canvas width or dark mode changes
  useEffect(() => {
    redrawCommitted(inkDocRef.current, canvasWidth);
  }, [canvasWidth, isDark, redrawCommitted]);

  // ---- Apple Pencil double-tap (native iOS dispatches this event) ----
  useEffect(() => {
    const handler = () => setMode(m => m === "pen" ? "eraser" : "pen");
    window.addEventListener("pencil-double-tap", handler);
    return () => window.removeEventListener("pencil-double-tap", handler);
  }, []);

  // ---- Manual scroll state ----
  const scrollTopRef = useRef(0);
  const fingerStartYRef = useRef<number | null>(null);
  const fingerScrollStartRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => { scrollTopRef.current = el.scrollTop; };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // ---- Auto-resize title ----
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [activeTitle]);

  // ---- Extend canvas when drawing near bottom ----
  const maybeExtend = useCallback((y: number) => {
    const currentH = inkDocRef.current.height;
    if (y > currentH - EXTEND_THRESHOLD) {
      const newH = currentH + EXTEND_BY;
      inkDocRef.current.height = newH;
      setCanvasHeight(newH);
    }
  }, []);

  // ---- Serialize and mark dirty ----
  const persistDoc = useCallback(() => {
    markDirty(JSON.stringify(inkDocRef.current));
  }, [markDirty]);

  // ---- Drawing helpers ----
  const drawActiveStroke = useCallback(() => {
    const canvas = activeRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (currentPts.current.length === 0) return;
    const committed = committedRef.current;
    if (committed) ctx.drawImage(committed, 0, 0);
    const eraser = modeRef.current === "eraser";
    const size = eraser ? ERASER_SIZE : penSizeRef.current;
    drawStrokeOnCtx(ctx, currentPts.current, size, penColorRef.current, eraser);
  }, []);

  const commitStroke = useCallback(() => {
    if (currentPts.current.length === 0) return;
    const eraser = modeRef.current === "eraser";
    const stroke: Stroke = {
      pts: [...currentPts.current],
      size: eraser ? ERASER_SIZE : penSizeRef.current,
      color: eraser ? "rgba(0,0,0,1)" : penColorRef.current,
      isEraser: eraser || undefined,
    };
    inkDocRef.current.strokes.push(stroke);
    drawStrokeOnCtx(
      committedRef.current!.getContext("2d")!,
      stroke.pts,
      stroke.size,
      stroke.color,
      stroke.isEraser ?? false,
    );
    const actCtx = activeRef.current?.getContext("2d");
    actCtx?.clearRect(0, 0, actCtx.canvas.width, actCtx.canvas.height);
    currentPts.current = [];
    setStrokeCount(inkDocRef.current.strokes.length);
    persistDoc();
  }, [persistDoc]);

  // ---- Input event helpers ----
  const getCoords = (clientX: number, clientY: number): [number, number] => {
    const rect = activeRef.current!.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  };

  const isStylusTouch = (touch: Touch): boolean =>
    (touch as Touch & { touchType?: string }).touchType === "stylus";

  const isPenPointer = (e: PointerEvent): boolean =>
    e.pointerType === "pen" || e.pointerType === "stylus";

  // ---- Manual scroll helpers ----
  const scrollTo = useCallback((target: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const next = Math.max(0, Math.min(maxScroll, target));
    scrollTopRef.current = next;
    el.scrollTop = next;
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (isStylusTouch(touch)) {
        e.preventDefault();
        isDrawing.current = true;
        fingerStartYRef.current = null;
        const [x, y] = getCoords(touch.clientX, touch.clientY);
        currentPts.current = [[x, y]];
        drawActiveStroke();
      } else {
        fingerStartYRef.current = touch.clientY;
        fingerScrollStartRef.current = scrollTopRef.current;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (isStylusTouch(touch)) {
        if (!isDrawing.current) return;
        e.preventDefault();
        const [x, y] = getCoords(touch.clientX, touch.clientY);
        currentPts.current.push([x, y]);
        maybeExtend(y + scrollTopRef.current);
        drawActiveStroke();
      } else {
        if (fingerStartYRef.current === null) return;
        e.preventDefault();
        const delta = fingerStartYRef.current - touch.clientY;
        scrollTo(fingerScrollStartRef.current + delta);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (isStylusTouch(touch)) {
        if (!isDrawing.current) return;
        isDrawing.current = false;
        commitStroke();
      } else {
        fingerStartYRef.current = null;
      }
    };

    const onTouchCancel = () => {
      fingerStartYRef.current = null;
      if (!isDrawing.current) return;
      isDrawing.current = false;
      currentPts.current = [];
      const actCtx = activeRef.current?.getContext("2d");
      actCtx?.clearRect(0, 0, actCtx.canvas.width, actCtx.canvas.height);
    };

    const canvas = activeRef.current;
    const onPointerDown = (e: PointerEvent) => {
      if (!isPenPointer(e)) return;
      if (isDrawing.current) return;
      e.preventDefault();
      isDrawing.current = true;
      canvas?.setPointerCapture(e.pointerId);
      const [x, y] = getCoords(e.clientX, e.clientY);
      currentPts.current = [[x, y]];
      drawActiveStroke();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDrawing.current) return;
      if (!isPenPointer(e)) return;
      e.preventDefault();
      const [x, y] = getCoords(e.clientX, e.clientY);
      currentPts.current.push([x, y]);
      maybeExtend(y + scrollTopRef.current);
      drawActiveStroke();
    };

    const onPointerUp = (_e: PointerEvent) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      commitStroke();
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("touchcancel", onTouchCancel);

    if (canvas) {
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onTouchCancel);
    }

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchCancel);
      if (canvas) {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onTouchCancel);
      }
    };
  }, [drawActiveStroke, commitStroke, maybeExtend, scrollTo]);

  const statusText = syncing ? "Saving…" : dirty ? "Unsaved" : "Saved";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Scrollable drawing area */}
      <div ref={scrollRef} className="flex-1 overflow-hidden" style={{ touchAction: "none" }}>
        <div className="w-full sm:max-w-[720px] mx-auto px-8 sm:px-16 py-6 sm:py-10">
          <textarea
            ref={titleRef}
            value={activeTitle}
            onChange={(e) => {
              setActiveTitle(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            placeholder="Untitled"
            rows={1}
            className="w-full resize-none overflow-hidden bg-transparent text-4xl font-bold text-gray-900 dark:text-gray-100 outline-none mb-6 leading-tight placeholder-gray-300 dark:placeholder-gray-600"
          />

          {loading && !activeContent ? (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            </div>
          ) : (
            <div className="relative w-full" style={{ height: canvasHeight }}>
              <canvas
                ref={committedRef}
                width={canvasWidth}
                height={canvasHeight}
                className="absolute inset-0 pointer-events-none"
                style={{ background: "transparent" }}
              />
              <canvas
                ref={activeRef}
                width={canvasWidth}
                height={canvasHeight}
                className="absolute inset-0"
                style={{ background: "transparent" }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Tool palette */}
      <div className="shrink-0 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-3 px-4 py-2 overflow-x-auto">
          {/* Color swatches */}
          <div className="flex items-center gap-1.5">
            {PEN_COLORS.map((c) => {
              const colorVal = isDark ? c.dark : c.light;
              const active = mode === "pen" && penColor === colorVal;
              return (
                <button
                  key={c.label}
                  title={c.label}
                  onClick={() => { setPenColor(colorVal); setMode("pen"); }}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    active
                      ? "border-blue-500 scale-110"
                      : "border-transparent hover:scale-110"
                  }`}
                  style={{ backgroundColor: colorVal }}
                />
              );
            })}
          </div>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 shrink-0" />

          {/* Size buttons */}
          <div className="flex items-center gap-1">
            {PEN_SIZES.map((s) => (
              <button
                key={s.label}
                onClick={() => { setPenSize(s.size); setMode("pen"); }}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  mode === "pen" && penSize === s.size
                    ? "bg-blue-500 text-white"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 shrink-0" />

          {/* Eraser */}
          <button
            onClick={() => setMode(m => m === "eraser" ? "pen" : "eraser")}
            title="Eraser (or double-tap Apple Pencil)"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "eraser"
                ? "bg-amber-500 text-white"
                : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path d="M22 21H7" />
              <path d="m5 11 9 9" />
            </svg>
            Erase
          </button>

          {/* Spacer + status */}
          <div className="ml-auto flex items-center gap-3 shrink-0 text-xs text-gray-400">
            <span>{strokeCount} strokes</span>
            <span className={syncing ? "text-blue-500" : dirty ? "text-amber-500" : ""}>
              {statusText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
