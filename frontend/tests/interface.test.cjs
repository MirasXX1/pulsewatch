const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

// Exercise the real React components in a DOM without opening ports.
// Only the HTTP boundary is replaced with explicit test fixtures; production data is never touched.
const dom = new JSDOM(
  '<!doctype html><html><head><meta name="description"></head><body></body></html>',
  {
    url: "http://127.0.0.1:3000/",
    pretendToBeVisual: true,
  },
);
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "StorageEvent",
]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value:
      name === "window"
        ? dom.window
        : name === "document"
          ? dom.window.document
          : dom.window[name],
  });
}
globalThis.self = dom.window;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const frontend = path.resolve(__dirname, "..");
const installedRequire = Module.createRequire(
  path.join(frontend, "package.json"),
);
const loaded = new Map();
function sourceModule(filename) {
  const options = [filename, `${filename}.ts`, `${filename}.tsx`];
  filename = options.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  assert.ok(filename, `Source module not found: ${options[0]}`);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const mod = { exports: {} };
  loaded.set(filename, mod);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (name) =>
    name.startsWith("@/")
      ? sourceModule(path.join(frontend, name.slice(2)))
      : name.startsWith(".")
        ? sourceModule(path.resolve(path.dirname(filename), name))
        : installedRequire(name);
  new Function(
    "require",
    "module",
    "exports",
    code + `\n//# sourceURL=${filename}`,
  )(localRequire, mod, mod.exports);
  return mod.exports;
}
const { LocaleProvider } = sourceModule(
  path.join(frontend, "i18n/LocaleProvider.tsx"),
);
const { translate, localeTags, storageKey, messages } = sourceModule(
  path.join(frontend, "i18n/messages.ts"),
);
const AppShell = sourceModule(
  path.join(frontend, "components/AppShell.tsx"),
).default;
const Dashboard = sourceModule(
  path.join(frontend, "components/Dashboard.tsx"),
).default;
let root, container, fixture;
const intervals = new Map();
const originalFetch = global.fetch;
const originalInterval = global.setInterval,
  originalClear = global.clearInterval;
const text = () => container.textContent;
const button = (label) =>
  [...container.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === label,
  );
async function click(node) {
  assert.ok(node, "Expected button exists");
  await act(async () => {
    node.click();
  });
}
async function input(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set.call(node, value);
    node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
}
async function render(id) {
  await act(async () =>
    root.render(
      React.createElement(
        LocaleProvider,
        null,
        React.createElement(
          AppShell,
          null,
          React.createElement(Dashboard, { id }),
        ),
      ),
    ),
  );
}
async function refresh() {
  await act(async () => {
    for (const callback of [...intervals.values()]) await callback();
  });
}
function site(id, name, status = "PENDING") {
  return {
    id,
    name,
    url: `https://${name.toLowerCase()}.example`,
    status,
    createdAt: "2026-10-24T12:00:00Z",
    totalChecks: 0,
    successfulChecks: 0,
    successRate: null,
    latest: null,
    checking: false,
    checks: [],
  };
}
function apiFixture() {
  return {
    sites: [],
    requests: [],
    failList: false,
    createError: false,
    finish(id, status, code = 200, error = null) {
      const s = this.sites.find((s) => s.id === id);
      const result = {
        id: s.totalChecks + 1,
        checkedAt: `2026-10-24T12:00:0${s.totalChecks}Z`,
        status,
        httpCode: code,
        durationMs: 80,
        error,
      };
      s.checks.unshift(result);
      s.latest = result;
      s.status = status;
      s.checking = false;
      s.totalChecks++;
      if (status === "UP") s.successfulChecks++;
      s.successRate = (s.successfulChecks / s.totalChecks) * 100;
    },
    async fetch(url, init = {}) {
      const method = init.method || "GET";
      const payload = init.body ? JSON.parse(init.body) : null;
      this.requests.push({ url, method, payload });
      const response = (status, body = null) =>
        new Response(body === null ? null : JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url === "/api/sites") {
        if (method === "GET")
          return this.failList
            ? response(500, {
                message:
                  "Unable to complete the request. Check the backend logs.",
              })
            : response(200, this.sites);
        if (method === "POST") {
          if (this.createError || payload.url.includes("127.0.0.1"))
            return response(400, {
              message:
                "Use a public HTTP or HTTPS URL without credentials or fragments.",
            });
          const created = site(
            Math.max(0, ...this.sites.map((s) => s.id)) + 1,
            payload.name,
          );
          created.url = payload.url;
          created.checking = true;
          this.sites.push(created);
          return response(201, created);
        }
      }
      const match = url.match(/^\/api\/sites\/(\d+)(\/checks|\/check)?$/);
      if (match) {
        const id = Number(match[1]),
          s = this.sites.find((s) => s.id === id);
        if (!s) return response(404, { message: "Monitor not found." });
        if (method === "DELETE") {
          this.sites = this.sites.filter((s) => s.id !== id);
          return response(204);
        }
        if (match[2] === "/check") {
          if (s.checking)
            return response(409, {
              message: "A check is already running for this monitor.",
            });
          s.checking = true;
          return response(202);
        }
        return response(200, match[2] === "/checks" ? s.checks : s);
      }
      throw Error(`Unexpected test request: ${method} ${url}`);
    },
  };
}
beforeEach(() => {
  document.body.innerHTML = '<div id="test-root"></div>';
  dom.window.localStorage.clear();
  fixture = apiFixture();
  global.fetch = fixture.fetch.bind(fixture);
  global.setInterval = (callback) => {
    const id = Symbol();
    intervals.set(id, callback);
    return id;
  };
  global.clearInterval = (id) => intervals.delete(id);
  container = document.getElementById("test-root");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  global.fetch = originalFetch;
  global.setInterval = originalInterval;
  global.clearInterval = originalClear;
  assert.equal(intervals.size, 0, "Polling is cleaned up on unmount");
});

