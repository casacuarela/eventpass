/**
 * EventPass Antifraude - Cliente Principal
 * Control de acceso en tiempo real, emisión de boletos y scanner antifraude
 */

// Application State
let appState = {
  event: null,
  tickets: [],
  stats: {},
  activeTab: 'dashboard',
  html5QrCode: null,
  isScanning: false,
  currentCameraId: null,
  camerasList: [],
  audioEnabled: true,
  lastScannedCode: null,
  scanCooldown: false,
  recentScans: []
};

// ============================================================================
// 1. SONIDOS CON WEB AUDIO API (Cero dependencias externas, funciona offline)
// ============================================================================
class SoundEffects {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playSuccess() {
    if (!appState.audioEnabled) return;
    this.init();
    const now = this.ctx.currentTime;
    
    // Tono armónico ascendente (Éxito / Bienvenida)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';

    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.12); // G5
    osc1.frequency.exponentialRampToValueAtTime(1046.50, now + 0.25); // C6

    osc2.frequency.setValueAtTime(261.63, now); // C4
    osc2.frequency.exponentialRampToValueAtTime(523.25, now + 0.25);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.4);
    osc2.stop(now + 0.4);
  }

  playFraudAlert() {
    if (!appState.audioEnabled) return;
    this.init();
    const now = this.ctx.currentTime;

    // Tono de Sirena / Alarma de Fraude
    for (let i = 0; i < 2; i++) {
      const offset = i * 0.2;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(450, now + offset);
      osc.frequency.linearRampToValueAtTime(220, now + offset + 0.15);

      gain.gain.setValueAtTime(0.4, now + offset);
      gain.gain.linearRampToValueAtTime(0.01, now + offset + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    }
  }

  playWarning() {
    if (!appState.audioEnabled) return;
    this.init();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.setValueAtTime(200, now + 0.1);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  }
}

const sounds = new SoundEffects();

// ============================================================================
// 2. INICIALIZACIÓN Y NAVEGACIÓN
// ============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupEventListeners();
  await loadInitialData();
  setupSSE();
});

