import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const { src, alt, width } = node.attrs as { src: string; alt?: string; width?: number };
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      startX.current = e.clientX;
      startWidth.current = width ?? 400;

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX.current;
        const newWidth = Math.max(80, startWidth.current + delta);
        updateAttributes({ width: Math.round(newWidth) });
      };

      const onUp = () => {
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, updateAttributes],
  );

  return (
    <NodeViewWrapper
      className="inline-block relative"
      style={{ width: width ? `${width}px` : undefined }}
    >
      <img
        src={src}
        alt={alt ?? ""}
        style={{ width: "100%", display: "block" }}
        draggable={false}
      />
      {selected && (
        <div
          onPointerDown={onPointerDown}
          className="absolute bottom-0 right-0 w-3 h-3 bg-blue-500 cursor-ew-resize rounded-sm"
          style={{ cursor: dragging ? "ew-resize" : "ew-resize" }}
        />
      )}
    </NodeViewWrapper>
  );
}
