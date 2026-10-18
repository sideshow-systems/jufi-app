// Der Text-Loader des Builds (project.json, loader) liefert Markdown-Dateien als Zeichenkette.
declare module '*.md' {
	const text: string;
	export default text;
}