function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  appState.activeTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tabName}`);
  });

  // Manejo especial de la cámara si se entra o sale de la pestaña de Scanner
  if (tabName === 'scanner') {
    startCamera();
  } else {
    stopCamera();
  }
}

// ============================================================================
// 3. CARGA DE DATOS & SINCRONIZACIÓN EN TIEMPO REAL (SSE)
// ============================================================================
async function loadInitialData() {
  try {
    const res = await fetch('/api/tickets');
    const data = await res.json();
    appState.tickets = data.tickets || [];
    appState.stats = data.stats || {};
    appState.event = data.event || {};

    renderEventInfo();
    renderKPIs();
    renderAttendeesTable();
    populateTicketTypeSelect();
    populateSettingsForm();
  } catch (err) {
    console.error('Error al cargar datos:', err);
  }
}

function setupSSE() {
  const badge = document.getElementById('syncStatusBadge');
  try {
    const eventSource = new EventSource('/api/events/stream');

    eventSource.onopen = () => {
      badge.className = 'badge badge-used';
      badge.innerHTML = '<span style="font-size: 8px;">🟢</span> En Línea';
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleLiveEvent(payload);
      } catch (e) {
        console.error('Error parseando SSE:', e);
      }
    };

    eventSource.onerror = () => {
      badge.className = 'badge badge-valid';
      badge.innerHTML = '<span style="font-size: 8px;">🟠</span> Reconectando...';
    };
  } catch (e) {
    console.warn('SSE no disponible:', e);
  }
}

function handleLiveEvent({ type, data }) {
  if (type === 'TICKET_CREATED') {
    // Agregar ticket a la lista local si no existe
    const exists = appState.tickets.some(t => t.id === data.ticket.id);
    if (!exists) {
      appState.tickets.unshift(data.ticket);
    }
    if (data.stats) appState.stats = data.stats;
    renderKPIs();
    renderAttendeesTable();
  } else if (type === 'TICKET_SCANNED' || type === 'FRAUD_DETECTED' || type === 'TICKET_UPDATED') {
    // Actualizar el ticket en la lista
    const idx = appState.tickets.findIndex(t => t.id === data.ticket.id);
    if (idx !== -1) {
      appState.tickets[idx] = data.ticket;
    }
    if (data.stats) appState.stats = data.stats;
    renderKPIs();
    renderAttendeesTable();
  } else if (type === 'EVENT_UPDATED') {
    appState.event = data;
    renderEventInfo();
    populateTicketTypeSelect();
    populateSettingsForm();
  } else if (type === 'DATA_RESET') {
    loadInitialData();
  }
}

// ============================================================================
// 4. RENDERIZACIÓN DE LA INTERFAZ
// ============================================================================
function renderEventInfo() {
  const ev = appState.event;
  if (!ev) return;

  document.getElementById('heroEventName').textContent = ev.name || 'Mi Evento';
  document.getElementById('heroEventLocation').textContent = ev.location || 'Por definir';
  document.getElementById('heroEventCapacity').textContent = `${ev.capacity || 0} personas`;

  if (ev.date) {
    const d = new Date(ev.date);
    document.getElementById('heroEventDate').textContent = d.toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } else {
    document.getElementById('heroEventDate').textContent = 'Por definir';
  }
}

function renderKPIs() {
  const st = appState.stats;
  const currency = (appState.event && appState.event.currency) || '$';

  document.getElementById('kpiEntered').textContent = st.enteredCount || 0;
  document.getElementById('kpiPending').textContent = st.pendingCount || 0;
  document.getElementById('kpiTotal').textContent = st.totalIssued || 0;
  document.getElementById('kpiRevenue').textContent = `${currency}${(st.totalRevenue || 0).toLocaleString()}`;
  document.getElementById('kpiFraud').textContent = st.fraudAttempts || 0;
  document.getElementById('tabCount').textContent = st.totalIssued || 0;

  // Aforo
  const entered = st.enteredCount || 0;
  const capacity = st.capacity || 1;
  const percent = Math.min(100, Math.round((entered / capacity) * 100));

  document.getElementById('aforoPercentageText').textContent = `${percent}% (${entered} / ${capacity} personas)`;
  const fill = document.getElementById('aforoProgressFill');
  fill.style.width = `${percent}%`;

  if (percent >= 90) {
    fill.style.background = 'linear-gradient(90deg, #f59e0b 0%, #ef4444 100%)';
  } else {
    fill.style.background = 'linear-gradient(90deg, #10b981 0%, #6366f1 100%)';
  }
}

function populateTicketTypeSelect() {
  const select = document.getElementById('ticketTypeSelect');
  if (!select) return;
  select.innerHTML = '';
  const types = (appState.event && Array.isArray(appState.event.ticketTypes) && appState.event.ticketTypes.length > 0)
    ? appState.event.ticketTypes
    : [
        { id: 'general', name: 'General', price: 50 },
        { id: 'vip', name: 'VIP', price: 100 }
      ];

  const currency = (appState.event && appState.event.currency) || '$';

  types.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = t.name;
    opt.textContent = `${t.name} (${currency}${t.price})`;
    opt.dataset.price = t.price;
    if (i === 0) opt.selected = true;
    select.appendChild(opt);
  });

  // Actualizar precio por defecto en el input
  if (types.length > 0) {
    document.getElementById('ticketPrice').value = types[0].price;
  }
}

function renderAttendeesTable() {
  const tbody = document.getElementById('attendeesTableBody');
  const search = (document.getElementById('attendeesSearchInput').value || '').toLowerCase().trim();
  const filterStatus = document.getElementById('filterStatusSelect').value;
  const currency = (appState.event && appState.event.currency) || '$';

  let filtered = appState.tickets.filter(t => {
    // Filtro estado
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;

    // Búsqueda de texto
    if (!search) return true;
    return (
      t.attendeeName.toLowerCase().includes(search) ||
      t.id.toLowerCase().includes(search) ||
      (t.attendeeDni && t.attendeeDni.toLowerCase().includes(search)) ||
      (t.attendeePhone && t.attendeePhone.toLowerCase().includes(search))
    );
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          No se encontraron boletos que coincidan con los filtros.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    let statusBadge = '';
    if (t.status === 'valid') {
      statusBadge = '<span class="badge badge-valid">⏳ Por Ingresar</span>';
    } else if (t.status === 'used') {
      statusBadge = '<span class="badge badge-used">✅ Ingresado</span>';
    } else {
      statusBadge = '<span class="badge badge-cancelled">🛑 Cancelado</span>';
    }

    const typeBadge = t.type.toLowerCase().includes('vip') 
      ? `<span class="badge badge-vip">${t.type}</span>`
      : `<span style="font-weight: 600;">${t.type}</span>`;

    const ingresoHora = t.usedAt 
      ? new Date(t.usedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '-';

    const hasTransfers = t.transferHistory && t.transferHistory.length > 0;
    const transferBadge = hasTransfers 
      ? `<span class="badge badge-vip" style="font-size: 0.68rem; margin-left: 0.35rem;" title="Transferido previamente (${t.transferHistory.length} vez/veces)">🔄 Transferido</span>`
      : '';

    return `
      <tr>
        <td style="font-family: monospace; font-weight: 700; color: #38bdf8;">${t.id}</td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(t.attendeeName)}${transferBadge}</div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">${t.attendeePhone || t.attendeeDni || 'Sin datos adicionales'}</div>
        </td>
        <td>${typeBadge}</td>
        <td>${currency}${t.price}</td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${t.paymentMethod || 'Efectivo'}</td>
        <td>${statusBadge}</td>
        <td style="font-size: 0.85rem;">${ingresoHora}</td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 0.35rem;">
            <button class="btn btn-secondary btn-sm" onclick="openTicketModal('${t.id}')" title="Ver / Imprimir Boleto">
              🎟️ Ver
            </button>
            ${t.status === 'valid' ? `
              <button class="btn btn-secondary btn-sm" onclick="openTransferModal('${t.id}')" title="Transferir entrada a otra persona (regenera QR)">
                🔄 Transferir
              </button>
              <button class="btn btn-success btn-sm" onclick="manualValidate('${t.id}')" title="Marcar como ingresado">
                ✅ Marcar Entrada
              </button>
            ` : ''}
            ${t.status === 'used' ? `
              <button class="btn btn-secondary btn-sm" onclick="revertTicket('${t.id}')" title="Permitir reingreso">
                🔄 Reingreso
              </button>
            ` : ''}
            ${t.status !== 'cancelled' ? `
              <button class="btn btn-danger btn-sm" onclick="cancelTicket('${t.id}')" title="Cancelar entrada">
                ✕
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// ============================================================================
// 5. CÁMARA & CONTROL DE ACCESO ANTIFRAUDE (SCANNER)
// ============================================================================
async function startCamera() {
  if (appState.isScanning) return;
  const readerElement = document.getElementById('reader');
  if (!readerElement) return;

  try {
    if (!appState.html5QrCode) {
      appState.html5QrCode = new Html5Qrcode("reader");
    }

    // Obtener lista de cámaras
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      showActionAlertModal('📷', 'Cámara No Disponible', 'No se detectó ninguna cámara disponible en este dispositivo.');
      return;
    }

    appState.camerasList = cameras;

    // Preferir cámara trasera ('environment') en smartphones
    let selectedCamera = cameras[0].id;
    const backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('trasera') || c.label.toLowerCase().includes('environment'));
    if (backCam) {
      selectedCamera = backCam.id;
    }
    appState.currentCameraId = selectedCamera;

    const config = {
      fps: 15,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    await appState.html5QrCode.start(
      selectedCamera,
      config,
      onScanSuccess,
      onScanError
    );

    appState.isScanning = true;
    document.getElementById('scannerLaser').style.display = 'block';
  } catch (err) {
    console.error("Error al iniciar cámara:", err);
    // Mostrar instrucción amigable
    showActionAlertModal('📷', 'Permiso de Cámara Requerido', 'No se pudo acceder a la cámara o está en uso por otra app.<br><br>Puedes ingresar el folio o cédula en la <strong>casilla de validación manual</strong> abajo.');
  }
}

async function stopCamera() {
  if (appState.html5QrCode && appState.isScanning) {
    try {
      await appState.html5QrCode.stop();
      appState.isScanning = false;
      document.getElementById('scannerLaser').style.display = 'none';
    } catch (err) {
      console.warn("Error deteniendo cámara:", err);
    }
  }
}

async function switchCamera() {
  if (appState.camerasList.length <= 1) {
    showActionAlertModal('📷', 'Cámara Única', 'Solo hay una cámara detectada en este dispositivo.');
    return;
  }
  const currentIndex = appState.camerasList.findIndex(c => c.id === appState.currentCameraId);
  const nextIndex = (currentIndex + 1) % appState.camerasList.length;
  appState.currentCameraId = appState.camerasList[nextIndex].id;

  await stopCamera();
  try {
    await appState.html5QrCode.start(
      appState.currentCameraId,
      { fps: 15, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      onScanError
    );
    appState.isScanning = true;
    document.getElementById('scannerLaser').style.display = 'block';
  } catch (e) {
    console.error("Error alternando cámara:", e);
  }
}

// Cuando la cámara detecta un QR
function onScanSuccess(decodedText, decodedResult) {
  if (appState.scanCooldown) return;
  
  // Evitar re-escanear el mismo código en menos de 3 segundos
  if (appState.lastScannedCode === decodedText) {
    return;
  }

  appState.scanCooldown = true;
  appState.lastScannedCode = decodedText;

  // Enviar al servidor para validación antifraude
  processScanCode(decodedText);

  setTimeout(() => {
    appState.scanCooldown = false;
    appState.lastScannedCode = null;
  }, 3000);
}

function onScanError(errorMessage) {
  // Ignorar errores por frame mientras busca QR
}

// Proceso de Verificación Antifraude
async function processScanCode(code) {
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        gatekeeper: 'Portería Principal'
      })
    });

    const data = await res.json();
    displayScanResult(data);
    addRecentScanLog(data);
  } catch (err) {
    console.error("Error al validar código:", err);
    displayScanResult({
      status: 'invalid',
      title: 'ERROR DE CONEXIÓN',
      message: 'No se pudo comunicar con el servidor.',
      color: 'yellow'
    });
  }
}

function displayScanResult(data) {
  const card = document.getElementById('scanResultCard');
  const icon = document.getElementById('scanResultIcon');
  const title = document.getElementById('scanResultTitle');
  const desc = document.getElementById('scanResultDesc');
  const details = document.getElementById('scanResultDetails');

  // Haptic feedback en móviles
  if (navigator.vibrate) {
    if (data.status === 'success') {
      navigator.vibrate([100]);
    } else if (data.status === 'fraud_already_used') {
      navigator.vibrate([200, 100, 200, 100, 300]);
    } else {
      navigator.vibrate([150, 100, 150]);
    }
  }

  card.className = 'scan-result-card';

  if (data.status === 'success') {
    sounds.playSuccess();
    card.classList.add('success');
    icon.textContent = '✅';
    title.textContent = 'ACCESO PERMITIDO';
    desc.textContent = data.message;
    details.style.display = 'grid';

    document.getElementById('resName').textContent = data.ticket.attendeeName;
    document.getElementById('resType').textContent = data.ticket.type;
    document.getElementById('resId').textContent = data.ticket.id;
    document.getElementById('resTime').textContent = new Date().toLocaleTimeString();

  } else if (data.status === 'fraud_already_used') {
    sounds.playFraudAlert();
    card.classList.add('danger');
    icon.textContent = '🛑';
    title.textContent = '¡ALERTA! BOLETO YA UTILIZADO';
    desc.textContent = data.message;
    details.style.display = 'grid';

    document.getElementById('resName').textContent = data.ticket.attendeeName;
    document.getElementById('resType').textContent = `REINTENTO #${data.scanCount}`;
    document.getElementById('resId').textContent = data.ticket.id;
    document.getElementById('resTime').textContent = `Primer uso: ${new Date(data.firstUsedAt).toLocaleTimeString()}`;

  } else if (data.status === 'fraud_transferred_old_code') {
    sounds.playFraudAlert();
    card.classList.add('danger');
    icon.textContent = '🛑';
    title.textContent = '¡ALERTA! BOLETO TRANSFERIDO';
    desc.textContent = data.message;
    details.style.display = 'grid';

    document.getElementById('resName').textContent = `Nuevo titular: ${data.ticket.attendeeName}`;
    document.getElementById('resType').textContent = `CÓDIGO ANTERIOR INVALIDADO`;
    document.getElementById('resId').textContent = data.ticket.id;
    document.getElementById('resTime').textContent = `Transferido el ${new Date(data.transferInfo.transferredAt).toLocaleTimeString()}`;

  } else if (data.status === 'cancelled') {
    sounds.playWarning();
    card.classList.add('danger');
    icon.textContent = '❌';
    title.textContent = 'BOLETO CANCELADO';
    desc.textContent = data.message;
    details.style.display = 'none';

  } else {
    // Invalid / Falsified
    sounds.playWarning();
    card.classList.add('warning');
    icon.textContent = '⚠️';
    title.textContent = 'CÓDIGO NO VÁLIDO O FALSIFICADO';
    desc.textContent = data.message;
    details.style.display = 'none';
  }

  // Scroll a la tarjeta de resultado en móvil
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function addRecentScanLog(data) {
  const container = document.getElementById('recentScansList');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  let badgeHtml = '';
  let nameText = data.ticket ? data.ticket.attendeeName : (data.code || 'Código desconocido');

  if (data.status === 'success') {
    badgeHtml = '<span class="badge badge-used">Acceso OK</span>';
  } else if (data.status === 'fraud_already_used') {
    badgeHtml = '<span class="badge badge-cancelled">FRAUDE (Ya usado)</span>';
  } else if (data.status === 'fraud_transferred_old_code') {
    badgeHtml = '<span class="badge badge-cancelled">FRAUDE (Código Transferido)</span>';
  } else {
    badgeHtml = '<span class="badge badge-valid">Inválido</span>';
  }

  const logRow = document.createElement('div');
  logRow.style.cssText = 'background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;';
  logRow.innerHTML = `
    <div>
      <strong>${escapeHtml(nameText)}</strong>
      <span style="color: var(--text-muted); margin-left: 0.5rem;">${time}</span>
    </div>
    <div>${badgeHtml}</div>
  `;

  if (container.firstElementChild && container.firstElementChild.textContent.includes('Aún no hay escaneos')) {
    container.innerHTML = '';
  }

  container.insertBefore(logRow, container.firstChild);

  // Mantener solo los últimos 8 registros
  while (container.children.length > 8) {
    container.removeChild(container.lastChild);
  }
}

