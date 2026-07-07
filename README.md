# UI5 gen i18n

VS Code extension for SAP UI5: finds `{i18n>...}` bindings in XML views/fragments, checks them against your `i18n.properties` files and appends missing keys.

## Commands

- **UI5 i18n: Check Current View/Fragment** — scans the active `*.view.xml` / `*.fragment.xml` (also in the editor context menu)
- **UI5 i18n: Check All Views/Fragments** — scans the whole workspace

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ui5GenI18n.modelName` | `i18n` | Resource model name in bindings |
| `ui5GenI18n.filePattern` | `**/*.{view,fragment}.xml` | Glob for "Check All" |
| `ui5GenI18n.excludePattern` | `**/{node_modules,dist,.git}/**` | Excluded folders |
| `ui5GenI18n.placeholder` | `TODO: ${key}` | Value for new keys; supports `${key}` and `${keyHuman}` |
| `ui5GenI18n.addToAllLocales` | `false` | Also append to `i18n_de.properties` etc. |
| `ui5GenI18n.askBeforeAdding` | `true` | Confirm keys via QuickPick before writing |

## Build from source

```
npm install
npm run compile
npx vsce package
```

## Disclaimer

This was created with the help of Claude Fable 5. Every line of code was proofread by a human; Be aware that humans can also make errors.
