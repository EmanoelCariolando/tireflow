const byId = id => document.getElementById(id);
const unavailable = 'Não disponível';
const date = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : unavailable;
const time = value => new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(new Date(value));
let token = null;
let submitting = false;
let snapshot = null;
let logs = [];
let level = 'ALL';
let pairingRevision = null;
let pairingExpiresAt = 0;
let pairingRefreshing = false;

function clearPairing(state = 'unavailable', demo = false) {
  const canvas = byId('pairing-qr');
  canvas.hidden = true; canvas.width = 0; canvas.height = 0;
  delete canvas.dataset.revision;
  pairingRevision = null; pairingExpiresAt = 0;
  byId('pairing-empty').hidden = false;
  document.querySelector('.pairing-card').dataset.state = state;
  const labels = { unavailable: ['Não disponível', 'neutral'], waiting: ['Aguardando QR', 'neutral'], authenticated: ['Autenticado', 'success'], connected: ['Conectado', 'success'] };
  badge('pairing-badge', ...(labels[state] || labels.unavailable));
  byId('pairing-note').textContent = state === 'connected' ? 'WhatsApp conectado. O QR anterior foi apagado.' : state === 'authenticated' ? 'Autenticação recebida. Aguarde a sincronização do WhatsApp.' : state === 'waiting' ? 'Aguardando um novo QR enviado pelo WhatsApp.' : 'QR indisponível. O bot atualizado precisa estar em execução.';
  byId('pairing-instructions').textContent = demo ? 'Demonstração do laboratório: este QR não autentica uma conta WhatsApp.' : 'No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.';
}

function renderPairing(data) {
  if (data?.state !== 'qr') { clearPairing(data?.state, data?.demonstration === true); return; }
  const rows = data.rows;
  if (typeof data.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(data.revision) ||
    !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 60000 ||
    !Array.isArray(rows) || rows.length < 21 || rows.length > 177 || (rows.length - 21) % 4 !== 0 ||
    rows.some(row => typeof row !== 'string' || row.length !== rows.length || !/^[01]+$/.test(row))) { clearPairing(); return; }
  const canvas = byId('pairing-qr');
  if (pairingRevision !== data.revision) {
    canvas.hidden = true;
    const scale = Math.max(4, Math.floor(320 / (rows.length + 8)));
    canvas.width = canvas.height = (rows.length + 8) * scale;
    const context = canvas.getContext('2d');
    if (!context) { clearPairing(); return; }
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x += 1) if (row[x] === '1') context.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale); });
    pairingRevision = data.revision;
    canvas.dataset.revision = data.revision;
  }
  pairingExpiresAt = data.expiresAt;
  canvas.hidden = false;
  byId('pairing-empty').hidden = true;
  document.querySelector('.pairing-card').dataset.state = 'qr';
  badge('pairing-badge', data.demonstration === true ? 'QR de demonstração' : 'Escaneie o QR atual', 'warning');
  byId('pairing-instructions').textContent = data.demonstration === true ? 'Demonstração do laboratório: este QR não autentica uma conta WhatsApp.' : 'No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.';
  byId('pairing-note').textContent = 'Quando chegar um novo QR, esta imagem será apagada e substituída automaticamente.';
}

async function refreshPairing() {
  if (pairingRefreshing || document.hidden) return;
  pairingRefreshing = true;
  try {
    if (!token) token = (await api('session', { signal: AbortSignal.timeout(2500) })).token;
    const data = await api('pairing', { method: 'POST', headers: { 'content-type': 'application/json', 'x-control-token': token }, body: '{}', signal: AbortSignal.timeout(2500) });
    if (!document.hidden) renderPairing(data);
  } catch { token = null; clearPairing(); }
  finally { pairingRefreshing = false; }
}

