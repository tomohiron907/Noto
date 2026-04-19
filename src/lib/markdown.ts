import { Markdown } from "tiptap-markdown";

export const markdownExtension = Markdown.configure({
  html: false,
  tightLists: true,
  bulletListMarker: "-",
  transformPastedText: true,
  transformCopiedText: false,
});
