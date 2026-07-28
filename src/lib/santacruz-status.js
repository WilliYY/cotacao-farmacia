const STATUS_LABELS = Object.freeze({
  checking: 'Verificando Santa Cruz',
  preparing: 'Abrindo e preparando Santa Cruz',
  ready: 'Santa Cruz pronta',
  closed: 'Abra a Santa Cruz para cotar',
  updating: 'Santa Cruz atualizando',
  busy: 'Santa Cruz ocupada com outra cotação',
  'login-required': 'Login da Santa Cruz identificado',
  'logged-in-home': 'Santa Cruz aberta na tela inicial',
  'logged-in-orders': 'Santa Cruz aberta em Pedidos',
  'running-without-window': 'Santa Cruz sem janela acessível',
  'not-installed': 'Santa Cruz não localizada',
  'open-not-ready': 'Santa Cruz aberta, rota ainda não reconhecida',
  'not-responding': 'Santa Cruz não está respondendo',
  'launch-failed': 'Santa Cruz não abriu',
  'search-control-not-found': 'Campo de pesquisa da Santa Cruz não localizado',
  'login-button-not-found': 'Botão de login da Santa Cruz não localizado',
  'login-failed': 'Login da Santa Cruz falhou',
  'missing-credentials': 'Login da Santa Cruz não configurado',
  'automation-failed': 'Automação da Santa Cruz falhou',
  'status-failed': 'Não foi possível verificar a Santa Cruz',
  'prepare-failed': 'Não foi possível preparar a Santa Cruz'
});

const INFO_STATUSES = new Set([
  'checking',
  'preparing',
  'updating',
  'login-required',
  'logged-in-home',
  'logged-in-orders'
]);

const DANGER_STATUSES = new Set([
  'running-without-window',
  'not-installed',
  'not-responding',
  'launch-failed',
  'search-control-not-found',
  'login-button-not-found',
  'login-failed',
  'missing-credentials',
  'automation-failed',
  'status-failed',
  'prepare-failed'
]);

export function getSantaCruzStatusLabel(status) {
  return STATUS_LABELS[status] || 'Estado da Santa Cruz';
}

export function getSantaCruzStatusTone(status, ready) {
  if (INFO_STATUSES.has(status)) return 'info';
  if (ready || status === 'ready') return 'success';
  if (DANGER_STATUSES.has(status)) return 'danger';
  return 'warning';
}

export function getSantaCruzStatusView(statusData = {}, activity = {}) {
  const status = activity.isPreparing
    ? 'preparing'
    : activity.isChecking
    ? 'checking'
    : statusData.status || 'status-failed';
  const inProgress = status === 'checking' || status === 'preparing';
  const ready = !inProgress && Boolean(statusData.ready);
  const reason = status === 'preparing'
    ? 'Localizando, abrindo, entrando e preparando a tela de pesquisa.'
    : status === 'checking'
    ? 'Consultando o estado atual do aplicativo Santa Cruz.'
    : statusData.reason || 'Aguardando o estado da automação local.';

  let hint = 'O sistema continuará verificando a janela automaticamente.';
  if (status === 'checking') {
    hint = 'O sistema está confirmando a janela e a rota de pesquisa.';
  } else if (status === 'preparing') {
    hint = 'A cotação ficará disponível assim que a preparação terminar.';
  } else if (ready) {
    hint = 'A próxima cotação reutilizará a tela de pesquisa que já está aberta.';
  } else if (statusData.requiresOperator) {
    hint = 'A cotação da Santa Cruz ficará bloqueada até este estado ser resolvido.';
  } else if (status === 'busy') {
    hint = 'Aguarde a outra cotação terminar antes de verificar ou preparar novamente.';
  }

  return {
    status,
    label: getSantaCruzStatusLabel(status),
    tone: getSantaCruzStatusTone(status, ready),
    reason,
    hint,
    inProgress,
    ready
  };
}
