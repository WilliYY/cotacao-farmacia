import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const isWindows = process.platform === 'win32';
const updateStatusPath = path.join(projectRoot, 'logs', 'update-status.json');
const bootstrapLockPath = path.join(
  process.env.LOCALAPPDATA || projectRoot,
  'WimifarmaCotacao',
  'bootstrap.lock'
);

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

function getCurrentRevision() {
  const revision = run('git', ['rev-parse', '--short', 'HEAD']);
  return revision.ok ? revision.stdout : '';
}

export function createUpdateStatus(updateResult, repositoryState, environment = process.env, checkedAt = new Date().toISOString()) {
  const failed = updateResult?.failed === true;
  const status = failed ? 'failed' : (updateResult?.updated ? 'updated' : (updateResult?.skipped || 'unknown'));
  return {
    checkedAt,
    status,
    automaticUpdateEnabled: String(environment.AUTO_UPDATE_ON_STARTUP || '').toLowerCase() !== 'false',
    updated: !failed && updateResult?.updated === true,
    commitCount: Number.isInteger(updateResult?.commitCount) ? updateResult.commitCount : 0,
    gitAvailable: repositoryState?.gitAvailable !== false,
    branch: repositoryState?.branch || '',
    upstream: repositoryState?.upstream || '',
    revision: repositoryState?.revision || '',
    ...(updateResult?.error ? { error: String(updateResult.error) } : {})
  };
}

function writeUpdateStatus(updateResult, environment = process.env) {
  const repositoryState = {
    ...getRepositoryState(environment),
    revision: getCurrentRevision()
  };
  const status = createUpdateStatus(updateResult, repositoryState, environment);
  fs.mkdirSync(path.dirname(updateStatusPath), { recursive: true });
  fs.writeFileSync(updateStatusPath, JSON.stringify(status, null, 2), 'utf8');
  return status;
}

function readUpdateStatus() {
  try {
    return JSON.parse(fs.readFileSync(updateStatusPath, 'utf8'));
  } catch {
    return {};
  }
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function acquireBootstrapLock(lockPath = bootstrapLockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const invalidLockGraceMs = 30_000;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = randomUUID();
      const descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, JSON.stringify({
        pid: process.pid,
        token,
        startedAt: new Date().toISOString()
      }), 'utf8');
      fs.fsyncSync(descriptor);
      let released = false;
      return {
        acquired: true,
        release() {
          if (released) return;
          released = true;
          try { fs.closeSync(descriptor); } catch {}
          try {
            const currentOwner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            if (currentOwner?.token === token) fs.unlinkSync(lockPath);
          } catch {}
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let lockSnapshot = '';
      let lockAgeMs = 0;
      let ownerPid = 0;
      let ownerToken = '';
      try {
        lockAgeMs = Math.max(0, Date.now() - fs.statSync(lockPath).mtimeMs);
        lockSnapshot = fs.readFileSync(lockPath, 'utf8');
        const lockOwner = JSON.parse(lockSnapshot);
        ownerPid = Number.parseInt(lockOwner?.pid, 10);
        ownerToken = String(lockOwner?.token || '');
      } catch {}
      if (isProcessRunning(ownerPid)) {
        return { acquired: false, release() {} };
      }
      if ((!ownerPid || !ownerToken) && lockAgeMs < invalidLockGraceMs) {
        return { acquired: false, release() {} };
      }
      try {
        const currentSnapshot = fs.readFileSync(lockPath, 'utf8');
        let currentOwner = null;
        try { currentOwner = JSON.parse(currentSnapshot); } catch {}
        const sameToken = ownerToken && currentOwner?.token === ownerToken;
        const sameInvalidSnapshot = !ownerToken && currentSnapshot === lockSnapshot;
        if (sameToken || sameInvalidSnapshot) fs.unlinkSync(lockPath);
      } catch {}
    }
  }

  return { acquired: false, release() {} };
}

export function shouldBuildProductionAssets(updateResult = {}, distExists = false, previousStatus = {}) {
  return !distExists || updateResult.updated === true || previousStatus.status === 'failed';
}

