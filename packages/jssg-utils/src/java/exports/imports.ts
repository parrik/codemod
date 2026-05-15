import type Java from "@codemod.com/jssg-types/langs/java";
import type { SgNode } from "@codemod.com/jssg-types/main";

// Java imports come in four shapes:
//   plain            : import org.junit.Test;
//   static           : import static org.junit.Assert.assertEquals;
//   plain-wildcard   : import org.junit.*;
//   static-wildcard  : import static org.junit.Assert.*;

export type JavaNode = SgNode<Java>;

export interface Edit {
  startPos: number;
  endPos: number;
  insertedText: string;
}

export type ImportOptions =
  | { type: "plain"; from: string }
  | { type: "static"; name: string; from: string }
  | { type: "plain-wildcard"; from: string }
  | { type: "static-wildcard"; from: string };

export type GetImportResult = {
  /**
   * The right-most segment of the imported path:
   *   plain "org.junit.Test"          -> "Test"
   *   static "org.junit.Assert.assertEquals" -> "assertEquals"
   *   wildcards                       -> "*"
   */
  simpleName: string;
  isStatic: boolean;
  isWildcard: boolean;
  node: JavaNode;
} | null;

function patternFor(options: ImportOptions): string {
  switch (options.type) {
    case "plain":
      return `import ${options.from};`;
    case "static":
      return `import static ${options.from}.${options.name};`;
    case "plain-wildcard":
      return `import ${options.from}.*;`;
    case "static-wildcard":
      return `import static ${options.from}.*;`;
  }
}

function resultFor(options: ImportOptions, node: JavaNode): GetImportResult {
  switch (options.type) {
    case "plain":
      return {
        simpleName: options.from.split(".").pop() ?? options.from,
        isStatic: false,
        isWildcard: false,
        node,
      };
    case "static":
      return {
        simpleName: options.name,
        isStatic: true,
        isWildcard: false,
        node,
      };
    case "plain-wildcard":
      return { simpleName: "*", isStatic: false, isWildcard: true, node };
    case "static-wildcard":
      return { simpleName: "*", isStatic: true, isWildcard: true, node };
  }
}

/**
 * Find an import declaration matching options. Returns null if not present.
 *
 * Matches the EXACT shape requested — `getImport({type: "plain", from: "org.junit.Test"})`
 * does NOT match `import org.junit.*;` even though the latter covers the former.
 * Use {@link coversImport} for subsumption semantics.
 */
export function getImport(
  program: JavaNode,
  options: ImportOptions,
): GetImportResult {
  const match = program.find({ rule: { pattern: patternFor(options) } });
  if (!match) return null;
  return resultFor(options, match);
}

/**
 * Returns true if the requested import is already covered by an existing import —
 * either an exact match OR a wildcard that subsumes it.
 *
 *   coversImport(program, { type: "plain", from: "org.junit.Test" })
 *     // true if `import org.junit.Test;` OR `import org.junit.*;` is present.
 */
export function coversImport(
  program: JavaNode,
  options: ImportOptions,
): boolean {
  if (getImport(program, options)) return true;

  switch (options.type) {
    case "plain": {
      const parent = options.from.split(".").slice(0, -1).join(".");
      if (
        parent &&
        getImport(program, { type: "plain-wildcard", from: parent })
      )
        return true;
      return false;
    }
    case "static": {
      if (getImport(program, { type: "static-wildcard", from: options.from }))
        return true;
      return false;
    }
    case "plain-wildcard":
    case "static-wildcard":
      return false;
  }
}

/**
 * Add an import to the program. Returns null if the import (or a wildcard that
 * covers it) is already present.
 *
 * Insertion position: after the last existing import declaration. If there are
 * no imports, after the package declaration. If neither, at the start of the file.
 */
export function addImport(
  program: JavaNode,
  options: ImportOptions,
): Edit | null {
  if (coversImport(program, options)) return null;

  const importText = patternFor(options);
  const lastImport = findLastImport(program);

  if (lastImport) {
    const endPos = lastImport.range().end.index;
    return { startPos: endPos, endPos, insertedText: `\n${importText}` };
  }

  const pkg = program.find({ rule: { kind: "package_declaration" } });
  if (pkg) {
    const endPos = pkg.range().end.index;
    return { startPos: endPos, endPos, insertedText: `\n\n${importText}` };
  }

  return { startPos: 0, endPos: 0, insertedText: `${importText}\n` };
}

/**
 * Remove an import declaration. Returns null if not present.
 *
 * Drops the entire `import ... ;` line including the trailing newline if any,
 * so callers don't end up with a dangling blank line.
 */
export function removeImport(
  program: JavaNode,
  options: ImportOptions,
): Edit | null {
  const result = getImport(program, options);
  if (!result) return null;

  const range = result.node.range();
  const src = program.text();
  let endIdx = range.end.index;
  if (src[endIdx] === "\n") endIdx += 1;
  return { startPos: range.start.index, endPos: endIdx, insertedText: "" };
}

/**
 * Find the last import declaration in the program, or null if none exist.
 */
function findLastImport(program: JavaNode): JavaNode | null {
  const all = program.findAll({ rule: { kind: "import_declaration" } });
  return all[all.length - 1] ?? null;
}
