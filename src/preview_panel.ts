import * as vscode from 'vscode';
import * as path from 'path';
import {exec, ChildProcess} from 'child_process';

export default class PreviewPanel /* implements vscode.Disposable */ {
	// false if the panel has been closed
	active: boolean;
	// the text editor this panel previews the contents of
	editor: vscode.TextEditor;
	// the panel that the preview is shown in
	panel: vscode.WebviewPanel;
	// the vscode-resource:/ uri of katex css and js
	katexUri: vscode.Uri;
	// the vscode-resource:/ uri of media/markdown.css
	cssUri: vscode.Uri;
	// the vscode-resource:/ uri of the markdown file being edited
	baseUri: vscode.Uri | undefined;
	// the pandoc subprocess if it is running, undefined if not running
	subprocess: ChildProcess | undefined;
	// the time that the last invocation of pandoc exited
	lastRenderedTime: number;
	// whether there is an active setTimeout() call to render()
	pending: boolean;
	// self explanatory
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
		this.lastRenderedTime = 0;
		this.pending = false;
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
		let minInterval = vscode.workspace.getConfiguration('pandocMarkdownPreview').minimumWaitInterval;
		if (Date.now() < this.lastRenderedTime + minInterval || this.subprocess) {
			// can't render now, try later
			if (!this.pending) {
				this.pending = true;
				setTimeout(() => {
					this.pending = false;
					this.render();
				}, 50);
			}
			return;
		}
		let text = this.editor.document.getText();
		let pandocOptions = [];
		pandocOptions.push('-s');
		pandocOptions.push(`--katex=${this.katexUri}/`);
		pandocOptions.push(`--css=${this.cssUri}`);
		if (this.baseUri)
			pandocOptions.push('--metadata=header-includes:{{pmp-base-tag}}');
		this.subprocess = exec(`pandoc ${pandocOptions.join(' ')}`, {timeout: 5000}, (err, stdout, stderr) => {
			this.subprocess = undefined;
			if (!this.active) { return; }
			this.lastRenderedTime = Date.now();
			if (err) {
				this.panel.webview.html = `
					<p>Error executing pandoc:</p>
					<pre>${escapeHtml(String(err))}</pre>
				`;
			} else {
				if (this.baseUri)
					stdout = stdout.replace('{{pmp-base-tag}}', `<base href="${this.baseUri}">`);
				this.panel.webview.html = stdout;
			}
		});
		this.subprocess.stdin.write(text);
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