// ============================================================================
// 6. EMISIÓN DE BOLETOS & MODAL DIGITAL PREVIEW
// ============================================================================
function setupEventListeners() {
  // Cambio en selector de tipo de boleto actualiza precio automáticamente
  document.getElementById('ticketTypeSelect').addEventListener('change', (e) => {
    const selected = e.target.options[e.target.selectedIndex];
    if (selected && selected.dataset.price !== undefined) {
      document.getElementById('ticketPrice').value = selected.dataset.price;
    }
  });

  // Formulario de emisión de boleto
  document.getElementById('sellTicketForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('attendeeName').value;
    const phone = document.getElementById('attendeePhone').value;
    const dni = document.getElementById('attendeeDni').value;
    const type = document.getElementById('ticketTypeSelect').value;
    const price = document.getElementById('ticketPrice').value;
    const paymentMethod = document.getElementById('paymentMethod').value;
    const notes = document.getElementById('ticketNotes').value;

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendeeName: name,
          attendeePhone: phone,
          attendeeDni: dni,
          type: type,
          price: price,
          paymentMethod: paymentMethod,
          notes: notes
        })
      });

      const data = await res.json();
      if (data.success) {
        sounds.playSuccess();
        // Reset form
        document.getElementById('attendeeName').value = '';
        document.getElementById('attendeePhone').value = '';
        document.getElementById('attendeeDni').value = '';
        document.getElementById('ticketNotes').value = '';

        // Abrir de inmediato el boleto generado
        openTicketModal(data.ticket.id);
      } else {
        showActionAlertModal('⚠️', 'Error al Emitir Boleto', data.error || 'Error al emitir el boleto.');
      }
    } catch (err) {
      console.error(err);
      showActionAlertModal('🛑', 'Error de Conexión', 'No se pudo comunicar con el servidor para emitir el boleto.');
    }
  });

  // Formulario manual de scanner
  document.getElementById('manualScanForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('manualTicketCode');
    const code = input.value.trim();
    if (code) {
      processScanCode(code);
      input.value = '';
    }
  });

  // Botón ocultar resultado para continuar (abajo y arriba)
  document.getElementById('btnDismissResult').addEventListener('click', () => {
    document.getElementById('scanResultCard').style.display = 'none';
  });
  const btnDismissResultTop = document.getElementById('btnDismissResultTop');
  if (btnDismissResultTop) {
    btnDismissResultTop.addEventListener('click', () => {
      document.getElementById('scanResultCard').style.display = 'none';
    });
  }

  // Controles de cámara
  document.getElementById('btnToggleCamera').addEventListener('click', () => {
    if (appState.isScanning) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  document.getElementById('btnSwitchCamera').addEventListener('click', switchCamera);

  // Toggle sonido
  document.getElementById('btnToggleAudio').addEventListener('click', () => {
    appState.audioEnabled = !appState.audioEnabled;
    document.getElementById('audioIcon').textContent = appState.audioEnabled ? '🔊' : '🔇';
    document.getElementById('btnToggleAudio').querySelector('span:last-child').textContent = appState.audioEnabled ? ' Sonido Activado' : ' Sonido Silenciado';
  });

  // Filtros de búsqueda en tabla
  document.getElementById('attendeesSearchInput').addEventListener('input', renderAttendeesTable);
  document.getElementById('filterStatusSelect').addEventListener('change', renderAttendeesTable);

  // Cambio dinámico de símbolo de moneda en el editor de tipos de entrada
  document.getElementById('setEventCurrency').addEventListener('input', () => {
    renderTicketTypesEditor();
  });

  // Botón para agregar nuevo tipo de entrada
  const btnAddTicketType = document.getElementById('btnAddTicketType');
  if (btnAddTicketType) {
    btnAddTicketType.addEventListener('click', () => {
      const count = editingTicketTypes.length + 1;
      editingTicketTypes.push({
        id: `tipo-${Date.now()}`,
        name: `Tipo ${count}`,
        price: 50
      });
      renderTicketTypesEditor();
      // Enfocar el nuevo campo de nombre creado
      setTimeout(() => {
        const inputs = document.querySelectorAll('.ticket-type-name-input');
        if (inputs.length > 0) inputs[inputs.length - 1].focus();
      }, 50);
    });
  }

  // Formulario de ajustes de evento
  document.getElementById('eventSettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validar y recopilar tipos de entrada configurados
    const validTypes = editingTicketTypes.map((t, idx) => ({
      id: (t.id || t.name || `tipo-${idx + 1}`).toLowerCase().replace(/[^a-z0-9]/gi, '-') || `tipo-${idx + 1}`,
      name: (t.name || '').trim(),
      price: Math.max(0, Number(t.price) || 0)
    })).filter(t => t.name.length > 0);

    if (validTypes.length === 0) {
      alert("Debes tener configurado al menos un tipo de entrada con nombre.");
      return;
    }

    const updated = {
      name: document.getElementById('setEventName').value.trim(),
      subtitle: document.getElementById('setEventSubtitle').value.trim(),
      date: document.getElementById('setEventDate').value,
      location: document.getElementById('setEventLocation').value.trim(),
      capacity: parseInt(document.getElementById('setEventCapacity').value, 10) || 100,
      currency: document.getElementById('setEventCurrency').value.trim() || '$',
      ticketTypes: validTypes
    };

    try {
      const res = await fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const data = await res.json();
      if (data.success) {
        appState.event = data.event;
        renderEventInfo();
        populateTicketTypeSelect();
        showActionAlertModal('💾', 'Configuración Guardada', '¡La configuración del evento y los tipos de entrada han sido guardados con éxito!');
        switchTab('dashboard');
      } else {
        showActionAlertModal('⚠️', 'Error al Guardar', data.error || 'Error al guardar la configuración.');
      }
    } catch (err) {
      console.error(err);
      showActionAlertModal('🛑', 'Error de Conexión', 'No se pudo comunicar con el servidor para guardar la configuración.');
    }
  });

  // ================= MODAL DE BOLETO: CERRAR =================
  document.getElementById('modalCloseBtn').addEventListener('click', closeTicketModal);
  const modalBottomCloseBtn = document.getElementById('modalBottomCloseBtn');
  if (modalBottomCloseBtn) {
    modalBottomCloseBtn.addEventListener('click', closeTicketModal);
  }
  const ticketModalBackdropCloseBtn = document.getElementById('ticketModalBackdropCloseBtn');
  if (ticketModalBackdropCloseBtn) {
    ticketModalBackdropCloseBtn.addEventListener('click', closeTicketModal);
  }
  document.getElementById('ticketModal').addEventListener('click', (e) => {
    if (e.target.id === 'ticketModal') closeTicketModal();
  });

  // ================= MODAL DE TRANSFERENCIA: CERRAR =================
  document.getElementById('transferModalCloseBtn').addEventListener('click', closeTransferModal);
  document.getElementById('btnCancelTransfer').addEventListener('click', closeTransferModal);
  const transferModalBackdropCloseBtn = document.getElementById('transferModalBackdropCloseBtn');
  if (transferModalBackdropCloseBtn) {
    transferModalBackdropCloseBtn.addEventListener('click', closeTransferModal);
  }
  document.getElementById('transferModal').addEventListener('click', (e) => {
    if (e.target.id === 'transferModal') closeTransferModal();
  });

  // ================= MODAL DE ACCIÓN / CONFIRMACIÓN UNIVERSAL: CERRAR Y ACEPTAR =================
  document.getElementById('actionModalCloseBtn').addEventListener('click', closeActionConfirmModal);
  document.getElementById('actionModalBtnCancel').addEventListener('click', closeActionConfirmModal);
  const actionModalBackdropCloseBtn = document.getElementById('actionModalBackdropCloseBtn');
  if (actionModalBackdropCloseBtn) {
    actionModalBackdropCloseBtn.addEventListener('click', closeActionConfirmModal);
  }
  document.getElementById('actionConfirmModal').addEventListener('click', (e) => {
    if (e.target.id === 'actionConfirmModal') closeActionConfirmModal();
  });
  document.getElementById('actionModalBtnConfirm').addEventListener('click', () => {
    if (typeof currentActionConfirmCallback === 'function') {
      const inputVal = document.getElementById('actionModalInput').value;
      currentActionConfirmCallback(inputVal);
    }
  });

  // Botones de exportación y demo
  document.getElementById('btnExportCsv').addEventListener('click', () => {
    window.location.href = '/api/export/csv';
  });

  document.getElementById('btnLoadDemo').addEventListener('click', () => {
    showActionConfirmModal({
      icon: '⚡',
      category: 'Simulación de Demostración',
      title: 'Cargar Boletos de Prueba',
      message: '¿Deseas agregar 5 boletos de prueba variados para simular ventas y escaneo en vivo en el evento?',
      confirmText: '⚡ Cargar 5 Boletos',
      confirmClass: 'btn-primary',
      onConfirm: async () => {
        closeActionConfirmModal();
        await fetch('/api/demo-data', { method: 'POST' });
        await loadInitialData();
        showActionAlertModal('✅', 'Demostración Cargada', 'Se han generado 5 boletos de prueba con códigos QR válidos listos para probar.');
      }
    });
  });

  document.getElementById('btnClearTickets').addEventListener('click', () => {
    showActionConfirmModal({
      icon: '🗑️',
      category: 'Restablecer Base de Datos',
      title: '¿Vaciar Base de Boletos?',
      message: '<span style="color: #fca5a5;">⚠️ <strong>ADVERTENCIA:</strong></span> Esta acción eliminará permanentemente todos los boletos registrados para comenzar de cero.',
      confirmText: '🗑️ Sí, Vaciar Base',
      confirmClass: 'btn-danger',
      onConfirm: async () => {
        closeActionConfirmModal();
        await fetch('/api/clear-tickets', { method: 'POST' });
        await loadInitialData();
        showActionAlertModal('✅', 'Base Vacía', 'Se han eliminado todos los boletos registrados. El sistema está limpio.');
      }
    });
  });

  // Acciones dentro del modal
  document.getElementById('btnPrintTicket').addEventListener('click', () => {
    printCleanTicket('printableTicketCard');
  });

  document.getElementById('btnCopyTicketLink').addEventListener('click', () => {
    const ticketId = document.getElementById('modalTicketId').textContent;
    const url = `${window.location.origin}/ticket.html?id=${ticketId}`;
    navigator.clipboard.writeText(url).then(() => {
      showActionAlertModal('🔗', 'Enlace Copiado', `El enlace público del boleto (<strong>${escapeHtml(ticketId)}</strong>) ha sido copiado al portapapeles.`);
    });
  });

  document.getElementById('btnShareWhatsApp').addEventListener('click', () => {
    const ticketId = document.getElementById('modalTicketId').textContent;
    const attendee = document.getElementById('modalAttendeeName').textContent;
    const eventName = document.getElementById('modalEventName').textContent;
    const phone = document.getElementById('modalAttendeeName').dataset.phone || '';
    const url = `${window.location.origin}/ticket.html?id=${ticketId}`;

    const text = `¡Hola ${attendee}! 🎉 Aquí está tu entrada oficial para *${eventName}*.\n\n🎟️ Folio: ${ticketId}\n📲 Abre tu boleto aquí con tu código QR de acceso:\n${url}\n\nPresenta tu código QR en la entrada directamente desde tu celular. ¡Te esperamos!`;
    
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    let waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    if (cleanPhone) {
      waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
    }
    window.open(waUrl, '_blank');
  });

  // Cerrar cualquier ventana emergente o volver al Dashboard con la tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const anyModalOpen = document.querySelector('.modal-backdrop.open');
      if (anyModalOpen) {
        closeAllModals();
      } else if (appState.activeTab !== 'dashboard') {
        switchTab('dashboard');
      }
    }
  });

  document.getElementById('transferTicketForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ticketId = document.getElementById('transferTargetId').value;
    const newName = document.getElementById('newAttendeeName').value.trim();
    const newPhone = document.getElementById('newAttendeePhone').value.trim();
    const newDni = document.getElementById('newAttendeeDni').value.trim();
    const reason = document.getElementById('transferReason').value.trim();

    if (!newName) {
      showActionAlertModal('⚠️', 'Nombre Requerido', 'Debes indicar el nombre completo del nuevo titular.');
      return;
    }

    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newAttendeeName: newName,
          newAttendeePhone: newPhone,
          newAttendeeDni: newDni,
          reason: reason
        })
      });

      const data = await res.json();
      if (data.success) {
        sounds.playSuccess();
        closeTransferModal();
        showActionAlertModal('🔄', 'Transferencia Exitosa', `¡Boleto transferido con éxito a <strong>${escapeHtml(newName)}</strong>!<br><br>El código QR anterior ha sido invalidado permanentemente.`);
        
        // Abrir de inmediato el nuevo boleto para poder compartirlo por WhatsApp
        setTimeout(() => {
          openTicketModal(data.ticket.id);
        }, 1200);
      } else {
        showActionAlertModal('⚠️', 'Error al Transferir', data.error || "Error al transferir el boleto.");
      }
    } catch (err) {
      console.error(err);
      showActionAlertModal('🛑', 'Error de Conexión', "Error de conexión al procesar la transferencia.");
    }
  });
}

