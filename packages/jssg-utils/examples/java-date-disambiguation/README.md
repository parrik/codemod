# java.util.Date vs java.sql.Date — import-aware disambiguation

This example tests whether the new Java import helpers in
[`packages/jssg-utils/src/java/exports/imports.ts`](../../src/java/exports/imports.ts)
can drive a JSSG transform that distinguishes between two same-named Java
types (`java.util.Date` and `java.sql.Date`) **without** a Java semantic
provider.

## Premise

JSSG runs JS transforms over an ast-grep AST. ast-grep pattern matching is
**syntactic**: `pattern: "Date"` matches the identifier text `Date`, full stop.
It cannot know whether that token refers to `java.util.Date`, `java.sql.Date`,
a local class, or a variable.

The semantic layer (`node.definition()` / `node.references()`) does provide
type/symbol resolution, but only for languages with a registered provider.
At the time of writing the providers are JS/TS and Python — **there is no
`crates/language-java`**. Calling `node.definition()` on a Java node falls
back to `NoopSemanticProvider` and returns `null`.

So: **JSSG is not type-aware for Java today.** The question this example
tests is whether the import-line helpers (`getImport`, `coversImport`,
`addImport`, `removeImport`) are enough to write transforms that *behave as
if* they were type-aware, by inspecting the file's import list.

## What the transform does

[`rename-util-date.ts`](./rename-util-date.ts) renames every
`java.util.Date` reference to `com.example.LegacyUtilDate` and **leaves
every `java.sql.Date` reference untouched**.

Disambiguation logic:

1. Use `coversImport(program, { type: "plain", from: "java.util.Date" })`
   to detect whether `java.util.Date` is in scope — this respects wildcard
   imports (`import java.util.*;` covers `java.util.Date`).
2. Same check for `java.sql.Date`.
3. If `java.util.Date` is covered and `java.sql.Date` is not → rewrite bare
   `Date` identifiers (type positions and constructor positions).
4. Always rewrite fully-qualified `java.util.Date` usages — unambiguous.
5. If both are covered, refuse the bare rename (it's a compile error in
   Java anyway) and only rewrite FQN usages.

## Fixtures and expected behavior

| File                          | Imports                  | What should change                                          |
| ----------------------------- | ------------------------ | ----------------------------------------------------------- |
| `UtilDateOnly.java`           | `import java.util.Date;` | All `Date` → `LegacyUtilDate`; import rewritten             |
| `SqlDateOnly.java`            | `import java.sql.Date;`  | Nothing                                                     |
| `UtilDateWildcard.java`       | `import java.util.*;`    | All `Date` → `LegacyUtilDate`; wildcard import preserved    |
| `BothFullyQualified.java`     | none                     | Only `java.util.Date` FQN rewritten; `java.sql.Date` intact |
| `NoDateAtAll.java`            | `import java.util.List;` | Nothing                                                     |

## Running

```bash
# From this directory:
npx codemod jssg run ./rename-util-date.ts \
  --target ./src \
  --language java \
  --dry-run \
  --allow-dirty \
  --no-interactive
```

Drop `--dry-run` to apply.

## Why the local `tsconfig.json`

`OxcResolver` walks up from the script file looking for the nearest
`tsconfig.json`. Without a local override it picks up the package's
`tsconfig.json` whose `"include": ["./src"]` excludes this directory, and
module resolution fails for both the script entry and its relative import
of the helpers. The local `tsconfig.json` here re-establishes the include
roots so resolution works.

## Known limitations (real type-awareness would catch these)

- **Same-package shadowing.** A class named `Date` in `com.example` would
  shadow `java.util.Date` with no import line to detect. This transform
  would still rewrite the bare references — wrong.
- **Inner / nested classes.** `Foo.Date` is a different `Date` entirely.
  Pattern `"Date"` matches its identifier portion.
- **Both imports + bare references.** Java forbids this (compile error),
  but partial-rewrite tools can produce broken intermediate states.

A real Java codemod for unknown user code needs a Java symbol resolver.
The import-helpers approach is good enough for disciplined codebases (no
shadowing, no nested-class collisions), which covers most enterprise Java
in practice — but call it what it is: **heuristic disambiguation**, not
type-aware analysis.
