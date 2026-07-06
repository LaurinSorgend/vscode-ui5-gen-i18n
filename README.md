# UI5 i18n Sync

VS Code extension for SAP UI5: finds `{i18n>...}` bindings in XML views/fragments, checks them against your `i18n.properties` files and appends missing keys.

## Commands

- **UI5 i18n: Check Current View/Fragment** — scans the active `*.view.xml` / `*.fragment.xml` (also in the editor context menu)
- **UI5 i18n: Check All Views/Fragments** — scans the whole workspace

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ui5I18nSync.modelName` | `i18n` | Resource model name in bindings |
| `ui5I18nSync.filePattern` | `**/*.{view,fragment}.xml` | Glob for "Check All" |
| `ui5I18nSync.excludePattern` | `**/{node_modules,dist,.git}/**` | Excluded folders |
| `ui5I18nSync.placeholder` | `TODO: ${key}` | Value for new keys; supports `${key}` and `${keyHuman}` |
| `ui5I18nSync.addToAllLocales` | `false` | Also append to `i18n_de.properties` etc. |
| `ui5I18nSync.askBeforeAdding` | `true` | Confirm keys via QuickPick before writing |

## Build from source

```
npm install
npm run compile
npx vsce package
```

## Disclaimer

This was created with the help of Claude Fable 5. Every line of code was proofread by a human; Be aware that humans can also make errors.