function openTransferModal(ticketId) {
  const ticket = appState.tickets.find(t => t.id === ticketId);
  if (!ticket) return;

  if (ticket.status !== 'valid') {
    showActionAlertModal('⚠️', 'Boleto No Transferible', 'Solo se pueden transferir boletos que aún no hayan ingresado al evento.');
    return;
  }

  document.getElementById('transferTargetId').value = ticket.id;
  document.getElementById('transferTicketId').textContent = ticket.id;
  document.getElementById('transferCurrentOwner').textContent = ticket.attendeeName;
  document.getElementById('newAttendeeName').value = '';
  document.getElementById('newAttendeePhone').value = '';
  document.getElementById('newAttendeeDni').value = '';
  document.getElementById('transferReason').value = '';

  document.getElementById('transferModal').classList.add('open');
}

function closeTransferModal() {
  document.getElementById('transferModal').classList.remove('open');
}

// Estado local de edición de tipos de entrada
let editingTicketTypes = [];

function populateSettingsForm() {
  const ev = appState.event;
  if (!ev) return;
  document.getElementById('setEventName').value = ev.name || '';
  document.getElementById('setEventSubtitle').value = ev.subtitle || '';
  document.getElementById('setEventDate').value = ev.date ? ev.date.substring(0, 16) : '';
  document.getElementById('setEventLocation').value = ev.location || '';
  document.getElementById('setEventCapacity').value = ev.capacity || 300;
  document.getElementById('setEventCurrency').value = ev.currency || '$';

  // Copiar tipos de entrada actuales para edición
  if (Array.isArray(ev.ticketTypes) && ev.ticketTypes.length > 0) {
    editingTicketTypes = JSON.parse(JSON.stringify(ev.ticketTypes));
  } else {
    editingTicketTypes = [
      { id: 'general', name: 'General', price: 50 },
      { id: 'vip', name: 'VIP', price: 100 },
      { id: 'preventa', name: 'Preventa', price: 35 },
      { id: 'cortesia', name: 'Cortesía', price: 0 }
    ];
  }

  renderTicketTypesEditor();
}

