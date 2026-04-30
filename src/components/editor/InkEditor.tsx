import { useCallback, useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import { useNotesStore } from "../../stores/notesStore";
import { useAutoSave } from "../../hooks/useAutoSave";

// ---- InkDoc types ----
interface Stroke {
  pts: [number, number][];
  size: number;
  color: string;
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
const PEN_SIZE = 4;
const FREEHAND_OPTIONS = { size: PEN_SIZE, thinning: 0, smoothing: 0.5, streamline: 0.5 };

function getPenColor(): string {
  return document.documentElement.classList.contains("dark") ? "#FFFFFF" : "#000000";
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
  scaleX = 1,
) {
  const scaledPts = pts.map(([x, y]) => [x * scaleX, y] as [number, number]);
  const outline = getStroke(scaledPts, { ...FREEHAND_OPTIONS, size: size * scaleX });
  if (outline.length === 0) return;
  const path = new Path2D(svgPathFromStroke(outline));
  ctx.fillStyle = color;
  ctx.fill(path);
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

  // Measure actual rendered canvas width
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
    for (const s of doc.strokes) {
      drawStrokeOnCtx(ctx, s.pts, s.size, s.color, scaleX);
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
    // Defer until canvas is sized
    requestAnimationFrame(() => {
      redrawCommitted(doc, canvasWidthRef.current);
    });
  }, [activeId, activeContent, redrawCommitted]);

  // Redraw when canvas width changes
  useEffect(() => {
    redrawCommitted(inkDocRef.current, canvasWidth);
  }, [canvasWidth, redrawCommitted]);

  // ---- Manual scroll state ----
  const scrollTopRef = useRef(0);
  const fingerStartYRef = useRef<number | null>(null);
  const fingerScrollStartRef = useRef(0);

  // Keep scrollTopRef in sync when scroll happens by other means (wheel, keyboard)
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
    // Draw committed layer first (via drawImage for performance)
    const committed = committedRef.current;
    if (committed) ctx.drawImage(committed, 0, 0);
    drawStrokeOnCtx(ctx, currentPts.current, PEN_SIZE, getPenColor());
  }, []);

  const commitStroke = useCallback(() => {
    if (currentPts.current.length === 0) return;
    const stroke: Stroke = {
      pts: [...currentPts.current],
      size: PEN_SIZE,
      color: getPenColor(),
    };
    inkDocRef.current.strokes.push(stroke);
    drawStrokeOnCtx(committedRef.current!.getContext("2d")!, stroke.pts, stroke.size, stroke.color);
    // Clear active canvas
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

  // WebKit Touch Events API: Touch.touchType === "stylus" for Apple Pencil
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

    // ---- Touch Events — registered on the scroll container so ALL touches are seen first ----
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (isStylusTouch(touch)) {
        // Apple Pencil → start drawing
        e.preventDefault();
        isDrawing.current = true;
        fingerStartYRef.current = null;
        const [x, y] = getCoords(touch.clientX, touch.clientY);
        currentPts.current = [[x, y]];
        drawActiveStroke();
      } else {
        // Finger → track for manual scroll
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
        // Finger scroll
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

    // ---- Pointer Events (macOS mouse/stylus) ----
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

    // Touch events on container (captures before native scroll)
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("touchcancel", onTouchCancel);

    // Pointer events on canvas (macOS)
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
      {/* Scrollable area — overflow-hidden + touch-action:none so all touch events reach JS first */}
      <div ref={scrollRef} className="flex-1 overflow-hidden" style={{ touchAction: "none" }}>
        <div className="w-full sm:max-w-[720px] mx-auto px-8 sm:px-16 py-6 sm:py-10">
          {/* Title */}
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

          {/* Canvas area */}
          {loading && !activeContent ? (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            </div>
          ) : (
            <div
              className="relative w-full"
              style={{ height: canvasHeight }}
            >
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

      {/* Status bar */}
      <div className="shrink-0 flex items-center justify-end gap-4 px-6 py-1.5 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400">
        <span>{strokeCount} strokes</span>
        <span className={syncing ? "text-blue-500" : dirty ? "text-amber-500" : ""}>
          {statusText}
        </span>
      </div>
    </div>
  );
}
