import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {exec, ChildProcess, ExecOptions} from 'child_process';

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
		if (editor.document.uri.scheme === 'file') {
			let baseDir = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));
			localResourceRoots.push(baseDir);
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
		if (this.pending) { return; }
		let config = vscode.workspace.getConfiguration('pandocMarkdownPreview');
		if (Date.now() < this.lastRenderedTime + config.minimumWaitInterval || this.subprocess) {
			// can't render now, try later
			this.pending = true;
			setTimeout(() => {
				this.pending = false;
				this.render();
			}, 50);
			return;
		}
		let baseTagUri: vscode.Uri | undefined;
		if (this.editor.document.uri.scheme === 'file')
			baseTagUri = this.panel.webview.asWebviewUri(this.editor.document.uri);
		let execOptions: ExecOptions = {};
		execOptions.timeout = 5000;
		if (this.editor.document.uri.scheme === 'file')
			execOptions.cwd = path.dirname(this.editor.document.uri.fsPath);
		let pandocOptions = [];
		if (config.extraPandocArguments.length !== 0)
			pandocOptions.push(config.extraPandocArguments);
		pandocOptions.push('-s');
		pandocOptions.push(`--katex=${this.katexUri}/`);
		pandocOptions.push(`--css=${this.cssUri}`);
		if (baseTagUri)
			pandocOptions.push('--metadata=header-includes:{{pmp-base-tag}}');
		this.subprocess = exec(`pandoc ${pandocOptions.join(' ')}`, execOptions, (err, stdout, stderr) => {
			this.subprocess = undefined;
			if (!this.active) { return; }
			this.lastRenderedTime = Date.now();
			if (err) {
				this.panel.webview.html = `
					<p>Error executing pandoc:</p>
					<pre>${escapeHtml(String(err))}</pre>
				`;
			} else {
				if (baseTagUri)
					stdout = stdout.replace('{{pmp-base-tag}}', `<base href="${baseTagUri}">`);
				this.panel.webview.html = stdout;
			}
		});
		for (let inputFile of config.extraPandocInputFiles) {
			if (path.isAbsolute(inputFile)) {
				this.subprocess.stdin.write(fs.readFileSync(inputFile));
			} else {
				let cwd = path.dirname(this.editor.document.uri.fsPath);
				this.subprocess.stdin.write(fs.readFileSync(path.join(cwd,inputFile))); 
			}
		}
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