import { Extension, Node } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const pluginKey = new PluginKey<EditState>("mathEditing");

type EditState =
  | { mode: "idle" }
  | { mode: "inline"; from: number; to: number }
  | { mode: "block"; from: number };

function enterInlineEdit(view: EditorView, nodePos: number, latex: string) {
  const rawText = "$" + latex + "$";
  const tr = view.state.tr.replaceWith(
    nodePos,
    nodePos + 1,
    view.state.schema.text(rawText)
  );
  const cursorPos = nodePos + 1;
  tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  tr.setMeta(pluginKey, {
    mode: "inline",
    from: nodePos,
    to: nodePos + rawText.length,
  });
  view.dispatch(tr);
}

function exitInlineEdit(view: EditorView, state: { from: number; to: number }) {
  const { from, to } = state;
  const doc = view.state.doc;
  if (from >= doc.content.size || to > doc.content.size) return;
  const text = doc.textBetween(from, to);
  const match = text.match(/^\$(.+)\$$/s);
  const latex = match ? match[1] : text;
  const node = view.state.schema.nodes.inlineMath?.create({ latex });
  if (!node) return;
  const tr = view.state.tr
    .replaceWith(from, to, node)
    .setMeta(pluginKey, { mode: "idle" });
  view.dispatch(tr);
}

function enterBlockEdit(view: EditorView, nodePos: number, latex: string) {
  const { schema } = view.state;
  const contentNode = latex ? schema.text(latex) : undefined;
  const mathSrc = schema.nodes.mathSource.create(
    null,
    contentNode ? [contentNode] : []
  );
  const tr = view.state.tr.replaceWith(nodePos, nodePos + 1, mathSrc);
  tr.setSelection(TextSelection.create(tr.doc, nodePos + 1));
  tr.setMeta(pluginKey, { mode: "block", from: nodePos });
  view.dispatch(tr);
}

function exitBlockEdit(view: EditorView, state: { from: number }) {
  const { from } = state;
  const doc = view.state.doc;
  if (from >= doc.content.size) return;
  const node = doc.nodeAt(from);
  if (!node || node.type.name !== "mathSource") return;
  const latex = node.textContent.trim();
  const blockMathNode = view.state.schema.nodes.blockMath?.create({ latex });
  if (!blockMathNode) return;
  const tr = view.state.tr
    .replaceWith(from, from + node.nodeSize, blockMathNode)
    .setMeta(pluginKey, { mode: "idle" });
  view.dispatch(tr);
}

function isInsideRange(pos: number, from: number, to: number) {
  return pos >= from && pos <= to;
}

const mathEditingPlugin = new Plugin<EditState>({
  key: pluginKey,
  state: {
    init() {
      return { mode: "idle" };
    },
    apply(tr, prev) {
      const meta = tr.getMeta(pluginKey) as EditState | undefined;
      if (meta) return meta;
      if (prev.mode === "inline") {
        return {
          mode: "inline",
          from: tr.mapping.map(prev.from),
          to: tr.mapping.map(prev.to),
        };
      }
      if (prev.mode === "block") {
        return { mode: "block", from: tr.mapping.map(prev.from) };
      }
      return prev;
    },
  },
  view() {
    let dispatching = false;
    return {
      update(view, prevState) {
        if (dispatching) return;
        const editState = pluginKey.getState(view.state);
        if (!editState) return;

        const { selection } = view.state;

        if (editState.mode === "idle") {
          // Entering edit mode: detect NodeSelection on math nodes
          if (
            selection instanceof NodeSelection &&
            prevState.selection.eq(selection) === false
          ) {
            const node = selection.node;
            const nodePos = selection.from;
            if (node.type.name === "inlineMath") {
              dispatching = true;
              enterInlineEdit(view, nodePos, node.attrs.latex ?? "");
              dispatching = false;
            } else if (node.type.name === "blockMath") {
              dispatching = true;
              enterBlockEdit(view, nodePos, node.attrs.latex ?? "");
              dispatching = false;
            }
          }
          return;
        }

        if (editState.mode === "inline") {
          const { from, to } = editState;
          const selFrom = selection.from;
          if (!isInsideRange(selFrom, from, to)) {
            dispatching = true;
            exitInlineEdit(view, { from, to });
            dispatching = false;
          }
          return;
        }

        if (editState.mode === "block") {
          const { from } = editState;
          const doc = view.state.doc;
          if (from >= doc.content.size) return;
          const node = doc.nodeAt(from);
          if (!node || node.type.name !== "mathSource") {
            dispatching = true;
            view.dispatch(
              view.state.tr.setMeta(pluginKey, { mode: "idle" })
            );
            dispatching = false;
            return;
          }
          const nodeEnd = from + node.nodeSize;
          const selFrom = selection.from;
          if (!isInsideRange(selFrom, from, nodeEnd)) {
            dispatching = true;
            exitBlockEdit(view, { from });
            dispatching = false;
          }
        }
      },
    };
  },
});

export const mathSourceNode = Node.create({
  name: "mathSource",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  atom: false,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="math-source"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "math-source" }, 0];
  },

  addNodeView() {
    return ({ node: _node }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "math-source-block";

      const delimTop = document.createElement("div");
      delimTop.className = "math-source-delimiter";
      delimTop.textContent = "$$";
      delimTop.contentEditable = "false";

      const content = document.createElement("div");
      content.className = "math-source-content";

      const delimBottom = document.createElement("div");
      delimBottom.className = "math-source-delimiter";
      delimBottom.textContent = "$$";
      delimBottom.contentEditable = "false";

      wrapper.appendChild(delimTop);
      wrapper.appendChild(content);
      wrapper.appendChild(delimBottom);

      return {
        dom: wrapper,
        contentDOM: content,
      };
    };
  },
});

export const MathEditing = Extension.create({
  name: "mathEditing",

  addProseMirrorPlugins() {
    return [mathEditingPlugin];
  },
});
