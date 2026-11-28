// The highlight.js CDN build ships no type declarations; the tests import it straight from the package and use only the calls the diff pane makes.
declare module "@highlightjs/cdn-assets/es/highlight.js" {
  const hljs: import("../../src/changes/syntax.ts").Highlighter;
  export default hljs;
}
