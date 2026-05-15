import { ok as assert } from "assert";
import { parse } from "codemod:ast-grep";
import {
  getImport,
  coversImport,
  addImport,
  removeImport,
} from "../src/java/exports/imports.ts";
import type Java from "@codemod.com/jssg-types/langs/java";

function parseJava(src: string) {
  return parse<Java>("java", src).root();
}

// ============================================================================
// getImport
// ============================================================================

function testGetPlainImportPresent() {
  const program = parseJava("import org.junit.Test;\nclass X {}\n");
  const res = getImport(program, { type: "plain", from: "org.junit.Test" });
  assert(res !== null, "Should find the import");
  assert(res!.simpleName === "Test", "simpleName should be 'Test'");
  assert(res!.isStatic === false, "isStatic should be false");
  assert(res!.isWildcard === false, "isWildcard should be false");
}

function testGetPlainImportAbsent() {
  const program = parseJava("class X {}\n");
  const res = getImport(program, { type: "plain", from: "org.junit.Test" });
  assert(res === null, "Should return null when absent");
}

function testGetStaticImport() {
  const program = parseJava(
    "import static org.junit.Assert.assertEquals;\nclass X {}\n",
  );
  const res = getImport(program, {
    type: "static",
    name: "assertEquals",
    from: "org.junit.Assert",
  });
  assert(res !== null, "Should find the static import");
  assert(res!.simpleName === "assertEquals", "simpleName should be method name");
  assert(res!.isStatic === true, "isStatic should be true");
}

function testGetStaticWildcardImport() {
  const program = parseJava(
    "import static org.junit.Assert.*;\nclass X {}\n",
  );
  const res = getImport(program, {
    type: "static-wildcard",
    from: "org.junit.Assert",
  });
  assert(res !== null, "Should find the static wildcard");
  assert(res!.isWildcard === true, "isWildcard should be true");
}

// ============================================================================
// coversImport
// ============================================================================

function testCoversImportExact() {
  const program = parseJava("import org.junit.Test;\nclass X {}\n");
  assert(
    coversImport(program, { type: "plain", from: "org.junit.Test" }) === true,
    "Exact match should cover",
  );
}

function testCoversImportWildcardSubsumesPlain() {
  const program = parseJava("import org.junit.*;\nclass X {}\n");
  assert(
    coversImport(program, { type: "plain", from: "org.junit.Test" }) === true,
    "Plain-wildcard should cover a specific plain import",
  );
}

function testCoversImportStaticWildcardSubsumes() {
  const program = parseJava(
    "import static org.junit.Assert.*;\nclass X {}\n",
  );
  assert(
    coversImport(program, {
      type: "static",
      name: "assertEquals",
      from: "org.junit.Assert",
    }) === true,
    "Static-wildcard should cover a specific static import",
  );
}

function testCoversImportNoMatch() {
  const program = parseJava("import org.junit.Before;\nclass X {}\n");
  assert(
    coversImport(program, { type: "plain", from: "org.junit.Test" }) === false,
    "Different import should not cover",
  );
}

// ============================================================================
// addImport
// ============================================================================

function testAddImportInsertsAfterLastImport() {
  const src = "import org.junit.Before;\nimport org.junit.Test;\n\nclass X {}\n";
  const program = parseJava(src);
  const edit = addImport(program, {
    type: "plain",
    from: "org.junit.After",
  });
  assert(edit !== null, "Should produce an edit");
  // Apply the edit manually to verify shape.
  const result =
    src.slice(0, edit!.startPos) + edit!.insertedText + src.slice(edit!.endPos);
  assert(
    result.includes("import org.junit.Test;\nimport org.junit.After;"),
    "Should insert after the last existing import",
  );
}

function testAddImportSkipsWhenPresent() {
  const program = parseJava("import org.junit.Test;\nclass X {}\n");
  const edit = addImport(program, { type: "plain", from: "org.junit.Test" });
  assert(edit === null, "Should return null when import already present");
}

function testAddImportSkipsWhenCoveredByWildcard() {
  const program = parseJava("import org.junit.*;\nclass X {}\n");
  const edit = addImport(program, { type: "plain", from: "org.junit.Test" });
  assert(
    edit === null,
    "Should return null when a wildcard already covers the import",
  );
}

function testAddImportNoExistingImports() {
  const src = "package org.example;\n\nclass X {}\n";
  const program = parseJava(src);
  const edit = addImport(program, { type: "plain", from: "org.junit.Test" });
  assert(edit !== null, "Should produce an edit");
  const result =
    src.slice(0, edit!.startPos) + edit!.insertedText + src.slice(edit!.endPos);
  assert(
    result.includes("package org.example;\n\nimport org.junit.Test;"),
    "Should insert after the package declaration",
  );
}

// ============================================================================
// removeImport
// ============================================================================

function testRemoveImportPresent() {
  const src = "import org.junit.Test;\nclass X {}\n";
  const program = parseJava(src);
  const edit = removeImport(program, {
    type: "plain",
    from: "org.junit.Test",
  });
  assert(edit !== null, "Should produce an edit");
  const result =
    src.slice(0, edit!.startPos) + edit!.insertedText + src.slice(edit!.endPos);
  assert(!result.includes("import org.junit.Test"), "Import should be gone");
  assert(!result.startsWith("\n"), "Should not leave a leading blank line");
}

function testRemoveImportAbsent() {
  const program = parseJava("class X {}\n");
  const edit = removeImport(program, {
    type: "plain",
    from: "org.junit.Test",
  });
  assert(edit === null, "Should return null when not present");
}

// ============================================================================
// Run all tests
// ============================================================================

const tests = [
  testGetPlainImportPresent,
  testGetPlainImportAbsent,
  testGetStaticImport,
  testGetStaticWildcardImport,
  testCoversImportExact,
  testCoversImportWildcardSubsumesPlain,
  testCoversImportStaticWildcardSubsumes,
  testCoversImportNoMatch,
  testAddImportInsertsAfterLastImport,
  testAddImportSkipsWhenPresent,
  testAddImportSkipsWhenCoveredByWildcard,
  testAddImportNoExistingImports,
  testRemoveImportPresent,
  testRemoveImportAbsent,
];

for (const t of tests) {
  t();
}

console.log(`✓ ${tests.length} java/imports tests passed`);
