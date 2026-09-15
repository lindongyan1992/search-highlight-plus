# Search Highlight+

Highlight only the matched keywords inside complex Markdown blocks when you open a note from search results — instead of the default whole-block / whole-cell highlight.

## Features

- When you jump from a global search result (or run an in-note `Ctrl+F` search) and open the note, the plugin highlights **only the keyword** inside:
  - Tables (cell content)
  - Blockquotes
  - Callouts
  - Code blocks
  - List items, including list items that contain `[[wikilinks]]`
- Works in both Reading view and Live Preview.
- Keeps the native brief block flash (the momentary whole-block highlight that appears when you jump to a result) — only the *persistent* highlight is made keyword-precise.
- Settings: case sensitivity, regex mode (manual command only), and auto switch to Reading view on search-result click.

## Why

When the matched text lives inside a richly rendered block, the default behavior highlights the entire table cell / blockquote / callout / code block / list item, not just the word. This plugin makes the persistent highlight keyword-precise for those blocks.

## Usage

1. Install and enable the plugin.
2. Run a global search (or an in-note search) and click a result.
3. The matched keyword is highlighted inside complex blocks. The native whole-block flash appears briefly and then fades, leaving only the keyword highlight.

Manual command: **`Search Highlight+: Highlight current note keywords`** lets you highlight the keywords of a query you type (supports regex when the regex setting is on).

## Settings

- **Case sensitive** — match exact letter case.
- **Regex mode** — applies only to the manual command; the whole input is treated as a regular expression.
- **Auto switch to Reading view** — automatically open the note in Reading view when clicking a global search result (recommended; Live Preview global search produces no persistent highlight markers).

## Compatibility

Requires Obsidian 1.4.0 or later. Works on desktop and mobile.

## License

MIT
