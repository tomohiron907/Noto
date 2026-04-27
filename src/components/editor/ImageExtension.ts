import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ResizableImageView } from "./ResizableImageView";

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
        parseHTML: (el) => {
          const w = el.getAttribute("width");
          return w ? parseInt(w, 10) : null;
        },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const { src, alt, width } = node.attrs as {
            src: string;
            alt?: string;
            width?: number;
          };
          const uri = width ? `${src}?w=${width}` : src;
          state.write(`![${alt ?? ""}](${uri})`);
        },
        parse: {
          // tiptap-markdown will parse standard markdown image syntax.
          // We intercept here to extract ?w= from noto-asset:// URIs.
          updateDOM(el: HTMLImageElement) {
            const src = el.getAttribute("src") ?? "";
            if (src.startsWith("noto-asset://")) {
              const [base, query] = src.split("?");
              const params = new URLSearchParams(query ?? "");
              const w = params.get("w");
              el.setAttribute("src", base);
              if (w) el.setAttribute("width", w);
            }
          },
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
