const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".next-build");
const html = fs.readFileSync(
  path.join(output, "server/app/index.html"),
  "utf8",
);
const doc = new JSDOM(html).window.document;
assert.equal(doc.documentElement.lang, "ru");
assert.ok(doc.body.textContent.includes("Каждый сайт под наблюдением."));
assert.ok(
  doc.querySelector('button[aria-pressed="true"]').textContent.includes("RU"),
);
const icons = [...doc.querySelectorAll('link[rel="icon"]')];
assert.equal(icons.length, 1, "Exactly one tab icon is emitted by App Router");
assert.match(icons[0].getAttribute("href"), /^\/icon\.svg(?:\?|$)/);
assert.equal(icons[0].getAttribute("type"), "image/svg+xml");
const svg = new JSDOM(
  fs.readFileSync(path.join(root, "app/icon.svg"), "utf8"),
  { contentType: "image/svg+xml" },
).window.document;
assert.equal(svg.documentElement.getAttribute("viewBox"), "0 0 64 64");
assert.equal(svg.querySelector("rect").getAttribute("fill"), "#132C26");
assert.equal(svg.querySelector("path").getAttribute("stroke"), "#7EE3AD");
const appPaths = JSON.parse(
  fs.readFileSync(path.join(output, "server/app-paths-manifest.json"), "utf8"),
);
assert.ok(appPaths["/icon.svg/route"], "Icon has a generated Next.js route");
assert.ok(
  fs.existsSync(path.join(output, "server", appPaths["/icon.svg/route"])),
);
for (const directory of ["app", "public"]) {
  const walk = (folder) =>
    fs.existsSync(folder)
      ? fs
          .readdirSync(folder, { withFileTypes: true })
          .flatMap((entry) =>
            entry.isDirectory()
              ? walk(path.join(folder, entry.name))
              : [path.join(folder, entry.name)],
          )
      : [];
  const candidates = walk(path.join(root, directory)).filter((file) =>
    /(?:favicon|icon\d*|apple-icon\d*)\.(?:ico|png|svg|jpe?g|tsx?|jsx?)$/.test(
      path.basename(file),
    ),
  );
  assert.deepEqual(
    candidates,
    directory === "app" ? [path.join(root, "app/icon.svg")] : [],
    "No conflicting favicon assets",
  );
}
const assets = [
  ...doc.querySelectorAll('script[src],link[rel="stylesheet"]'),
].map((element) => element.getAttribute("src") || element.getAttribute("href"));
assert.ok(assets.length >= 2, "Page has JS and CSS assets");
for (const asset of assets) {
  assert.ok(asset.startsWith("/_next/static/"), asset);
  assert.ok(
    fs.statSync(path.join(output, asset.slice("/_next/".length))).size > 0,
    `Asset is present: ${asset}`,
  );
}
const code = ts.transpileModule(
  fs.readFileSync(path.join(root, "next.config.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", code)(require, mod, mod.exports);
const phases = require("next/constants");
assert.notEqual(
  mod.exports.default(phases.PHASE_DEVELOPMENT_SERVER).distDir,
  mod.exports.default(phases.PHASE_PRODUCTION_BUILD).distDir,
);
assert.equal(
  mod.exports.default(phases.PHASE_PRODUCTION_SERVER).distDir,
  ".next-build",
);
console.log(
  `PASS: Russian default HTML, one App Router SVG favicon, no icon conflicts, ${assets.length} generated JS/CSS assets, isolated dev/build directories.`,
);
