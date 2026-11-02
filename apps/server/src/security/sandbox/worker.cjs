'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

function sanitize(value) {
  try {
    const json = JSON.stringify(value);
    if (!json) return null;
    if (json.length > 20_000) {
      return { truncated: true, preview: json.slice(0, 20_000) };
    }
    return JSON.parse(json);
  } catch {
    return { unserializable: String(value) };
  }
}

try {
  const sandbox = Object.create(null);
  sandbox.__data = workerData.data;
  sandbox.console = Object.freeze({ log: () => {}, warn: () => {}, error: () => {} });
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: 'bills-analysis-sandbox',
  });
  const userCode = String(workerData.code || '');
  const wrapped = `"use strict"; (() => {
    const data = __data;
    let __out = null;
    ${userCode}
    return __out;
  })()`;
  const script = new vm.Script(wrapped, { filename: 'analysis.sandbox.js' });
  const result = script.runInContext(context, { timeout: 800, breakOnSigint: false });
  parentPort.postMessage({ ok: true, result: sanitize(result) });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error && error.message ? error.message : String(error),
  });
}