export function getRepositoryState(environment = process.env) {
  const gitDirectory = path.join(projectRoot, '.git');
  const hasGitDirectory = fs.existsSync(gitDirectory);
  const gitAvailable = commandExists('git');
  if (!hasGitDirectory || !gitAvailable) {
    return {
      isRepository: hasGitDirectory,
      gitAvailable,
      dirty: false,
      branch: '',
      upstream: ''
    };
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
    gitAvailable: true,
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
  if (state.gitAvailable === false) return 'git-unavailable';
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
    'git-unavailable': '[UPDATE] Programa Git nao encontrado; mantendo a versao instalada.',
    'dirty-worktree': '[UPDATE] Alteracoes locais detectadas; atualizacao Git ignorada para preservar os arquivos.',
    'no-upstream': '[UPDATE] Branch sem upstream; configure o rastreamento remoto ou AUTO_UPDATE_BRANCH.'
  };
  if (blockReason) {
    console.log(blockMessages[blockReason]);
    return { updated: false, skipped: blockReason };
  }

  console.log(`[UPDATE] Verificando ${initialState.upstream}...`);
  const remote = initialState.upstream.split('/')[0];
  const fetch = run('git', ['fetch', '--quiet', remote], { timeout: 5_000 });
  if (!fetch.ok) {
    console.log('[UPDATE] Sem acesso ao repositorio remoto ou conexao lenta; iniciando a versao local.');
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

function installDependencies(updateResult, previousStatus = {}) {
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  const needsInstall = !fs.existsSync(nodeModulesPath) ||
    updateResult?.updated === true ||
    previousStatus?.status === 'failed';

  if (!needsInstall) {
    return;
  }

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

export function getElectronExecutablePath(rootDirectory = projectRoot) {
  const electronDirectory = path.join(rootDirectory, 'node_modules', 'electron');
  const pathFile = path.join(electronDirectory, 'path.txt');
  if (!fs.existsSync(pathFile)) return null;

  const executableName = fs.readFileSync(pathFile, 'utf8').trim();
  const execPath = path.join(electronDirectory, 'dist', executableName);
  return fs.existsSync(execPath) ? execPath : null;
}

export function isElectronRuntimeReady(rootDirectory = projectRoot) {
  return Boolean(getElectronExecutablePath(rootDirectory));
}

function ensureElectronRuntime() {
  if (isElectronRuntimeReady()) return;

  console.log('[DEPENDENCIAS] Baixando o executavel oficial do Electron...');
  const installElectron = runNpm(['exec', 'install-electron', '--', '--no'], {
    stdio: 'inherit',
    timeout: 10 * 60_000
  });
  if (!installElectron.ok || !isElectronRuntimeReady()) {
    throw new Error('O executavel do Electron nao foi instalado corretamente.');
  }
}

function ensureProductionBuild(updateResult, previousStatus = {}) {
  const distHtml = path.join(projectRoot, 'dist', 'index.html');
  if (!shouldBuildProductionAssets(updateResult, fs.existsSync(distHtml), previousStatus)) return;

  console.log('[APP] Compilando e validando a interface de producao...');
  const build = runNpm(['run', 'build'], {
    stdio: 'inherit',
    timeout: 5 * 60_000
  });
  if (!build.ok || !fs.existsSync(distHtml)) {
    throw new Error(`npm run build falhou com codigo ${build.status ?? 'desconhecido'}.`);
  }
}

function startApplication() {
  console.log('[APP] Iniciando Wimifarma Cotacao...');
  const distHtml = path.join(projectRoot, 'dist', 'index.html');

  const electronExec = getElectronExecutablePath();

  // Launch Electron executable directly for 100% clean process tree and instant exit
  if (electronExec && fs.existsSync(distHtml) && !process.env.FORCE_DEV_SERVER) {
    const result = run(electronExec, ['.'], { stdio: 'inherit' });
    return result.status ?? 0;
  }

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
    electronRuntimeReady: isElectronRuntimeReady(),
    updateStatusPath,
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
    const bootstrapLock = acquireBootstrapLock();
    if (!bootstrapLock.acquired) {
      console.log('[APP] Outra instancia esta aberta; atualizacao e compilacao foram ignoradas com seguranca.');
      process.exitCode = 0;
    } else {
      let updateResult = { updated: false, skipped: 'not-started' };
      const previousStatus = readUpdateStatus();
    try {
      updateResult = updateRepository(environment);
      installDependencies(updateResult, previousStatus);
      ensureElectronRuntime();
      ensureProductionBuild(updateResult, previousStatus);
      const updateStatus = writeUpdateStatus(updateResult, environment);
      console.log(`[UPDATE] Estado validado: ${updateStatus.status} (${updateStatus.revision || 'sem revisao Git'}).`);
      if (process.argv.includes('--prepare-only')) {
        console.log('[APP] Preparacao concluida; abertura ignorada por --prepare-only.');
      } else {
        process.exitCode = startApplication();
      }
    } catch (error) {
      writeUpdateStatus({
        ...updateResult,
        updated: false,
        failed: true,
        error: error.message
      }, environment);
      console.error(`[ERRO] ${error.message}`);
      process.exitCode = 1;
    } finally {
      bootstrapLock.release();
    }
    }
  }
}
