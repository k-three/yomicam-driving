/** Vite の `?inline`：CSS を文字列として読み込む（虎の巻向けの部品が Shadow DOM に入れるため） */
declare module '*.css?inline' {
  const css: string;
  export default css;
}
