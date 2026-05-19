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

## Where this heuristic breaks (`broken/` directory)

Two fixtures the heuristic silently mis-rewrites. Run:

```bash
npx codemod jssg run ./rename-util-date.ts \
  --target ./broken \
  --language java --dry-run --allow-dirty --no-interactive
```

### `broken/BrokenInnerShadow.java`

```java
class BrokenInnerShadow {
    Date realUtilDate = new Date();        // really java.util.Date — OK to rewrite
    static class InnerUser {
        static class Date { ... }          // shadows the import inside InnerUser
        Date local = new Date();           // refers to inner class, NOT java.util.Date
    }
}
```

The heuristic produces:

```diff
-        Date local = new Date();
+        LegacyUtilDate local = new LegacyUtilDate();
```

This **does not compile** — `LegacyUtilDate` doesn't exist; the original
code referred to the local inner class. JLS §6.4.1 says a nested type
declaration shadows a single-type-import within its scope. Our heuristic
has no way to see the inner class declaration.

### `broken/BrokenGenericParam.java`

```java
class BrokenGenericParam {
    Date lastSeen = new Date();             // really java.util.Date — OK to rewrite
    static class Container<Date> {          // <Date> is a type parameter
        Date value;                         // refers to the type parameter
        Date get() { return value; }
        void put(Date d) { this.value = d; }
    }
}
```

The heuristic produces (truncated):

```diff
-    static class Container<Date> {
-        Date value;
-        Date get() { ... }
-        void put(Date d) { ... }
+    static class Container<LegacyUtilDate> {
+        LegacyUtilDate value;
+        LegacyUtilDate get() { ... }
+        void put(LegacyUtilDate d) { ... }
```

It rewrote the **type parameter declaration itself**, so `Container` now
declares a type variable named `LegacyUtilDate` rather than parameterizing
over `LegacyUtilDate`. Structurally meaningless and almost certainly not
what anyone wanted.

## What an LST/type-attributed visitor would do differently

In OpenRewrite (or any tool with a type-attributed AST), every identifier
node carries its resolved symbol. The visitor for the same refactor would
look approximately like:

```java
visitIdentifier(J.Identifier id, ExecutionContext ctx) {
    JavaType type = id.getType();                              // attribution
    if (TypeUtils.isOfClassType(type, "java.util.Date")) {
        return id.withSimpleName("LegacyUtilDate")
                 .withType(JavaType.buildType("com.example.LegacyUtilDate"));
    }
    return id;                                                  // leave alone
}
```

This rewrite decision keys off `getType()`, not off "is this identifier
named `Date` and is there an import line at the top of the file?" So:

- **Inner-class shadowing**: the inner `Date` symbols resolve to
  `com.example.BrokenInnerShadow.InnerUser.Date`, **not** `java.util.Date`.
  The visitor skips them.
- **Generic type parameter**: the type parameter `<Date>` resolves to a
  type variable, not to `java.util.Date`. The visitor skips it and its
  uses inside the generic body.
- **Same-package shadowing** (not shown here): the symbol resolver
  consults the package's compilation units and picks the same-package
  `Date` over the imported one per JLS rules.
- **Method overload selection**: the call site's `getType()` on the
  receiver disambiguates which overload is being invoked.

The cost: OpenRewrite needs the full classpath (or a fakable one) to
build the symbol table. JSSG/ast-grep doesn't, which is why it's faster
to set up but can't answer these questions.

## Summary

| Refactor class                                         | AST + import-helpers | LST / type-attributed |
| ------------------------------------------------------ | -------------------- | --------------------- |
| Rename, FQN-only                                       | ✅                   | ✅                    |
| Rename, single-type-import, no shadowing               | ✅                   | ✅                    |
| Rename, wildcard import                                | ✅ (via `coversImport`) | ✅                  |
| Rename when an inner / nested class shadows the import | ❌ (silent wrong)    | ✅                    |
| Rename when a type parameter shadows the import        | ❌ (silent wrong)    | ✅                    |
| Rename when a same-package class shadows the import    | ❌ (silent wrong)    | ✅                    |
| Method-overload-sensitive rewrites                     | ❌                   | ✅                    |
| Receiver-type-sensitive rewrites                       | ❌                   | ✅                    |

The import-helpers approach is good enough for disciplined codebases on
the top 3 rows. The bottom 5 rows are why Java refactoring tools
historically sit on type-attributed trees.
