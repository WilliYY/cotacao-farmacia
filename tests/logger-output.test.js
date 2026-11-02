import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

const source = fs.readFileSync(new URL('../src/lib/logger.js', import.meta.url), 'utf8');
const brokenPipe = () => Object.assign(new Error('EPIPE: broken pipe, write'), { code: 'EPIPE' });

function loadLogger({ consoleFailure, fileFailure = false, streams, consoleTarget } = {}) {
  const stdout = streams?.stdout || new EventEmitter();
  const stderr = streams?.stderr || new EventEmitter();
  const printed = [];
  const written = [];
  const context = {
    process: { env: { LOG_LEVEL: 'debug' }, stdout, stderr }, path,
    dotenv: { config() {} },
    fs: {
      existsSync: () => true, statSync: () => ({ size: 0 }),
      appendFileSync: (_, line) => {
        if (fileFailure) throw new Error('fixture disk failure');
        written.push(line);
      }
    },
    console: consoleTarget || Object.fromEntries(['log', 'warn', 'error'].map(method => [method, (...args) => {
      printed.push({ method, args });
      consoleFailure?.(method);
    }]))
  };
  vm.runInNewContext(source.replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '') +
    '\nthis.logger = logger;', context);
  return { logger: context.logger, stdout, stderr, printed, written };
}

test('logger keeps sanitized file records when stdout throws EPIPE synchronously', () => {
  const fixture = loadLogger({ consoleFailure: method => { if (method === 'log') throw brokenPipe(); } });
  assert.doesNotThrow(() => fixture.logger.info('token=private-value first'));
  assert.doesNotThrow(() => fixture.logger.debug('second'));
  fixture.logger.warn('healthy stderr');
  assert.equal(fixture.printed.filter(entry => entry.method === 'log').length, 1);
  assert.equal(fixture.printed.filter(entry => entry.method === 'warn').length, 1);
  assert.equal(fixture.written.length, 3);
  assert.match(fixture.written[0], /\[INFO\].*REDACTED/);
  assert.ok(fixture.written.every(line => !line.includes('private-value')));
});

test('logger handles asynchronous stdout EPIPE without disabling stderr or adding listeners per message', () => {
  const fixture = loadLogger();
  fixture.logger.info('before closure');
  assert.doesNotThrow(() => fixture.stdout.emit('error', brokenPipe()));
  fixture.logger.info('after closure');
  fixture.logger.error('healthy stderr');
  fixture.logger.error('still healthy');
  assert.equal(fixture.printed.filter(entry => entry.method === 'log').length, 1);
  assert.equal(fixture.printed.filter(entry => entry.method === 'error').length, 2);
  assert.equal(fixture.stdout.listenerCount('error'), 1);
  assert.equal(fixture.stderr.listenerCount('error'), 1);
  assert.equal(fixture.written.length, 4);
});

test('stderr EPIPE leaves stdout and file logging available, including the file-error fallback', () => {
  const fixture = loadLogger({ consoleFailure: method => { if (method !== 'log') throw brokenPipe(); } });
  assert.doesNotThrow(() => fixture.logger.warn('first warning'));
  assert.doesNotThrow(() => fixture.logger.error('next error'));
  fixture.logger.info('healthy stdout');
  assert.equal(fixture.printed.length, 2);
  assert.equal(fixture.written.length, 3);
  const failedFile = loadLogger({ fileFailure: true, consoleFailure: method => {
    if (method === 'error') throw brokenPipe();
  } });
  assert.doesNotThrow(() => failedFile.logger.info('disk failure plus closed stderr'));
});

test('destroyed or ended streams are skipped while normal formatting and file levels remain intact', () => {
  const fixture = loadLogger();
  fixture.stdout.destroyed = true;
  fixture.stderr.writableEnded = true;
  fixture.logger.debug('debug record');
  fixture.logger.info('info record');
  fixture.logger.warn('warning record');
  fixture.logger.error('error record');
  assert.equal(fixture.printed.length, 0);
  assert.deepEqual(fixture.written.map(line => line.match(/\[(DEBUG|INFO|WARN|ERROR)\]/)[1]),
    ['DEBUG', 'INFO', 'WARN', 'ERROR']);
  const healthy = loadLogger();
  healthy.logger.info('healthy message');
  assert.equal(healthy.printed[0].args[0], '\x1b[32m[INFO]\x1b[0m healthy message');
});

test('unrelated console and stream errors remain observable and existing stream handlers still run', () => {
  const unexpected = Object.assign(new Error('unexpected output failure'), { code: 'EIO' });
  const failingConsole = loadLogger({ consoleFailure: () => { throw unexpected; } });
  assert.throws(() => failingConsole.logger.info('failure'), error => error === unexpected);
  const fixture = loadLogger();
  fixture.logger.info('install transport handler');
  assert.throws(() => fixture.stdout.emit('error', unexpected), error => error === unexpected);
  let observed;
  fixture.stdout.on('error', error => { observed = error; });
  assert.doesNotThrow(() => fixture.stdout.emit('error', unexpected));
  assert.equal(observed, unexpected);
});

test('a real closed parent pipe does not crash the child or corrupt its healthy stderr', { timeout: 25_000 }, async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { Console } from 'node:console';
    import { once, EventEmitter } from 'node:events';
    import vm from 'node:vm';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    const source = ${JSON.stringify(source)};
    const loadLogger = ${loadLogger.toString()};
    const fixture = loadLogger({ streams: process,
      consoleTarget: new Console({ stdout: process.stdout, stderr: process.stderr, ignoreErrors: false }) });
    fixture.logger.info('PIPE_READY');
    await once(process.stdin, 'data');
    fixture.logger.info('x'.repeat(262144));
    await new Promise(resolve => setTimeout(resolve, 100));
    fixture.logger.info('after closure');
    fixture.logger.warn('PIPE_SURVIVED');
    assert.equal(fixture.written.length, 4);
  `], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let ready = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8').on('data', chunk => {
    ready += chunk;
    if (ready.includes('PIPE_READY') && !child.stdout.destroyed) {
      child.stdout.destroy();
      child.stdin.end('go');
    }
  });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [code, signal] = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve([code, signal]));
    });
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    assert.match(stderr, /PIPE_SURVIVED/);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});