function renderTicketTypesEditor() {
  const container = document.getElementById('ticketTypesContainer');
  if (!container) return;
  const currency = document.getElementById('setEventCurrency').value || '$';

  container.innerHTML = '';

  editingTicketTypes.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'ticket-type-row';

    row.innerHTML = `
      <div class="ticket-type-name-box">
        <label>Tipo de Entrada</label>
        <input type="text" class="ticket-type-name-input" data-index="${index}" value="${item.name || ''}" placeholder="Ej: General, VIP, Preventa" required>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: flex-end; flex: 1.5;">
        <div class="ticket-type-price-box" style="flex: 1;">
          <label>Valor / Precio</label>
          <div class="ticket-type-price-input-wrapper">
            <span class="ticket-type-currency-symbol">${currency}</span>
            <input type="number" class="ticket-type-price-input" data-index="${index}" min="0" step="any" value="${item.price !== undefined ? item.price : 0}" required>
          </div>
        </div>
        <button type="button" class="btn-remove-type" data-index="${index}" title="Eliminar este tipo de entrada" ${editingTicketTypes.length <= 1 ? 'disabled' : ''}>
          🗑️
        </button>
      </div>
    `;

    const nameInput = row.querySelector('.ticket-type-name-input');
    nameInput.addEventListener('input', (e) => {
      editingTicketTypes[index].name = e.target.value;
      if (!editingTicketTypes[index].id) {
        editingTicketTypes[index].id = e.target.value.toLowerCase().replace(/[^a-z0-9]/gi, '-');
      }
    });

    const priceInput = row.querySelector('.ticket-type-price-input');
    priceInput.addEventListener('input', (e) => {
      editingTicketTypes[index].price = Math.max(0, Number(e.target.value) || 0);
    });

    const deleteBtn = row.querySelector('.btn-remove-type');
    deleteBtn.addEventListener('click', () => {
      if (editingTicketTypes.length <= 1) return;
      editingTicketTypes.splice(index, 1);
      renderTicketTypesEditor();
    });

    container.appendChild(row);
  });
}

