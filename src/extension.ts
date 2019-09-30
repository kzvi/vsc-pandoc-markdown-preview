import * as vscode from 'vscode';
import PreviewPanel from './preview_panel';

let extensionContext: vscode.ExtensionContext;

let panel: PreviewPanel | undefined;

function openPreview() {
	let activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor)
		return;
	if (panel)
		panel.dispose();
	panel = new PreviewPanel(activeEditor, extensionContext);
}

export function activate(context: vscode.ExtensionContext) {
	extensionContext = context;

	context.subscriptions.push(vscode.commands.registerCommand('extension.openPandocMarkdownPreview', openPreview));
}

export function deactivate() {
	if (panel)
		panel.dispose();
}