async function api(route, options) {
  const response = await fetch(`/api/${route}`, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha na comunicação com o painel.');
  return data;
}
function badge(id, text, kind) { const target = byId(id); target.textContent = text; target.className = `badge ${kind}`; }
function notice(message, error = false) { const target = byId('notice'); target.hidden = false; target.textContent = message; target.className = error ? 'notice error' : 'notice'; }
function updateButtons() {
  const state = snapshot?.service;
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    let disabled = submitting || !!snapshot?.busy || !snapshot;
    if (['start', 'stop', 'restart'].includes(action)) {
      disabled ||= !state?.canControl || !['online', 'offline'].includes(state?.state);
      disabled ||= action === 'start' && state?.state !== 'offline';
      disabled ||= action === 'stop' && state?.state !== 'online';
    }
    if (action === 'check-update') disabled ||= !snapshot?.productionBranch;
    button.disabled = disabled;
  }
}
function showStatus(data) {
  snapshot = data;
  const labels = { online: ['Online', 'success'], offline: ['Offline', 'neutral'], starting: ['Iniciando', 'warning'], stopping: ['Parando', 'warning'], error: ['Erro', 'error'], unavailable: [unavailable, 'neutral'] };
  badge('service-badge', ...(labels[data.service.state] || labels.unavailable));
  byId('service-description').textContent = data.service.message || ({ online: 'Processo do bot ativo no serviço Windows.', offline: 'Serviço parado. O painel continua disponível.', starting: 'Aguardando o processo do bot iniciar.', stopping: 'Aguardando o encerramento do processo.', error: 'O serviço requer atenção. Confira os logs.' }[data.service.state] || unavailable);
  const whatsapp = data.whatsappConnected;
  badge('whatsapp-badge', whatsapp === true ? 'Conectado' : whatsapp === false ? 'Desconectado' : unavailable, whatsapp === true ? 'success' : whatsapp === false ? 'warning' : 'neutral');
  byId('whatsapp-description').textContent = whatsapp === true ? 'Conexão informada pelo processo ativo do bot.' : whatsapp === false ? 'O bot informou que o WhatsApp está desconectado.' : 'Sem informação recente do processo ativo.';
  const seconds = data.uptimeSeconds;
  byId('uptime').textContent = seconds === null ? unavailable : `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h ${Math.floor(seconds % 3600 / 60)}min`;
  byId('service-name').textContent = data.serviceName || unavailable;
  byId('version').textContent = data.version ? `v${data.version}` : unavailable;
  byId('installed-version').textContent = data.version ? `v${data.version}` : unavailable;
  byId('available-version').parentElement.classList.toggle('has-update', data.update?.available === true);
  byId('current-commit').textContent = data.currentCommit ? `commit ${data.currentCommit.slice(0, 10)}` : 'Commit não disponível';
  byId('production-branch').textContent = data.productionBranch || 'Branch não configurada';
  byId('last-update').textContent = date(data.lastUpdate);
  byId('update-blocked').textContent = data.updateBlocked;
  if (data.update) {
    byId('available-version').textContent = data.update.latest.slice(0, 10);
    byId('update-description').textContent = data.update.available ? 'O commit da branch de produção é diferente do instalado.' : 'A instalação corresponde à branch de produção.';
  }
  const busy = { start: 'Iniciando o serviço…', stop: 'Parando o serviço…', restart: 'Reiniciando o serviço…', backup: 'Criando e verificando o backup…', 'verify-backup': 'Conferindo o último backup…', 'check-update': 'Consultando a branch de produção…' };
  byId('control-hint').textContent = data.busy ? busy[data.busy] : data.service.canControl ? 'Comandos disponíveis para a instalação validada.' : 'Controles exigem configuração válida e permissões administrativas.';
  const backup = data.backup;
  byId('backup-date').textContent = date(backup?.createdAt);
  byId('backup-verified').textContent = date(backup?.verifiedAt);
  const verification = backup?.verification;
  badge('backup-badge', verification === 'verified' ? 'Verificado' : verification === 'failed' ? 'Falhou' : unavailable, verification === 'verified' ? 'success' : verification === 'failed' ? 'error' : 'neutral');
  const activities = byId('activities');
  activities.replaceChildren();
  if (!data.activities.length) { const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'Nenhuma ação nesta sessão.'; activities.append(empty); }
  for (const entry of [...data.activities].reverse()) {
    const item = document.createElement('li');
    if (!entry.success) item.className = 'failed';
    item.append(document.createTextNode(entry.message));
    const stamp = document.createElement('time'); stamp.dateTime = entry.timestamp; stamp.textContent = date(entry.timestamp); item.append(stamp); activities.append(item);
  }
  updateButtons();
}
function renderLogs() {
  const target = byId('log-output');
  const scroll = target.scrollTop;
  target.replaceChildren();
  const filtered = logs.filter(entry => level === 'ALL' || entry.level === level);
  const files = [...new Set(logs.map(entry => entry.file).filter(Boolean))];
  byId('log-source').textContent = files.length ? `Pasta logs: ${files.join(' · ')}` : 'Pasta logs: nenhum arquivo diário disponível';
  for (const entry of filtered) {
    const line = document.createElement('div'); line.className = 'log-line';
    if (entry.file) line.title = `Arquivo: logs/${entry.file}`;
    for (const [className, text] of [['log-time', `[${entry.timestamp}]`], [`log-level ${entry.level}`, `[${entry.level}]`], ['log-message', entry.message]]) {
      const part = document.createElement('span'); part.className = className; part.textContent = text; line.append(part);
    }
    target.append(line);
  }
  if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Nenhum evento disponível para este filtro.'; target.append(empty); }
  byId('log-count').textContent = `${filtered.length} eventos`;
  target.scrollTop = byId('follow').checked ? target.scrollHeight : scroll;
}
async function confirmAction(action) {
  const dialog = byId('confirm-dialog');
  byId('dialog-title').textContent = action === 'stop' ? 'Parar o TireFlow?' : 'Reiniciar o TireFlow?';
  byId('dialog-description').textContent = action === 'stop' ? 'O bot ficará indisponível até ser iniciado novamente. O painel continuará acessível.' : 'O atendimento pelo WhatsApp será interrompido durante o reinício. Aguarde a confirmação da conexão antes de retomar.';
  dialog.returnValue = '';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', async () => {
  const action = button.dataset.action;
  if (submitting) return;
  if (['stop', 'restart'].includes(action) && !await confirmAction(action)) return;
  submitting = true; updateButtons();
  notice('Operação em andamento. Aguarde o resultado.');
  try {
    if (!token) token = (await api('session')).token;
    const result = await api(action, { method: 'POST', headers: { 'content-type': 'application/json', 'x-control-token': token }, body: JSON.stringify({ confirmed: true }) });
    notice(result.message);
  } catch (error) { token = null; notice(error.message, true); }
  finally { submitting = false; await refresh(); updateButtons(); }
});
for (const button of document.querySelectorAll('[data-level]')) button.addEventListener('click', () => {
  level = button.dataset.level;
  for (const other of document.querySelectorAll('[data-level]')) { const active = other === button; other.classList.toggle('active', active); other.setAttribute('aria-pressed', String(active)); }
  renderLogs();
});
for (const link of document.querySelectorAll('nav a')) link.addEventListener('click', () => {
  for (const other of document.querySelectorAll('nav a')) other.classList.toggle('selected', other === link);
});
let refreshing = false;
byId('refresh-logs').addEventListener('click', () => { void refresh(); });
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const results = await Promise.all([api('status'), api('logs')]);
    showStatus(results[0]); logs = results[1]; renderLogs();
    byId('sync').textContent = `Atualizado às ${time(new Date())}`;
    byId('sync-dot').style.background = '';
  } catch {
    clearPairing();
    snapshot = null; updateButtons();
    badge('service-badge', unavailable, 'neutral'); badge('whatsapp-badge', unavailable, 'neutral');
    byId('service-description').textContent = 'A comunicação com o painel está indisponível.';
    byId('whatsapp-description').textContent = 'Sem informação atual do processo.';
    byId('uptime').textContent = unavailable;
    byId('sync').textContent = 'Painel sem resposta';
    byId('sync-dot').style.background = '#ff7d89';
  } finally { refreshing = false; }
}
void refresh();
void refreshPairing();
setInterval(() => { void refreshPairing(); }, 2000);
setInterval(() => { if (pairingExpiresAt && Date.now() >= pairingExpiresAt) clearPairing('waiting'); }, 500);
setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { clearPairing(); if (!document.hidden) { void refresh(); void refreshPairing(); } });
