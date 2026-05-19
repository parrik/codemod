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

Two fixtures the heuristic mis-rewrites. The verification script
`verify/run.sh` compiles every fixture before and after the codemod with
`javac` and reports the result. The findings below come from running it,
not from reasoning alone.

```bash
bash verify/run.sh
```

### `broken/BrokenInnerShadow.java` — silent semantic break

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

**The rewritten `BrokenInnerShadow.java` compiles cleanly.** No error, no
warning. But its semantics changed: `local` was an instance of the inner
`Date` class (which has a `.label` field); it is now a `LegacyUtilDate`
(which doesn't). The inner `Date` class is still in the source, now
orphan dead code.

The failure surfaces in **downstream consumers**, not in the file the
codemod touched. `verify/Main.java` accesses `u.local.label` and
demonstrates this:

```text
before codemod:  $ java -cp out com.example.Main
                 local.label = I am the inner Date, not java.util.Date

after codemod:   $ javac com/example/*.java
                 com/example/Main.java:18: error: cannot find symbol
                         String s = u.local.label;
                                           ^
                   symbol:   variable label
                   location: variable local of type LegacyUtilDate
```

The compile error blames `Main.java`. The codemod-touched file looks
fine. This is the failure mode LST / type-attributed analysis is built
to prevent: pattern-based rewrites that produce silently-wrong sources
whose damage only surfaces in callers — sometimes very far from the
edit.

### `broken/BrokenGenericParam.java` — accidentally correct

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

The heuristic produces:

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

Surprise: **this compiles and is behaviorally identical to the original**.
Per JLS §6.4.1, the type parameter declaration `<LegacyUtilDate>` shadows
the imported class `LegacyUtilDate` inside Container's scope. So every
`LegacyUtilDate` inside Container refers to the type parameter, not the
imported class. The class is still generic — callers can do
`new Container<String>()` exactly as before.

The damage is purely cosmetic: a generic type parameter named after a
specific class is misleading to readers. Java's name-shadowing rules
accidentally rescued the heuristic from producing broken code here, even
though the rewrite was based on faulty reasoning.

This case is a useful pushback against an overcorrection: **pattern-based
rewrites aren't always wrong on hard-looking inputs.** They're
*unreliable* — sometimes right by accident, sometimes silently wrong,
with no signal to distinguish.

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
  type variable, not to `java.util.Date`. The visitor skips it. (As
  shown above, our heuristic happens to escape harm here too, but for
  the wrong reasons — Java's shadowing rules cover for the mistake.
  A type-attributed visitor doesn't need rescuing.)
- **Same-package shadowing** (not shown here): the symbol resolver
  consults the package's compilation units and picks the same-package
  `Date` over the imported one per JLS rules.
- **Method overload selection**: the call site's `getType()` on the
  receiver disambiguates which overload is being invoked.

The cost: OpenRewrite needs the full classpath (or a fakable one) to
build the symbol table. JSSG/ast-grep doesn't, which is why it's faster
to set up but can't answer these questions.

## Summary

| Refactor class                                         | AST + import-helpers           | LST / type-attributed |
| ------------------------------------------------------ | ------------------------------ | --------------------- |
| Rename, FQN-only                                       | ✅                             | ✅                    |
| Rename, single-type-import, no shadowing               | ✅                             | ✅                    |
| Rename, wildcard import                                | ✅ (via `coversImport`)        | ✅                    |
| Rename when an inner / nested class shadows the import | ❌ silent-semantic-wrong; downstream consumers fail | ✅                    |
| Rename when a type parameter shadows the import        | ⚠️ accidentally correct; ugly naming, behaviour preserved | ✅                    |
| Rename when a same-package class shadows the import    | ❌ silent-semantic-wrong       | ✅                    |
| Method-overload-sensitive rewrites                     | ❌                             | ✅                    |
| Receiver-type-sensitive rewrites                       | ❌                             | ✅                    |

The import-helpers approach is good enough for disciplined codebases on
the top 3 rows. The bottom rows are why Java refactoring tools
historically sit on type-attributed trees — not because pattern-based
rewrites *always* fail on hard inputs, but because they're *unreliable*:
sometimes silently wrong, sometimes accidentally right, with no signal
to tell those apart.
