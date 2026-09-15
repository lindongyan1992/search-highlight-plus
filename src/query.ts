// 搜索词解析与匹配规则。
// 对齐 Obsidian 原生搜索语义：空格分词（每个词独立高亮 / OR）、大小写不敏感、短语整体匹配。

export interface ParsedQuery {
  regexes: RegExp[];
  empty: boolean;
}

export interface QueryOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export function parseQuery(query: string, opts: QueryOptions): ParsedQuery {
  const q = query.trim();
  if (!q) return { regexes: [], empty: true };

  // 正则模式：整条搜索词作为一条正则
  if (opts.regex) {
    try {
      const re = new RegExp(q, opts.caseSensitive ? "g" : "gi");
      return { regexes: [re], empty: false };
    } catch {
      return { regexes: [], empty: true };
    }
  }

  // 普通模式：按空白分词，逐词构建正则（AND 语义在 highlighter 中校验）
  const terms = q.split(/\s+/).filter(Boolean);
  const flags = opts.caseSensitive ? "g" : "gi";
  const regexes = terms.map((term) => new RegExp(escapeRegExp(term), flags));
  return { regexes, empty: false };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
