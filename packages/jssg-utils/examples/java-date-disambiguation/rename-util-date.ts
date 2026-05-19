// Demonstration: import-aware disambiguation between java.util.Date and java.sql.Date.
//
// Pattern matching alone cannot distinguish these — both appear in source as the
// identifier `Date`. JSSG has no Java semantic provider (only JS/TS and Python do),
// so node.definition() returns null on Java. This example bridges the gap by
// consulting the file's import list via the helpers in src/java/exports/imports.ts.
//
// Goal: rename `java.util.Date` -> `com.example.LegacyUtilDate` everywhere,
// while leaving every `java.sql.Date` usage untouched.

import type { SgRoot, SgNode, Edit } from "@codemod.com/jssg-types/main";
import type Java from "@codemod.com/jssg-types/langs/java";
import { coversImport, getImport } from "../../src/java/exports/imports.ts";

type JavaNode = SgNode<Java>;

const OLD_FQN = "java.util.Date";
const NEW_FQN = "com.example.LegacyUtilDate";

export default function transform(root: SgRoot<Java>): string | null {
  const program = root.root();

  // Decide which `Date` this file means by inspecting imports.
  // coversImport() respects wildcards (`import java.util.*;` covers java.util.Date).
  const utilCovered = coversImport(program, { type: "plain", from: OLD_FQN });
  const sqlCovered = coversImport(program, { type: "plain", from: "java.sql.Date" });

  // Ambiguous case: both imported. In real Java this is a compile error for the
  // bare name, so we refuse the bare rename and only rewrite FQN usages.
  // (None of the fixtures hit this — see BothFullyQualified.java which uses FQNs
  // exclusively and has no Date imports at all.)
  const shortNameIsUtilDate = utilCovered && !sqlCovered;

  const edits: Edit[] = [];

  if (shortNameIsUtilDate) {
    // Rewrite the plain `import java.util.Date;` line if present.
    // (Wildcard imports stay as-is — we can't rewrite `import java.util.*;` to
    // a single replacement, so we leave it and rely on the FQN rewrite below.)
    const plainImport = getImport(program, { type: "plain", from: OLD_FQN });
    if (plainImport) {
      edits.push(plainImport.node.replace(`import ${NEW_FQN};`));
    }

    // Bare `Date` as a type position (declarations, field types, return types).
    // GOTCHA: `{ kind: "type_identifier", pattern: "Date" }` returns nothing
    // because `pattern: "Date"` parses to a different default kind. Match by
    // kind only, filter by text.
    const typeRefs = program
      .findAll({ rule: { kind: "type_identifier" } })
      .filter((n) => n.text() === "Date");
    for (const ref of typeRefs) edits.push(ref.replace("LegacyUtilDate"));

    // Bare `Date` as a constructor: `new Date(...)`.
    const ctorRefs = program
      .findAll({
        rule: {
          kind: "identifier",
          inside: { kind: "object_creation_expression" },
        },
      })
      .filter((n) => n.text() === "Date");
    for (const ref of ctorRefs) edits.push(ref.replace("LegacyUtilDate"));
  }

  // Always rewrite fully-qualified `java.util.Date` occurrences — unambiguous.
  // This is what handles BothFullyQualified.java safely without touching the
  // sibling `java.sql.Date` usages.
  const fqnTypes = program.findAll({ rule: { pattern: OLD_FQN } });
  for (const fqn of fqnTypes) edits.push(fqn.replace(NEW_FQN));

  if (edits.length === 0) return null;
  return program.commitEdits(edits);
}
