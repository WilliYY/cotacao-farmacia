import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const isWindows = process.platform === 'win32';

function loadBootstrapEnvironment() {
  const environment = { ...process.env };
  const environmentPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(environmentPath)) return environment;

  const supportedKeys = new Set(['AUTO_UPDATE_ON_STARTUP', 'AUTO_UPDATE_BRANCH']);
  const lines = fs.readFileSync(environmentPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !supportedKeys.has(match[1]) || process.env[match[1]] !== undefined) continue;
    environment[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return environment;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    ...options
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error
  };
}

function commandExists(command) {
  return run(command, ['--version']).ok;
}

function runNpm(args, options = {}) {
  const npmExecPath = String(process.env.npm_execpath || '');
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return run(process.execPath, [npmExecPath, ...args], options);
  }
  if (isWindows) {
    const commandLine = ['npm', ...args].join(' ');
    return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], options);
  }
  return run('npm', args, options);
}

function npmExists() {
  return runNpm(['--version']).ok;
}

export function getRepositoryState(environment = process.env) {
  const gitDirectory = path.join(projectRoot, '.git');
  if (!fs.existsSync(gitDirectory) || !commandExists('git')) {
    return { isRepository: false, dirty: false, branch: '', upstream: '' };
  }

  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=no']);
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const configuredBranch = String(environment.AUTO_UPDATE_BRANCH || '').trim();
  let upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);

  if (!upstream.ok && configuredBranch && branch.stdout === configuredBranch) {
    const configuredUpstream = `origin/${configuredBranch}`;
    const exists = run('git', ['rev-parse', '--verify', configuredUpstream]);
    if (exists.ok) upstream = { ...exists, stdout: configuredUpstream };
  }

  if (!upstream.ok && branch.ok) {
    const remoteDefault = run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const remoteBranchName = remoteDefault.ok
      ? remoteDefault.stdout.replace(/^origin\//, '')
      : '';
    if (remoteBranchName === branch.stdout) upstream = remoteDefault;
  }

  return {
    isRepository: true,
    dirty: !status.ok || status.stdout.length > 0,
    branch: branch.ok ? branch.stdout : '',
    upstream: upstream.ok ? upstream.stdout : ''
  };
}

export function getUpdateBlockReason(state, environment = process.env) {
  if (String(environment.AUTO_UPDATE_ON_STARTUP || '').toLowerCase() === 'false') {
    return 'disabled';
  }
  if (!state.isRepository) return 'not-a-repository';
  if (state.dirty) return 'dirty-worktree';
  if (!state.upstream) return 'no-upstream';
  return '';
}

function updateRepository(environment = process.env) {
  const initialState = getRepositoryState(environment);
  const blockReason = getUpdateBlockReason(initialState, environment);
  const blockMessages = {
    disabled: '[UPDATE] Atualizacao automatica desativada por configuracao.',
    'not-a-repository': '[UPDATE] Pasta sem Git; mantendo a versao instalada.',
    'dirty-worktree': '[UPDATE] Alteracoes locais detectadas; atualizacao Git ignorada para preservar os arquivos.',
    'no-upstream': '[UPDATE] Branch sem upstream; configure o rastreamento remoto ou AUTO_UPDATE_BRANCH.'
  };
  if (blockReason) {
    console.log(blockMessages[blockReason]);
    return { updated: false, skipped: blockReason };
  }

  console.log(`[UPDATE] Verificando ${initialState.upstream}...`);
  const remote = initialState.upstream.split('/')[0];
  const fetch = run('git', ['fetch', '--quiet', remote], { timeout: 60_000 });
  if (!fetch.ok) {
    console.log('[UPDATE] Sem acesso ao repositorio remoto; iniciando a versao local.');
    return { updated: false, skipped: 'fetch-failed' };
  }

  const behind = run('git', ['rev-list', '--count', `HEAD..${initialState.upstream}`]);
  const commitCount = behind.ok ? Number.parseInt(behind.stdout, 10) : 0;
  if (!Number.isInteger(commitCount) || commitCount <= 0) {
    console.log('[UPDATE] Codigo ja esta na versao mais recente.');
    return { updated: false, skipped: 'up-to-date' };
  }

  console.log(`[UPDATE] Aplicando ${commitCount} atualizacao(oes) em modo fast-forward...`);
  const merge = run('git', ['merge', '--ff-only', initialState.upstream], { stdio: 'inherit', timeout: 120_000 });
  if (!merge.ok) {
    console.log('[UPDATE] Nao foi possivel atualizar com seguranca; iniciando a versao local.');
    return { updated: false, skipped: 'merge-failed' };
  }

  return { updated: true, commitCount };
}

function installDependencies() {
  if (!npmExists()) {
    throw new Error('npm nao foi encontrado. Instale uma versao atual do Node.js.');
  }

  console.log('[DEPENDENCIAS] Validando package-lock.json e instalando o necessario...');
  const install = runNpm(['install', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
    timeout: 10 * 60_000
  });
  if (!install.ok) {
    throw new Error(`npm install falhou com codigo ${install.status ?? 'desconhecido'}.`);
  }
}

function startApplication() {
  console.log('[APP] Iniciando Wimifarma Cotacao...');
  const application = runNpm(['run', 'dev:app'], { stdio: 'inherit' });
  return application.status ?? 1;
}

function printDiagnostics(environment) {
  const state = getRepositoryState(environment);
  console.log(JSON.stringify({
    projectRoot,
    node: process.version,
    npmAvailable: npmExists(),
    gitAvailable: commandExists('git'),
    autoUpdateEnabled: String(environment.AUTO_UPDATE_ON_STARTUP || '').toLowerCase() !== 'false',
    configuredBranch: String(environment.AUTO_UPDATE_BRANCH || ''),
    ...state
  }));
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const environment = loadBootstrapEnvironment();
  if (process.argv.includes('--diagnose')) {
    printDiagnostics(environment);
  } else {
    try {
      updateRepository(environment);
      installDependencies();
      if (process.argv.includes('--prepare-only')) {
        console.log('[APP] Preparacao concluida; abertura ignorada por --prepare-only.');
      } else {
        process.exitCode = startApplication();
      }
    } catch (error) {
      console.error(`[ERRO] ${error.message}`);
      process.exitCode = 1;
    }
  }
}
