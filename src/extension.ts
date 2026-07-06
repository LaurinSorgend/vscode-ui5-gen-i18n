import * as vscode from "vscode";
import * as path from "path";

interface I18nBundle {
  /** Base properties file (i18n.properties) */
  baseFile: vscode.Uri;
  /** Locale variants (i18n_de.properties, i18n_en_US.properties, ...) */
  localeFiles: vscode.Uri[];
  /** Keys found in the base file */
  keys: Set<string>;
}

interface UsedKey {
  key: string;
  /** Views/fragments the key was found in (for reporting) */
  sources: Set<string>;
}

const output = vscode.window.createOutputChannel("UI5 i18n Sync");

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ui5I18nSync.checkCurrentFile", checkCurrentFile),
    vscode.commands.registerCommand("ui5I18nSync.checkAllViews", checkAllViews),
    output
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}



async function checkCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !/\.(view|fragment)\.xml$/.test(editor.document.fileName)) {
    vscode.window.showWarningMessage("UI5 i18n Sync: open a *.view.xml or *.fragment.xml first.");
    return;
  }
  await runCheck([editor.document.uri]);
}

async function checkAllViews(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("ui5I18nSync");
  const pattern = cfg.get<string>("filePattern", "**/*.{view,fragment}.xml");
  const exclude = cfg.get<string>("excludePattern", "**/{node_modules,dist,.git}/**");
  const files = await vscode.workspace.findFiles(pattern, exclude);
  if (files.length === 0) {
    vscode.window.showInformationMessage("UI5 i18n Sync: no views/fragments found.");
    return;
  }
  await runCheck(files);
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

async function runCheck(files: vscode.Uri[]): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("ui5I18nSync");
  const modelName = cfg.get<string>("modelName", "i18n");

  // Group used keys per i18n bundle (a workspace can contain several apps)
  const bundles = new Map<string, { bundle: I18nBundle; used: Map<string, UsedKey> }>();
  const unresolved: string[] = [];

  for (const file of files) {
    const text = (await vscode.workspace.openTextDocument(file)).getText();
    const keys = extractI18nKeys(text, modelName);
    if (keys.size === 0) {
      continue;
    }

    const bundle = await findBundleForView(file);
    if (!bundle) {
      unresolved.push(vscode.workspace.asRelativePath(file));
      continue;
    }

    const id = bundle.baseFile.toString();
    let entry = bundles.get(id);
    if (!entry) {
      entry = { bundle, used: new Map() };
      bundles.set(id, entry);
    }
    const rel = vscode.workspace.asRelativePath(file);
    for (const key of keys) {
      let used = entry.used.get(key);
      if (!used) {
        used = { key, sources: new Set() };
        entry.used.set(key, used);
      }
      used.sources.add(rel);
    }
  }

  if (unresolved.length > 0) {
    output.appendLine(`No i18n.properties found for: ${unresolved.join(", ")}`);
  }

  // Collect missing keys per bundle
  let totalMissing = 0;
  const report: string[] = [];
  const additions: { bundle: I18nBundle; missing: UsedKey[] }[] = [];

  for (const { bundle, used } of bundles.values()) {
    const missing = [...used.values()]
      .filter((u) => !bundle.keys.has(u.key))
      .sort((a, b) => a.key.localeCompare(b.key));
    totalMissing += missing.length;
    const relBundle = vscode.workspace.asRelativePath(bundle.baseFile);
    report.push(
      `${relBundle}: ${used.size} key(s) used, ${missing.length} missing` +
      (missing.length
        ? "\n" + missing.map((m) => `  - ${m.key}  (${[...m.sources].join(", ")})`).join("\n")
        : "")
    );
    if (missing.length) {
      additions.push({ bundle, missing });
    }
  }

  output.appendLine(`\n[${new Date().toLocaleTimeString()}] Checked ${files.length} file(s)`);
  report.forEach((r) => output.appendLine(r));

  if (totalMissing === 0) {
    vscode.window.showInformationMessage("UI5 i18n Sync: all i18n keys exist.");
    return;
  }

  output.show(true);

  // Ask / add
  const askBefore = cfg.get<boolean>("askBeforeAdding", true);
  for (const { bundle, missing } of additions) {
    let toAdd = missing;
    if (askBefore) {
      const relBundle = vscode.workspace.asRelativePath(bundle.baseFile);
      const picked = await vscode.window.showQuickPick(
        missing.map((m) => ({
          label: m.key,
          description: [...m.sources].join(", "),
          picked: true,
          key: m,
        })),
        {
          canPickMany: true,
          title: `Add missing keys to ${relBundle}`,
          placeHolder: "Deselect keys you don't want to add",
        }
      );
      if (!picked) {
        continue; // user cancelled this bundle
      }
      toAdd = picked.map((p) => p.key);
    }
    if (toAdd.length === 0) {
      continue;
    }
    await appendKeys(bundle, toAdd.map((m) => m.key), cfg);
    vscode.window.showInformationMessage(
      `UI5 i18n Sync: added ${toAdd.length} key(s) to ${vscode.workspace.asRelativePath(bundle.baseFile)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts i18n keys from an XML view/fragment.
 * Handles:
 *   {i18n>key}
 *   {i18n>key.with.dots}
 *   { path: 'i18n>key' }  (composite / expression binding)
 *   {= ${i18n>key} }      (expression binding)
 *   parts: [{path: 'i18n>a'}, ...]
 */
export function extractI18nKeys(text: string, modelName: string): Set<string> {
  const keys = new Set<string>();
  const esc = modelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Matches "<model>>" followed by the key, optionally quoted, stopping at
  // characters that terminate a binding path.
  const re = new RegExp(`${esc}>\\s*/?([\\w.\\-]+)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Bundle resolution
// ---------------------------------------------------------------------------

const bundleCache = new Map<string, I18nBundle | null>();

/**
 * Finds the i18n bundle responsible for a given view:
 * 1. Walk up from the view's folder looking for a manifest.json.
 * 2. If found, resolve sap.ui5/models/<modelName> bundleName/uri, else sap.app/i18n.
 * 3. Fallback: look for an i18n/i18n.properties folder while walking up.
 */
async function findBundleForView(view: vscode.Uri): Promise<I18nBundle | null> {
  const wsFolder = vscode.workspace.getWorkspaceFolder(view);
  const stopAt = wsFolder ? wsFolder.uri.fsPath : path.parse(view.fsPath).root;
  let dir = path.dirname(view.fsPath);

  while (true) {
    const cached = bundleCache.get(dir);
    if (cached !== undefined) {
      return cached;
    }

    // 1) manifest.json in this folder?
    const manifest = vscode.Uri.file(path.join(dir, "manifest.json"));
    if (await exists(manifest)) {
      const bundle = await bundleFromManifest(manifest);
      if (bundle) {
        bundleCache.set(dir, bundle);
        return bundle;
      }
    }

    // 2) conventional i18n folder?
    const conventional = vscode.Uri.file(path.join(dir, "i18n", "i18n.properties"));
    if (await exists(conventional)) {
      const bundle = await loadBundle(conventional);
      bundleCache.set(dir, bundle);
      return bundle;
    }

    if (dir === stopAt || path.dirname(dir) === dir) {
      bundleCache.set(dir, null);
      return null;
    }
    dir = path.dirname(dir);
  }
}

async function bundleFromManifest(manifest: vscode.Uri): Promise<I18nBundle | null> {
  try {
    const raw = (await vscode.workspace.openTextDocument(manifest)).getText();
    const json = JSON.parse(raw);
    const cfg = vscode.workspace.getConfiguration("ui5I18nSync");
    const modelName = cfg.get<string>("modelName", "i18n");
    const appId: string | undefined = json?.["sap.app"]?.id;
    const model = json?.["sap.ui5"]?.models?.[modelName];
    const appRoot = path.dirname(manifest.fsPath);

    let relPath: string | undefined;

    const settings = model?.settings ?? {};
    const bundleName: string | undefined = settings.bundleName ?? model?.bundleName;
    const bundleUrl: string | undefined = settings.bundleUrl ?? model?.uri;

    if (bundleName && appId && bundleName.startsWith(appId + ".")) {
      relPath = bundleName.slice(appId.length + 1).replace(/\./g, "/") + ".properties";
    } else if (bundleUrl) {
      relPath = bundleUrl;
    } else if (typeof json?.["sap.app"]?.i18n === "string") {
      relPath = json["sap.app"].i18n;
    } else if (typeof json?.["sap.app"]?.i18n?.bundleUrl === "string") {
      relPath = json["sap.app"].i18n.bundleUrl;
    }

    if (!relPath) {
      return null;
    }
    const baseFile = vscode.Uri.file(path.join(appRoot, relPath));
    if (!(await exists(baseFile))) {
      return null;
    }
    return loadBundle(baseFile);
  } catch {
    return null;
  }
}

async function loadBundle(baseFile: vscode.Uri): Promise<I18nBundle> {
  const keys = await readPropertyKeys(baseFile);

  // Discover locale variants next to the base file: i18n_de.properties etc.
  const dir = path.dirname(baseFile.fsPath);
  const baseName = path.basename(baseFile.fsPath, ".properties");
  const localeFiles: vscode.Uri[] = [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
    for (const [name, type] of entries) {
      if (
        type === vscode.FileType.File &&
        name.startsWith(baseName + "_") &&
        name.endsWith(".properties")
      ) {
        localeFiles.push(vscode.Uri.file(path.join(dir, name)));
      }
    }
  } catch {
    /* directory not readable — ignore */
  }

  return { baseFile, localeFiles, keys };
}

async function readPropertyKeys(file: vscode.Uri): Promise<Set<string>> {
  const keys = new Set<string>();
  const text = (await vscode.workspace.openTextDocument(file)).getText();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    const sep = line.search(/[=:]/);
    if (sep > 0) {
      keys.add(line.slice(0, sep).trim());
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function appendKeys(
  bundle: I18nBundle,
  keys: string[],
  cfg: vscode.WorkspaceConfiguration
): Promise<void> {
  const placeholder = cfg.get<string>("placeholder", "TODO: ${key}");
  const addToAllLocales = cfg.get<boolean>("addToAllLocales", false);

  const targets = addToAllLocales ? [bundle.baseFile, ...bundle.localeFiles] : [bundle.baseFile];

  for (const target of targets) {
    // Re-read keys per file so locale files only get keys they're missing
    const existing =
      target.toString() === bundle.baseFile.toString()
        ? bundle.keys
        : await readPropertyKeys(target);

    const toWrite = keys.filter((k) => !existing.has(k));
    if (toWrite.length === 0) {
      continue;
    }

    const doc = await vscode.workspace.openTextDocument(target);
    const edit = new vscode.WorkspaceEdit();
    const lastLine = doc.lineAt(Math.max(doc.lineCount - 1, 0));
    const needsNewline = lastLine.text.length > 0;

    const lines = toWrite.map((k) => `${k}=${renderPlaceholder(placeholder, k)}`);
    const insertText = (needsNewline ? "\n" : "") + lines.join("\n") + "\n";
    edit.insert(target, lastLine.range.end, insertText);
    await vscode.workspace.applyEdit(edit);
    await doc.save();

    if (target.toString() === bundle.baseFile.toString()) {
      toWrite.forEach((k) => bundle.keys.add(k));
    }
  }
}

export function renderPlaceholder(template: string, key: string): string {
  const human = key
    .replace(/[._\-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return template.replace(/\$\{key\}/g, key).replace(/\$\{keyHuman\}/g, human);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
