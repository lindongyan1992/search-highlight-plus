// 编辑模式（CodeMirror 6）就地高亮：用 decoration 包裹命中关键词。
//
// 背景：阅读模式是静态 HTML，插件用 DOM 注入 <mark class="search-term-hl"> 即可稳定高亮；
// 但编辑模式（Live Preview / Source）的 DOM 由 CodeMirror 全权管理，任何外部插入的
// <mark> 都会在下一次视图重绘时被丢弃 —— 这正是「关掉自动切阅读模式后高亮整体消失」的根因。
// 故编辑模式改用 CM6 decoration（随文档 / 查询变化由 CM 自动重算），与 DOM 方案并存：
//   预览模式 → highlighter.ts 的 DOM 注入；编辑模式 → 本文件的 decoration。
//
// 语义对齐 highlighter.ts：空格分词、逐词独立（OR）高亮、可选大小写敏感。

import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { MARK_CLASS } from "./highlighter";

export interface HighlightQuery {
  query: string;
  caseSensitive: boolean;
}

/** 插件侧 dispatch 此 effect，通知编辑器更新高亮查询（空 query = 清除高亮）。 */
export const setHighlightQuery = StateEffect.define<HighlightQuery>();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegexes(query: string, caseSensitive: boolean): RegExp[] {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => new RegExp(escapeRegExp(t), caseSensitive ? "g" : "gi"));
}

/** 遍历文档文本，生成命中关键词的装饰集合。 */
function buildDecorations(
  state: EditorState,
  query: string,
  caseSensitive: boolean
): DecorationSet {
  if (!query.trim()) return Decoration.none;
  const regexes = buildRegexes(query, caseSensitive);
  if (regexes.length === 0) return Decoration.none;

  const doc = state.doc;
  const ranges: Array<{ from: number; to: number }> = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;
    if (!text) continue;
    for (const re of regexes) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) {
          re.lastIndex++; // 防止零宽匹配死循环
          continue;
        }
        ranges.push({
          from: line.from + m.index,
          to: line.from + m.index + m[0].length,
        });
      }
    }
  }
  if (ranges.length === 0) return Decoration.none;

  // RangeSetBuilder 要求按位置有序且互不重叠，故排序后跳过重叠段。
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const r of ranges) {
    if (r.from < lastTo) continue;
    builder.add(r.from, r.to, Decoration.mark({ class: MARK_CLASS }));
    lastTo = r.to;
  }
  return builder.finish();
}

/** 编辑模式高亮用 CM 扩展：存储查询状态，并据此生成关键词装饰。 */
export const highlightField: StateField<HighlightQuery> = StateField.define<HighlightQuery>({
  create() {
    return { query: "", caseSensitive: false };
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlightQuery)) return e.value;
    }
    return value;
  },
  provide: (f) =>
    EditorView.decorations.compute([f], (state) => {
      const { query, caseSensitive } = state.field(f);
      return buildDecorations(state, query, caseSensitive);
    }),
});
