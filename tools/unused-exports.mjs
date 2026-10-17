// Lists the exported declarations of packages/core/src (and packages/ui, packages/node) that nothing outside the tests uses:
//   node tools/unused-exports.mjs
// "Used" = referenced from a non-test source file other than its own declaration. The list is a starting point for the
// dead-code rule of CLAUDE.md (a person decides: planned for a later phase, or really dead).
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const cfgPath = path.join(root, "tsconfig.json");
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
const files = parsed.fileNames;
const host = {
  getScriptFileNames: () => files,
  getScriptVersion: () => "1",
  getScriptSnapshot: (f) => (ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)) : undefined),
  getCurrentDirectory: () => root,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
};
const ls = ts.createLanguageService(host);
const program = ls.getProgram();
const isTest = (f) => /[\\/](test|tests)[\\/]/.test(f) || /\.(test|e2e)\.ts$/.test(f);
const isSrc = (f) => /packages[\\/](core|ui|node)[\\/]src[\\/]/.test(f);

const out = [];
for (const sf of program.getSourceFiles()) {
  if (!isSrc(sf.fileName) || sf.fileName.endsWith("index.ts")) continue;
  const visit = (node, depth) => {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const exported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const decls = [];
    if (exported && depth === 0) {
      if (ts.isVariableStatement(node)) node.declarationList.declarations.forEach((d) => ts.isIdentifier(d.name) && decls.push(d.name));
      else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) decls.push(node.name);
    }
    for (const id of decls) {
      const refs = ls.findReferences(sf.fileName, id.getStart()) || [];
      const used = refs.flatMap((r) => r.references).filter((r) => !r.isDefinition && isSrc(r.fileName) && !isTest(r.fileName) && !r.fileName.endsWith("index.ts"));
      const usedInTests = refs.flatMap((r) => r.references).some((r) => !r.isDefinition && isTest(r.fileName));
      if (!used.length) out.push({ file: path.relative(root, sf.fileName).replaceAll("\\", "/"), name: id.text, tests: usedInTests });
    }
  };
  ts.forEachChild(sf, (n) => visit(n, 0));
}
for (const o of out) console.log(`${o.file}  ${o.name}${o.tests ? "  (tests only)" : "  (nothing)"}`);
console.log(`\n${out.length} exported names are not used by any non-test source`);
