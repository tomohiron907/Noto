import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";

type MathEntry = { latex: string; isBlock: boolean };

// Extract math blocks before markdown parsing to prevent mangling of \ and _
function protectMath(text: string): { result: string; map: Map<string, MathEntry> } {
  const map = new Map<string, MathEntry>();
  let counter = 0;

  // Block math: $$...$$ (possibly multiline)
  let result = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    const key = `XBMX${counter++}X`;
    map.set(key, { latex: latex.trim(), isBlock: true });
    return key;
  });

  // Inline math: $...$ (single line, non-empty)
  result = result.replace(/\$([^$\n]+?)\$/g, (_, latex) => {
    const key = `XIMX${counter++}X`;
    map.set(key, { latex: latex.trim(), isBlock: false });
    return key;
  });

  return { result, map };
}

function escapeAttr(latex: string): string {
  return latex
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Replace placeholders with TipTap math node HTML after markdown parsing
function restoreMath(html: string, map: Map<string, MathEntry>): string {
  let result = html;
  for (const [key, entry] of map) {
    const attr = escapeAttr(entry.latex);
    if (entry.isBlock) {
      const blockHtml = `<div data-type="block-math" data-latex="${attr}"></div>`;
      // markdown-it wraps standalone lines in <p>; unwrap for block math
      result = result.replace(new RegExp(`<p[^>]*>\\s*${key}\\s*</p>`, "g"), blockHtml);
      // Fallback: not wrapped
      result = result.replace(new RegExp(key, "g"), blockHtml);
    } else {
      result = result.replace(
        new RegExp(key, "g"),
        `<span data-type="inline-math" data-latex="${attr}"></span>`,
      );
    }
  }
  return result;
}

export const markdownPaste = Extension.create({
  name: "markdownPaste",

  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain");
            if (!text?.trim()) return false;

            const storage = editor.storage as Record<string, any>;
            const parser = storage?.markdown?.parser;
            if (!parser) return false;

            // Protect math content before markdown parsing (prevents \ and _ mangling)
            const { result: protectedText, map: mathMap } = protectMath(text);

            // Full block-level markdown parsing
            const html = parser.parse(protectedText);

            // Restore math as proper TipTap math node elements
            const restoredHtml = restoreMath(html, mathMap);

            const el = document.createElement("div");
            el.innerHTML = restoredHtml.trim();

            const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(el, {
              preserveWhitespace: true,
            });

            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
