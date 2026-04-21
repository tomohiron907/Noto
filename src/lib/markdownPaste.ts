import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";

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

            // Full block-level markdown parsing — no inline:true
            const html = parser.parse(text);
            const el = document.createElement("div");
            el.innerHTML = html.trim();

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