// Modal Boleto
function openTicketModal(ticketId) {
  const ticket = appState.tickets.find(t => t.id === ticketId);
  if (!ticket) return;

  const ev = appState.event || {};
  const currency = ev.currency || '$';

  document.getElementById('modalTicketBadge').textContent = `ENTRADA ${ticket.type.toUpperCase()}`;
  document.getElementById('modalEventName').textContent = ev.name || 'Mi Evento';
  document.getElementById('modalEventDateLoc').textContent = `${ev.date ? new Date(ev.date).toLocaleDateString([], { dateStyle: 'medium' }) : 'Fecha por confirmar'} • ${ev.location || 'Lugar por definir'}`;

  document.getElementById('modalAttendeeName').textContent = ticket.attendeeName;
  document.getElementById('modalAttendeeName').dataset.phone = ticket.attendeePhone || '';
  document.getElementById('modalAttendeeDni').textContent = ticket.attendeeDni || 'N/A';
  document.getElementById('modalTicketPrice').textContent = `${currency}${ticket.price}`;
  document.getElementById('modalTicketStatus').textContent = ticket.status === 'valid' ? 'VÁLIDO' : (ticket.status === 'used' ? 'INGRESADO' : 'CANCELADO');

  document.getElementById('modalTicketId').textContent = ticket.id;
  document.getElementById('modalQrImage').src = ticket.qrDataUrl;

  document.getElementById('ticketModal').classList.add('open');
}

