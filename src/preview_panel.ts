import * as vscode from 'vscode';
import * as path from 'path';
import {exec, ChildProcess} from 'child_process';

export default class PreviewPanel /* implements vscode.Disposable */ {
	active: boolean;
	editor: vscode.TextEditor;
	panel: vscode.WebviewPanel;
	katexUri: vscode.Uri;
	cssUri: vscode.Uri;
	baseUri: vscode.Uri | undefined;
	subprocess: ChildProcess | undefined;
	disposables: vscode.Disposable[];

	constructor(editor: vscode.TextEditor, extensionContext: vscode.ExtensionContext) {
		this.active = true;
		this.editor = editor;
		let localResourceRoots = [];
		localResourceRoots.push(vscode.Uri.file(extensionContext.extensionPath));
		if (vscode.workspace.workspaceFolders)
			vscode.workspace.workspaceFolders.forEach(f => localResourceRoots.push(f.uri));
		if (editor.document.uri.scheme === 'file' && editor.document.uri.authority === '') {
			let baseDir = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));
			localResourceRoots.push(baseDir);
			this.baseUri = editor.document.uri;
		}
		this.panel = vscode.window.createWebviewPanel(
			'pandoc-markdown-preview',
			'Pandoc Markdown Preview',
			vscode.ViewColumn.Beside,
			{enableScripts: true, localResourceRoots}
		);
		let katexPath = extensionContext.asAbsolutePath('node_modules/katex/dist');
		this.katexUri = this.panel.webview.asWebviewUri(vscode.Uri.file(katexPath));
		let cssPath = extensionContext.asAbsolutePath('media/markdown.css');
		this.cssUri = this.panel.webview.asWebviewUri(vscode.Uri.file(cssPath));
		if (this.baseUri)
			this.baseUri = this.panel.webview.asWebviewUri(this.baseUri);
		this.disposables = [];

		vscode.workspace.onDidChangeTextDocument(ev => {
			if (ev.document === this.editor.document)
				setTimeout(() => { this.render(); }, 50);
		}, null, this.disposables);

		vscode.workspace.onDidCloseTextDocument(doc => {
			if (doc === this.editor.document && doc.isClosed)
				this.dispose();
		}, null, this.disposables);

		this.panel.onDidDispose(() => {
			this.dispose();
		}, null, this.disposables);

		this.render();
	}

	render() {
		if (!this.active) { return; }
		if (this.subprocess) { return; }
		let pandocOptions = [];
		pandocOptions.push('-s');
		pandocOptions.push(`--katex=${this.katexUri}/`);
		pandocOptions.push(`--css=${this.cssUri}`);
		if (this.baseUri)
			pandocOptions.push('--metadata=header-includes:{{pmp-base-tag}}');
		this.subprocess = exec(`pandoc ${pandocOptions.join(' ')}`, {timeout: 5000}, (err, stdout, stderr) => {
			if (!this.active) { return; }
			if (err) {
				this.panel.webview.html = `
					<p>Error executing pandoc:</p>
					<pre>${escapeHtml(String(err))}</pre>
				`;
				return;
			}
			if (this.baseUri)
				stdout = stdout.replace('{{pmp-base-tag}}', `<base href="${this.baseUri}">`);
			this.panel.webview.html = stdout;
		});
		this.subprocess.on('exit', () => {
			this.subprocess = undefined;
		});
		this.subprocess.stdin.write(this.editor.document.getText());
		this.subprocess.stdin.end();
	}

	dispose() {
		if (!this.active)
			return;
		this.active = false;
		this.panel.dispose();
		this.disposables.forEach(x => x.dispose());
	}
}

// stack overflow
function escapeHtml(unsafe: string) {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}