import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createEmbeddedSiteSurface, SITE_TOOLBAR_HEIGHT } from '../src/lib/site-sheet-surface.js';

function harness() {
  const host = new EventEmitter();
  host.size = [1280, 800];
  host.getContentSize = () => host.size;
  host.isDestroyed = () => false;
  host.focus = () => {};
  const children = new Set();
  host.contentView = { addChildView: view => children.add(view), removeChildView: view => children.delete(view) };
  let view;
  class FakeView {
    constructor(options) { view = this; this.options = options; }
    webContents = { destroyed: false, isDestroyed() { return this.destroyed; },
      close() { this.destroyed = true; }, loadURL: async url => { this.url = url; }, focus() {} };
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(visible) { this.visible = visible; }
  }
  const preferences = { partition: 'persist:wimifarma-site-sheet', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
  const surface = createEmbeddedSiteSurface(FakeView, host, preferences);
  return { host, view, surface, children, preferences };
}

test('Embedded worksheet keeps the local toolbar free and resizes with the host content area', () => {
  const { host, view, children, preferences } = harness();
  assert.equal(children.has(view), true);
  assert.equal(view.visible, false);
  assert.deepEqual(view.options.webPreferences, preferences);
  assert.equal('preload' in view.options.webPreferences, false);
  assert.deepEqual(view.bounds, { x: 0, y: SITE_TOOLBAR_HEIGHT, width: 1280, height: 800 - SITE_TOOLBAR_HEIGHT });
  host.size = [1024, 700]; host.emit('resize');
  assert.deepEqual(view.bounds, { x: 0, y: SITE_TOOLBAR_HEIGHT, width: 1024, height: 700 - SITE_TOOLBAR_HEIGHT });
  host.size = [400, 20]; host.emit('resize');
  assert.equal(view.bounds.height, 0);
});

test('A quote dialog hides and restores the same website without destroying its session', () => {
  const { view, surface } = harness();
  surface.show(); assert.equal(view.visible, true);
  surface.hide(); assert.equal(view.visible, false);
  assert.equal(surface.isDestroyed(), false);
  surface.show(); assert.equal(view.visible, true);
});

test('Closing the host closes the remote contents and removes its resize listener', () => {
  const { host, view, surface, children } = harness();
  host.emit('closed');
  assert.equal(view.webContents.destroyed, true);
  assert.equal(surface.isDestroyed(), true);
  assert.equal(host.listenerCount('resize'), 0);
  assert.equal(children.size, 0);
  assert.doesNotThrow(() => surface.close());
});