test("Russian default, all language controls, persisted selection, storage events and unavailable storage", async () => {
  await render();
  assert.equal(document.documentElement.lang, "ru");
  assert.match(text(), /Каждый сайт под наблюдением/);
  assert.match(text(), /Начните с первого сайта/);
  assert.equal(
    container.querySelector('.language-switch [aria-pressed="true"]')
      .textContent,
    "RU",
  );
  await click(button("KZ"));
  assert.equal(document.documentElement.lang, "kk");
  assert.equal(dom.window.localStorage.getItem(storageKey), "kk");
  assert.match(text(), /Әр сайт бақылауда/);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  assert.equal(
    document.documentElement.lang,
    "kk",
    "Selection survives remount/reload",
  );
  await act(async () =>
    dom.window.dispatchEvent(
      new dom.window.StorageEvent("storage", {
        key: storageKey,
        newValue: "en",
      }),
    ),
  );
  assert.match(text(), /A pulse on every website/);
  const save = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () => {
    throw new Error("Storage disabled");
  };
  try {
    await click(button("RU"));
    assert.equal(document.documentElement.lang, "ru");
  } finally {
    dom.window.Storage.prototype.setItem = save;
  }
});

test("Add form validates and translates errors, creates real UI state from API response, switches busy to UP", async () => {
  await render();
  await click(button("＋ Добавить сайт"));
  const fields = container.querySelectorAll(".modal input");
  await input(fields[0], "Alpha");
  await submit();
  assert.match(
    container.querySelector(".modal").textContent,
    /Укажите название/,
  );
  assert.equal(fixture.requests.filter((r) => r.method === "POST").length, 0);
  await input(fields[1], "invalid URL");
  await submit();
  assert.match(container.querySelector(".modal").textContent, /публичный HTTP/);
  await input(fields[1], "http://127.0.0.1");
  await submit();
  assert.match(container.querySelector(".modal").textContent, /публичный HTTP/);
  await click(button("KZ"));
  assert.match(
    container.querySelector(".modal").textContent,
    /жалпыға қолжетімді HTTP/,
  );
  await input(fields[1], "https://alpha.example");
  await submit();
  assert.equal(container.querySelector(".modal"), null);
  assert.match(text(), /Тексеруді күтуде/);
  assert.equal(button("Тексерілуде…").disabled, true);
  fixture.finish(1, "UP");
  await refresh();
  assert.match(text(), /Жұмыс істеп тұр/);
  assert.ok(button("Қазір тексеру"));
  assert.match(container.querySelector(".stats").textContent, /100/);
  assert.equal(
    fixture.requests.find(
      (r) => r.method === "POST" && r.payload.url === "https://alpha.example",
    ).payload.name,
    "Alpha",
  );
});

test("Manual check disables repeated action and polling shows DOWN and saved-check ratio", async () => {
  fixture.sites = [site(1, "Alpha")];
  fixture.finish(1, "UP");
  await render();
  await click(button("Проверить сейчас"));
  assert.equal(button("Проверяем…").disabled, true);
  await click(button("Проверяем…"));
  assert.equal(
    fixture.requests.filter((r) => r.url.endsWith("/check")).length,
    1,
  );
  fixture.finish(1, "DOWN", 503);
  await refresh();
  assert.match(text(), /Недоступен/);
  assert.ok(
    container
      .querySelector(".stats")
      .textContent.includes(
        new Intl.NumberFormat("ru-RU", {
          style: "percent",
          minimumFractionDigits: 1,
        }).format(0.5),
      ),
  );
});