function closeTicketModal() {
  document.getElementById('ticketModal').classList.remove('open');
}

// ============================================================================
// 7. SISTEMA UNIVERSAL DE VENTANAS EMERGENTES (MODALES CON BOTÓN DE CERRAR)
// ============================================================================
let currentActionConfirmCallback = null;

function showActionConfirmModal({
  icon = '❓',
  category = 'Confirmación',
  title = '¿Confirmar Acción?',
  message = '',
  showInput = false,
  inputLabel = 'Motivo:',
  inputValue = '',
  confirmText = '✓ Confirmar',
  confirmClass = 'btn-primary',
  onConfirm = null
}) {
  document.getElementById('actionModalIcon').textContent = icon;
  document.getElementById('actionModalCategory').innerHTML = `<span>${icon}</span> ${category}`;
  document.getElementById('actionModalTitle').textContent = title;
  document.getElementById('actionModalMessage').innerHTML = message;

  const inputWrap = document.getElementById('actionModalInputWrap');
  const inputEl = document.getElementById('actionModalInput');
  const inputLabelEl = document.getElementById('actionModalInputLabel');

  if (showInput) {
    inputWrap.style.display = 'block';
    inputLabelEl.textContent = inputLabel;
    inputEl.value = inputValue || '';
  } else {
    inputWrap.style.display = 'none';
  }

  const confirmBtn = document.getElementById('actionModalBtnConfirm');
  confirmBtn.textContent = confirmText;
  confirmBtn.className = `btn ${confirmClass}`;
  confirmBtn.style.display = 'inline-flex';

  const cancelBtn = document.getElementById('actionModalBtnCancel');
  cancelBtn.textContent = '✕ Cerrar';

  currentActionConfirmCallback = onConfirm;

  document.getElementById('actionConfirmModal').classList.add('open');

  if (showInput) {
    setTimeout(() => inputEl.focus(), 80);
  }
}

function showActionAlertModal(icon = 'ℹ️', title = 'Notificación', message = '') {
  document.getElementById('actionModalIcon').textContent = icon;
  document.getElementById('actionModalCategory').innerHTML = `<span>${icon}</span> Mensaje del Sistema`;
  document.getElementById('actionModalTitle').textContent = title;
  document.getElementById('actionModalMessage').innerHTML = message;
  document.getElementById('actionModalInputWrap').style.display = 'none';

  const confirmBtn = document.getElementById('actionModalBtnConfirm');
  confirmBtn.style.display = 'none';

  const cancelBtn = document.getElementById('actionModalBtnCancel');
  cancelBtn.textContent = '✕ Cerrar Ventana';

  currentActionConfirmCallback = null;
  document.getElementById('actionConfirmModal').classList.add('open');
}

function closeActionConfirmModal() {
  document.getElementById('actionConfirmModal').classList.remove('open');
  currentActionConfirmCallback = null;
}

function closeAllModals() {
  closeTicketModal();
  closeTransferModal();
  closeActionConfirmModal();
  const resultCard = document.getElementById('scanResultCard');
  if (resultCard) resultCard.style.display = 'none';
}

