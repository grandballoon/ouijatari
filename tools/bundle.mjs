// Bundling: the page in src/ is several files (index.html plus the local
// scripts it loads), but the published page is one encrypted document. inline()
// folds the local scripts into the HTML before encryption; extract() is its
// exact inverse, so decrypting a published page restores every source file.
//
// A local script is `<script src="name.js"></script>` with a bare file name.
// Inlined, it becomes `<script data-src="name.js">…</script>`.

const LOCAL = /<script src="([\w.-]+)"><\/script>/g;
const INLINED = /<script data-src="([\w.-]+)">\n([\s\S]*?)\n<\/script>/g;

// `read(name)` returns the text of a local script.
export async function inline(html, read) {
  const names = [...new Set([...html.matchAll(LOCAL)].map((m) => m[1]))];
  const files = new Map();
  for (const name of names) {
    const text = await read(name);
    if (/<\/script/i.test(text)) {
      throw new Error(`${name} contains "</script", which would end its inlined <script> early.`);
    }
    files.set(name, text);
  }
  return html.replace(LOCAL, (_, name) => `<script data-src="${name}">\n${files.get(name)}\n</script>`);
}

// Returns the page as it was before inline(), and the scripts that were folded in.
export function extract(html) {
  const files = new Map();
  const page = html.replace(INLINED, (_, name, text) => {
    files.set(name, text);
    return `<script src="${name}"></script>`;
  });
  return { html: page, files };
}
