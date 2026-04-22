import StarterKit from "@tiptap/starter-kit";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import CharacterCount from "@tiptap/extension-character-count";
import Placeholder from "@tiptap/extension-placeholder";
import { all, createLowlight } from "lowlight";
import { markdownExtension } from "../../lib/markdown";
import { markdownPaste, protectMath, restoreMath } from "../../lib/markdownPaste";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import { mathSourceNode, MathEditing } from "./mathEditing";

const lowlight = createLowlight(all);

// Extend with tiptap-markdown serializers so math is saved as $$...$$ / $...$
const BlockMathWithSerializer = BlockMath.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write("$$\n" + node.attrs.latex + "\n$$");
          state.closeBlock(node);
        },
      },
    };
  },
});

const InlineMathWithSerializer = InlineMath.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write("$" + node.attrs.latex + "$");
        },
        parse: {
          setup(markdownit: any) {
            if (markdownit._mathPatched) return;
            markdownit._mathPatched = true;
            const orig = markdownit.render.bind(markdownit);
            markdownit.render = (src: string, env?: unknown) => {
              const { result, map } = protectMath(src);
              let html = orig(result, env);
              html = restoreMath(html, map);
              return html;
            };
          },
        },
      },
    };
  },
});

export const extensions = [
  StarterKit.configure({
    codeBlock: false,
    heading: { levels: [1, 2, 3] },
  }),
  Underline,
  Highlight.configure({ multicolor: false }),
  Link.configure({ openOnClick: false, autolink: true }),
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlockLowlight.configure({ lowlight }),
  CharacterCount,
  Placeholder.configure({ placeholder: "Type '/' for commands…" }),
  GlobalDragHandle.configure({ dragHandleWidth: 20, scrollTreshold: 100 }),
  markdownPaste,
  markdownExtension,
  mathSourceNode,
  MathEditing,
  BlockMathWithSerializer,
  InlineMathWithSerializer,
];