test("Search, detail history, locale-aware dates, all status translations and technical error fallback", async () => {
  fixture.sites = [site(1, "Alpha"), site(2, "Beta")];
  fixture.finish(1, "DOWN", null, "Read timed out");
  await render();
  await input(container.querySelector(".search input"), "alpha");
  assert.equal(container.querySelectorAll("tbody tr").length, 1);
  assert.equal(
    container.querySelector(".monitor-name").getAttribute("href"),
    "/sites/1",
  );
  await input(container.querySelector(".search input"), "missing");
  assert.match(text(), /сайты не найдены/);
  await render("1");
  assert.match(text(), /Время ожидания проверки истекло/);
  for (const [label, locale, status] of [
    ["EN", "en", "DOWN"],
    ["KZ", "kk", "Қолжетімсіз"],
    ["RU", "ru", "Недоступен"],
  ]) {
    await click(button(label));
    assert.match(
      container.querySelector("tbody").textContent,
      new RegExp(status),
    );
    const expected = new Intl.DateTimeFormat(localeTags[locale], {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date("2026-10-24T12:00:00Z"));
    assert.ok(container.querySelector(".date").textContent.includes(expected));
  }
  fixture.sites[0].checks[0].error = "Unclassified original diagnostic";
  await refresh();
  assert.match(text(), /Не удалось проверить сайт/);
  assert.match(
    container.querySelector("details summary").textContent,
    /Технические подробности/,
  );
  assert.equal(
    container.querySelector("details code").textContent,
    "Unclassified original diagnostic",
  );
});

test("Delete requires confirmation, cancel preserves monitor, confirm removes it and shows empty state", async () => {
  fixture.sites = [site(1, "Alpha")];
  await render();
  await click(container.querySelector('[aria-label="Удалить сайт «Alpha»"]'));
  assert.match(
    container.querySelector(".modal").textContent,
    /без возможности восстановления/,
  );
  await click(button("Отмена"));
  assert.equal(fixture.requests.filter((r) => r.method === "DELETE").length, 0);
  assert.equal(container.querySelectorAll("tbody tr").length, 1);
  await click(container.querySelector('[aria-label="Удалить сайт «Alpha»"]'));
  await click(button("Удалить сайт"));
  assert.equal(fixture.requests.filter((r) => r.method === "DELETE").length, 1);
  assert.match(text(), /Начните с первого сайта/);
  assert.match(text(), /Сайт и история его проверок удалены/);
});

test("API failure shows translated error without invented zero metrics; retry recovers", async () => {
  fixture.failList = true;
  await render();
  assert.match(text(), /Сервер не смог выполнить запрос/);
  assert.match(text(), /Не удалось загрузить сайты/);
  assert.equal(container.querySelector(".stat strong").textContent, "—");
  assert.doesNotMatch(text(), /Начните с первого сайта/);
  await click(button("EN"));
  assert.match(text(), /The server could not complete the request/);
  fixture.failList = false;
  await click(button("Retry"));
  assert.match(text(), /Your first monitor starts here/);
  assert.equal(container.querySelector(".stat strong").textContent, "0");
});

test("Missing detail stays an error rather than an invented empty history", async () => {
  await render("999");
  assert.match(text(), /Сайт не найден/);
  assert.match(text(), /Не удалось загрузить историю/);
  assert.equal(container.querySelector(".stat strong").textContent, "—");
});

test("All dictionaries have identical interpolation parameters and exact requested status labels", () => {
  const keys = Object.keys(messages.ru).sort();
  for (const locale of ["ru", "kk", "en"]) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys);
    for (const key of keys) {
      assert.ok(messages[locale][key].trim());
      const placeholders = (value) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(
        placeholders(messages[locale][key]),
        placeholders(messages.ru[key]),
      );
    }
  }
  assert.equal(translate("ru", "statusUp"), "Работает");
  assert.equal(translate("ru", "statusDown"), "Недоступен");
  assert.equal(translate("ru", "statusPending"), "Ожидает проверки");
  assert.equal(translate("kk", "statusUp"), "Жұмыс істеп тұр");
  assert.equal(translate("kk", "statusDown"), "Қолжетімсіз");
  assert.equal(translate("kk", "statusPending"), "Тексеруді күтуде");
});

test("Background refresh must not erase a rejected form submission", async () => {
  await render();
  await click(button("＋ Добавить сайт"));
  const fields = container.querySelectorAll(".modal input");
  await input(fields[0], "Alpha");
  await input(fields[1], "http://127.0.0.1");
  await submit();
  assert.match(container.querySelector(".modal").textContent, /публичный HTTP/);
  await refresh();
  assert.match(
    container.querySelector(".modal").textContent,
    /публичный HTTP/,
    "The validation error stays visible while background polling succeeds",
  );
});

test("A delayed older list response must not overwrite a newly created monitor", async () => {
  let release;
  const actual = fixture.fetch.bind(fixture);
  let first = true;
  global.fetch = (url, init = {}) => {
    if (
      url === "/api/sites" &&
      (!init.method || init.method === "GET") &&
      first
    ) {
      first = false;
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    return actual(url, init);
  };
  await render();
  await click(button("＋ Добавить сайт"));
  const fields = container.querySelectorAll(".modal input");
  await input(fields[0], "Alpha");
  await input(fields[1], "https://alpha.example");
  await submit();
  assert.ok(
    container.querySelector(".monitor-name")?.textContent.includes("Alpha"),
  );
  await act(async () =>
    release(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  assert.ok(
    container.querySelector(".monitor-name")?.textContent.includes("Alpha"),
    "Older empty snapshot is ignored",
  );
});