// Acciones sobre boletos desde la tabla (Cada una con su ventana emergente con botón de cerrar)
function manualValidate(ticketId) {
  showActionConfirmModal({
    icon: '✅',
    category: 'Control de Puerta',
    title: 'Marcar Entrada Manual',
    message: `¿Deseas registrar y autorizar el ingreso manual para el boleto con folio <strong style="font-family: monospace; color: #38bdf8;">${escapeHtml(ticketId)}</strong>?`,
    confirmText: '✅ Registrar Entrada',
    confirmClass: 'btn-success',
    onConfirm: () => {
      closeActionConfirmModal();
      processScanCode(ticketId);
    }
  });
}

function revertTicket(ticketId) {
  showActionConfirmModal({
    icon: '🔄',
    category: 'Reingreso Autorizado',
    title: 'Autorizar Reingreso',
    message: `Permitir que el titular del boleto <strong style="font-family: monospace; color: #38bdf8;">${escapeHtml(ticketId)}</strong> vuelva a ingresar al recinto.`,
    showInput: true,
    inputLabel: 'Indica el motivo de reingreso o reinicio:',
    inputValue: 'Salida momentánea del recinto',
    confirmText: '🔄 Autorizar Reingreso',
    confirmClass: 'btn-primary',
    onConfirm: async (reasonVal) => {
      closeActionConfirmModal();
      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/revert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reasonVal || 'Reingreso autorizado' })
        });
        const data = await res.json();
        if (data.success) {
          showActionAlertModal('✅', 'Reingreso Autorizado', `El boleto <strong>${escapeHtml(ticketId)}</strong> ha sido restablecido como VÁLIDO.`);
        } else {
          showActionAlertModal('⚠️', 'Error', data.error || 'Error al restablecer boleto.');
        }
      } catch (e) {
        showActionAlertModal('🛑', 'Error', 'Error de conexión al restablecer boleto.');
      }
    }
  });
}

function cancelTicket(ticketId) {
  showActionConfirmModal({
    icon: '🛑',
    category: 'Anulación de Entrada',
    title: '¿Cancelar este Boleto?',
    message: `¿Estás seguro de que deseas <strong>CANCELAR</strong> el boleto <strong style="font-family: monospace; color: #f87171;">${escapeHtml(ticketId)}</strong>?<br><br><span style="color: #fca5a5; font-size: 0.88rem;">Esta acción invalidará permanentemente su código QR y no permitirá su ingreso al recinto.</span>`,
    confirmText: '🛑 Sí, Cancelar Entrada',
    confirmClass: 'btn-danger',
    onConfirm: async () => {
      closeActionConfirmModal();
      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/cancel`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showActionAlertModal('✅', 'Boleto Cancelado', `El boleto <strong>${escapeHtml(ticketId)}</strong> ha sido cancelado e invalidado.`);
        } else {
          showActionAlertModal('⚠️', 'Error', data.error || 'Error cancelando boleto.');
        }
      } catch (e) {
        showActionAlertModal('🛑', 'Error', 'Error de conexión al cancelar boleto.');
      }
    }
  });
}

function printCleanTicket(elementId = 'printableTicketCard') {
  const card = document.getElementById(elementId);
  if (!card) {
    window.print();
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Imprimir Boleto - EventPass</title>
      <style>
        @page { size: auto; margin: 6mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          background: #ffffff;
          color: #000000;
          padding: 10px;
          display: flex;
          justify-content: center;
        }
        .digital-ticket-card {
          width: 330px;
          max-width: 100%;
          border: 2px solid #000000;
          border-radius: 12px;
          overflow: hidden;
          background: #ffffff;
          color: #000000;
          padding: 0;
        }
        .ticket-hologram { display: none; }
        .ticket-body { padding: 16px 18px 14px; }
        .ticket-type-tag {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #000000;
          border-bottom: 2px solid #000000;
          display: inline-block;
          padding-bottom: 2px;
          margin-bottom: 8px;
        }
        .ticket-event-name {
          font-size: 19px;
          font-weight: 800;
          color: #000000;
          margin-bottom: 4px;
          line-height: 1.2;
        }
        #modalEventDateLoc, #eventDatePlace {
          font-size: 11px;
          color: #374151;
          margin-bottom: 12px;
          line-height: 1.3;
        }
        .ticket-grid-details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px 12px;
          margin-bottom: 12px;
        }
        .ticket-detail-item .label {
          font-size: 9px;
          color: #4b5563;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .ticket-detail-item .value {
          font-size: 13px;
          font-weight: 700;
          color: #000000;
          word-break: break-word;
        }
        .ticket-divider {
          border-top: 1.5px dashed #000000;
          margin: 8px 0 12px;
        }
        .ticket-divider::before, .ticket-divider::after { display: none; }
        .ticket-qr-section {
          padding: 0 16px 16px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .ticket-qr-img {
          width: 180px;
          height: 180px;
          display: block;
          margin: 0 auto 8px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 4px;
          background: #ffffff;
        }
        .ticket-code-badge {
          color: #000000;
          background: #f3f4f6;
          border: 1.5px solid #000000;
          font-family: monospace;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 2px;
          padding: 3px 10px;
          border-radius: 4px;
          margin-bottom: 6px;
          display: inline-block;
        }
        .ticket-warning-pill {
          font-size: 9px;
          color: #4b5563;
          text-align: center;
          line-height: 1.3;
          max-width: 250px;
          margin: 0 auto;
        }
      </style>
    </head>
    <body>
      <div class="digital-ticket-card">
        ${card.innerHTML}
      </div>
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.focus();
            window.print();
            setTimeout(function() {
              window.parent.document.body.removeChild(window.frameElement);
            }, 1500);
          }, 250);
        };
      <\/script>
    </body>
    </html>
  `);
  doc.close();
}

