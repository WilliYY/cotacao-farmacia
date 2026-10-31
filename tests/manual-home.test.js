import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { SUPPLIER_NAMES } from '../src/lib/supplier-selection.js';

const require = createRequire(import.meta.url);

test('Electron opens the local quotation form without website navigation or shortcuts', async () => {
  const previousWindow = globalThis.window;
  let siteCalls = 0;
  globalThis.window = { api: {
    setSiteSheetVisible() { siteCalls++; throw new Error('Website navigation must remain inactive'); },
    openSiteSheet() { siteCalls++; throw new Error('Website navigation must remain inactive'); }
  } };
  try {
    const result = await build({
      configFile: false,
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'silent',
      build: {
        ssr: fileURLToPath(new URL('../src/App.jsx', import.meta.url)),
        write: false,
        rollupOptions: { output: { paths: id => pathToFileURL(require.resolve(id)).href } }
      }
    });
    const output = result.output.find(entry => entry.type === 'chunk' && entry.isEntry);
    const { default: App } = await import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
    const html = renderToStaticMarkup(React.createElement(App));
    assert.match(html, /Medicamentos para cotar/);
    assert.match(html, /Configurar Logins/);
    assert.match(html, /Histórico/);
    const supplierGroup = html.match(/<div class="suppliers-checkboxes"[^>]*>(.*?)<\/div>/s)?.[1] || '';
    const renderedSuppliers = [...supplierGroup.matchAll(/<span>([^<]+)<\/span><\/label>/g)].map(match => match[1]);
    assert.deepEqual(renderedSuppliers, [...SUPPLIER_NAMES]);
    assert.equal((supplierGroup.match(/type="checkbox"/g) || []).length, SUPPLIER_NAMES.length);
    assert.doesNotMatch(supplierGroup, /\bchecked=/);
    assert.equal(html.match(/\d+ de \d+ distribuidoras/)?.[0], `0 de ${SUPPLIER_NAMES.length} distribuidoras`);
    assert.doesNotMatch(html, /Planilha online|Cotar planilha do site|Voltar à planilha/);
    assert.equal(siteCalls, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
