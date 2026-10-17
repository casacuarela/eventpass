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
  userRole: null, // 'gatekeeper', 'seller' or 'admin'
  sellerName: 'Taquilla 1',
  posCart: {},
  posPaymentMethod: 'Efectivo',
  posBuyerType: 'bearer',
  posCashReceived: 0,
  lastSoldTickets: [],
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
// 2. SISTEMA DE AUTENTICACIÓN Y ESPACIOS SEPARADOS (PORTERO, VENDEDOR Y ADMIN)
// ============================================================================
function initAuth() {
  const savedRole = sessionStorage.getItem('eventpass_role');
  if (savedRole === 'gatekeeper' || savedRole === 'seller' || savedRole === 'admin') {
    applyRole(savedRole);
  } else {
    showAuthOverlay();
  }
}

function showAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    selectAuthRole('gatekeeper');
  }
}

function hideAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

function selectAuthRole(role) {
  const tabGate = document.getElementById('tabRoleGatekeeper');
  const tabSeller = document.getElementById('tabRoleSeller');
  const tabAdmin = document.getElementById('tabRoleAdmin');
  const formGate = document.getElementById('formGatekeeperAuth');
  const formSeller = document.getElementById('formSellerAuth');
  const formAdmin = document.getElementById('formAdminAuth');

  if (tabGate) tabGate.classList.toggle('active', role === 'gatekeeper');
  if (tabSeller) tabSeller.classList.toggle('active', role === 'seller');
  if (tabAdmin) tabAdmin.classList.toggle('active', role === 'admin');

  if (formGate) formGate.style.display = role === 'gatekeeper' ? 'block' : 'none';
  if (formSeller) formSeller.style.display = role === 'seller' ? 'block' : 'none';
  if (formAdmin) formAdmin.style.display = role === 'admin' ? 'block' : 'none';

  if (role === 'gatekeeper') {
    const errEl = document.getElementById('gatekeeperErrorMsg');
    if (errEl) errEl.textContent = '';
    const pinInp = document.getElementById('gatekeeperPinInput');
    if (pinInp) {
      pinInp.value = '';
      pinInp.focus();
    }
  } else if (role === 'seller') {
    const errEl = document.getElementById('sellerErrorMsg');
    if (errEl) errEl.textContent = '';
    const pinInp = document.getElementById('sellerPinInput');
    if (pinInp) {
      pinInp.value = '';
      pinInp.focus();
    }
  } else {
    const errEl = document.getElementById('adminErrorMsg');
    if (errEl) errEl.textContent = '';
    const passInp = document.getElementById('adminPasswordInput');
    if (passInp) {
      passInp.value = '';
      passInp.focus();
    }
  }
}

function appendPinDigit(digit) {
  const pinInput = document.getElementById('gatekeeperPinInput');
  if (pinInput && pinInput.value.length < 4) {
    pinInput.value += digit;
    if (pinInput.value.length === 4) {
      submitGatekeeperAuth();
    }
  }
}

function clearPinDigits() {
  const pinInput = document.getElementById('gatekeeperPinInput');
  if (pinInput) pinInput.value = '';
  const errEl = document.getElementById('gatekeeperErrorMsg');
  if (errEl) errEl.textContent = '';
}

function deletePinDigit() {
  const pinInput = document.getElementById('gatekeeperPinInput');
  if (pinInput && pinInput.value.length > 0) {
    pinInput.value = pinInput.value.slice(0, -1);
  }
}

function appendSellerPinDigit(digit) {
  const pinInput = document.getElementById('sellerPinInput');
  if (pinInput && pinInput.value.length < 4) {
    pinInput.value += digit;
    if (pinInput.value.length === 4) {
      submitSellerAuth();
    }
  }
}

function clearSellerPinDigits() {
  const pinInput = document.getElementById('sellerPinInput');
  if (pinInput) pinInput.value = '';
  const errEl = document.getElementById('sellerErrorMsg');
  if (errEl) errEl.textContent = '';
}

function deleteSellerPinDigit() {
  const pinInput = document.getElementById('sellerPinInput');
  if (pinInput && pinInput.value.length > 0) {
    pinInput.value = pinInput.value.slice(0, -1);
  }
}

async function submitGatekeeperAuth() {
  const pinInput = document.getElementById('gatekeeperPinInput');
  const errorEl = document.getElementById('gatekeeperErrorMsg');
  const pin = (pinInput ? pinInput.value : '').trim();

  if (pin.length !== 4) {
    if (errorEl) errorEl.textContent = 'El PIN debe tener 4 cifras numéricas.';
    return;
  }

  try {
    const res = await fetch('/api/auth/gatekeeper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (data.success) {
      sounds.playSuccess();
      sessionStorage.setItem('eventpass_role', 'gatekeeper');
      applyRole('gatekeeper');
      hideAuthOverlay();
    } else {
      sounds.playWarning();
      if (errorEl) errorEl.textContent = data.error || 'PIN incorrecto.';
      clearPinDigits();
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = 'Error al verificar credenciales con el servidor.';
  }
}

async function submitSellerAuth() {
  const pinInput = document.getElementById('sellerPinInput');
  const nameInput = document.getElementById('sellerNameInput');
  const errorEl = document.getElementById('sellerErrorMsg');
  const pin = (pinInput ? pinInput.value : '').trim();
  const sellerName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : 'Taquilla 1';

  if (pin.length !== 4) {
    if (errorEl) errorEl.textContent = 'El PIN debe tener 4 cifras numéricas.';
    return;
  }

  try {
    const res = await fetch('/api/auth/seller', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, sellerName })
    });
    const data = await res.json();
    if (data.success) {
      sounds.playSuccess();
      sessionStorage.setItem('eventpass_role', 'seller');
      sessionStorage.setItem('eventpass_seller_name', data.sellerName);
      appState.sellerName = data.sellerName;
      applyRole('seller');
      hideAuthOverlay();
    } else {
      sounds.playWarning();
      if (errorEl) errorEl.textContent = data.error || 'PIN de vendedor incorrecto.';
      clearSellerPinDigits();
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = 'Error al verificar credenciales con el servidor.';
  }
}

async function submitAdminAuth() {
  const passInput = document.getElementById('adminPasswordInput');
  const errorEl = document.getElementById('adminErrorMsg');
  const password = (passInput ? passInput.value : '').trim();

  if (!password) {
    if (errorEl) errorEl.textContent = 'Ingresa la contraseña de administrador.';
    return;
  }

  try {
    const res = await fetch('/api/auth/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.success) {
      sounds.playSuccess();
      sessionStorage.setItem('eventpass_role', 'admin');
      applyRole('admin');
      hideAuthOverlay();
    } else {
      sounds.playWarning();
      if (errorEl) errorEl.textContent = data.error || 'Contraseña incorrecta.';
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = 'Error al comunicarse con el servidor.';
  }
}

function applyRole(role) {
  appState.userRole = role;
  const roleBadge = document.getElementById('userRoleBadge');
  const roleIcon = document.getElementById('userRoleIcon');
  const roleText = document.getElementById('userRoleText');
  const btnLogout = document.getElementById('btnLogout');
  const btnSwitchGate = document.getElementById('btnSwitchToGatekeeper');
  const btnSwitchSeller = document.getElementById('btnSwitchToSeller');

  const topIcon = document.getElementById('userRoleIconDisplay');
  const topText = document.getElementById('userRoleTextDisplay');
  const dropTitle = document.getElementById('userDropdownRoleTitle');

  if (role === 'gatekeeper') {
    document.body.classList.remove('seller-active-mode');
    document.body.classList.add('gatekeeper-active-mode');
    if (roleBadge) {
      roleBadge.style.display = 'inline-flex';
      roleBadge.className = 'gatekeeper-banner-pill';
      if (roleIcon) roleIcon.textContent = '🚪';
      if (roleText) roleText.textContent = 'Turno Portería';
    }
    if (topIcon) topIcon.textContent = '🚪';
    if (topText) topText.textContent = 'Portería';
    if (dropTitle) dropTitle.textContent = 'Control de Acceso Portería';

    if (btnLogout) {
      btnLogout.style.display = 'flex';
      btnLogout.innerHTML = '<span>🚪</span> Salir de Portería';
    }
    if (btnSwitchGate) btnSwitchGate.style.display = 'none';
    if (btnSwitchSeller) btnSwitchSeller.style.display = 'none';

    // Switch and lock to scanner tab
    switchTab('scanner');
  } else if (role === 'seller') {
    document.body.classList.remove('gatekeeper-active-mode');
    document.body.classList.add('seller-active-mode');
    const sName = sessionStorage.getItem('eventpass_seller_name') || appState.sellerName || 'Taquilla 1';
    appState.sellerName = sName;
    if (roleBadge) {
      roleBadge.style.display = 'inline-flex';
      roleBadge.className = 'seller-banner-pill';
      if (roleIcon) roleIcon.textContent = '🎟️';
      if (roleText) roleText.textContent = `Taquilla: ${sName}`;
    }
    if (topIcon) topIcon.textContent = '🎟️';
    if (topText) topText.textContent = sName;
    if (dropTitle) dropTitle.textContent = `Vendedor: ${sName}`;

    if (btnLogout) {
      btnLogout.style.display = 'flex';
      btnLogout.innerHTML = '<span>🚪</span> Salir de Taquilla';
    }
    if (btnSwitchGate) btnSwitchGate.style.display = 'none';
    if (btnSwitchSeller) btnSwitchSeller.style.display = 'none';

    // Switch to POS tab
    switchTab('pos');
  } else if (role === 'admin') {
    document.body.classList.remove('gatekeeper-active-mode');
    document.body.classList.remove('seller-active-mode');
    if (roleBadge) {
      roleBadge.style.display = 'inline-flex';
      roleBadge.className = 'gatekeeper-banner-pill';
      if (roleIcon) roleIcon.textContent = '👑';
      if (roleText) roleText.textContent = 'Administrador';
    }
    if (topIcon) topIcon.textContent = '👑';
    if (topText) topText.textContent = 'Administrador';
    if (dropTitle) dropTitle.textContent = 'Administrador Principal';

    if (btnLogout) {
      btnLogout.style.display = 'flex';
      btnLogout.innerHTML = '<span>🔒</span> Salir';
    }
    if (btnSwitchGate) {
      btnSwitchGate.style.display = 'flex';
    }
    if (btnSwitchSeller) {
      btnSwitchSeller.style.display = 'flex';
    }

    if (appState.activeTab === 'scanner' || appState.activeTab === 'pos' || appState.activeTab === 'seller-box') {
      // Keep user where they are
    } else {
      switchTab('dashboard');
    }
  }
}

function logout() {
  sessionStorage.removeItem('eventpass_role');
  sessionStorage.removeItem('eventpass_seller_name');
  appState.userRole = null;
  document.body.classList.remove('gatekeeper-active-mode');
  document.body.classList.remove('seller-active-mode');
  const roleBadge = document.getElementById('userRoleBadge');
  if (roleBadge) roleBadge.style.display = 'none';
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.style.display = 'none';
  const btnSwitchGate = document.getElementById('btnSwitchToGatekeeper');
  if (btnSwitchGate) btnSwitchGate.style.display = 'none';
  const btnSwitchSeller = document.getElementById('btnSwitchToSeller');
  if (btnSwitchSeller) btnSwitchSeller.style.display = 'none';
  toggleUserDropdown(false);
  stopCamera();
  showAuthOverlay();
}

// Global exposure for inline HTML callbacks
window.selectAuthRole = selectAuthRole;
window.appendPinDigit = appendPinDigit;
window.clearPinDigits = clearPinDigits;
window.deletePinDigit = deletePinDigit;
window.appendSellerPinDigit = appendSellerPinDigit;
window.clearSellerPinDigits = clearSellerPinDigits;
window.deleteSellerPinDigit = deleteSellerPinDigit;

// ============================================================================
// 3. INICIALIZACIÓN Y NAVEGACIÓN
// ============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupEventListeners();
  await loadInitialData();
  setupSSE();
  initAuth();
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
  // If gatekeeper, they can only see scanner
  if (appState.userRole === 'gatekeeper' && tabName !== 'scanner') {
    tabName = 'scanner';
  }
  // If seller, they can only see pos or seller-box
  if (appState.userRole === 'seller' && tabName !== 'pos' && tabName !== 'seller-box') {
    tabName = 'pos';
  }
  appState.activeTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.toggle('active', section.id === `tab-${tabName}`);
  });

  // Actualizar migas de pan / título de vista en la topbar
  const topbarTitle = document.getElementById('topbarCurrentViewTitle');
  if (topbarTitle) {
    const titles = {
      dashboard: 'Dashboard',
      pos: 'Punto de Venta',
      sell: 'Emitir Entrada',
      attendees: 'Asistentes',
      scanner: 'Escáner Portería',
      'seller-box': 'Corte de Caja',
      settings: 'Ajustes del Evento'
    };
    topbarTitle.textContent = titles[tabName] || tabName;
  }

  // Cerrar menú móvil automáticamente al navegar
  toggleMobileSidebar(false);
  toggleUserDropdown(false);

  if (tabName === 'pos') {
    renderPosCatalog();
    updatePosCartUI();
  } else if (tabName === 'seller-box') {
    renderSellerShiftBox();
  }

  // Manejo especial de la cámara si se entra o sale de la pestaña de Scanner
  if (tabName === 'scanner') {
    startCamera();
  } else {
    stopCamera();
  }
}

function toggleMobileSidebar(forceState) {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;
  const isOpen = forceState !== undefined ? forceState : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  if (backdrop) backdrop.classList.toggle('active', isOpen);
}

function toggleUserDropdown(forceState) {
  const menu = document.getElementById('userDropdownMenu');
  if (!menu) return;
  const isOpen = forceState !== undefined ? forceState : !menu.classList.contains('open');
  menu.classList.toggle('open', isOpen);
  const btn = document.getElementById('userMenuBtn');
  if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

// ============================================================================
// 4. CARGA DE DATOS & SINCRONIZACIÓN EN TIEMPO REAL (SSE)
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
    if (appState.activeTab === 'pos') renderPosCatalog();
    if (appState.activeTab === 'seller-box') renderSellerShiftBox();
  } else if (type === 'TICKET_SCANNED' || type === 'FRAUD_DETECTED' || type === 'TICKET_UPDATED') {
    // Actualizar el ticket en la lista
    const idx = appState.tickets.findIndex(t => t.id === data.ticket.id);
    if (idx !== -1) {
      appState.tickets[idx] = data.ticket;
    }
    if (data.stats) appState.stats = data.stats;
    renderKPIs();
    renderAttendeesTable();
    if (appState.activeTab === 'seller-box') renderSellerShiftBox();
  } else if (type === 'EVENT_UPDATED') {
    appState.event = data;
    renderEventInfo();
    populateTicketTypeSelect();
    populateSettingsForm();
    if (appState.activeTab === 'pos') renderPosCatalog();
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

  // Actualizar HUD de portería
  const counterEl = document.getElementById('porteroCounterText');
  if (counterEl) {
    counterEl.textContent = `${entered} / ${capacity} (${percent}%)`;
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
  const filterSellerEl = document.getElementById('filterSellerSelect');
  const filterSeller = filterSellerEl ? filterSellerEl.value : 'all';
  const currency = (appState.event && appState.event.currency) || '$';

  // Poblar opciones del filtro de vendedores dinámicamente
  if (filterSellerEl) {
    const currentVal = filterSellerEl.value;
    const sellers = Array.from(new Set(appState.tickets.map(t => t.soldBy || 'Administración')));
    let optionsHtml = '<option value="all">Todos los vendedores</option>';
    sellers.forEach(s => {
      optionsHtml += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
    });
    if (filterSellerEl.dataset.lastCount !== String(sellers.length)) {
      filterSellerEl.innerHTML = optionsHtml;
      filterSellerEl.value = currentVal || 'all';
      filterSellerEl.dataset.lastCount = String(sellers.length);
    }
  }

  let filtered = appState.tickets.filter(t => {
    // Filtro estado
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;

    // Filtro vendedor
    if (filterSeller !== 'all' && (t.soldBy || 'Administración') !== filterSeller) return false;

    // Búsqueda de texto
    if (!search) return true;
    return (
      t.attendeeName.toLowerCase().includes(search) ||
      t.id.toLowerCase().includes(search) ||
      (t.attendeeDni && t.attendeeDni.toLowerCase().includes(search)) ||
      (t.attendeePhone && t.attendeePhone.toLowerCase().includes(search)) ||
      (t.soldBy && t.soldBy.toLowerCase().includes(search))
    );
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
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

    const vendedorNombre = t.soldBy || 'Administración';

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
        <td style="font-size: 0.82rem; color: #38bdf8; font-weight: 600;">${escapeHtml(vendedorNombre)}</td>
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
  card.style.display = 'block';

  if (scanResultTimer) {
    clearTimeout(scanResultTimer);
    scanResultTimer = null;
  }

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

    // Auto-dismiss en 3.2 segundos para que el portero no tenga que tocar la pantalla
    scanResultTimer = setTimeout(dismissScanResult, 3200);

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
}

let scanResultTimer = null;

function dismissScanResult() {
  if (scanResultTimer) {
    clearTimeout(scanResultTimer);
    scanResultTimer = null;
  }
  const card = document.getElementById('scanResultCard');
  if (card) card.style.display = 'none';
}

function toggleManualDrawer(show) {
  const drawer = document.getElementById('drawerManualInput');
  if (!drawer) return;
  const isCurrentlyOpen = drawer.style.display !== 'none';
  const shouldOpen = show !== undefined ? show : !isCurrentlyOpen;
  drawer.style.display = shouldOpen ? 'block' : 'none';
  const btn = document.getElementById('btnToggleManualDrawer');
  if (btn) btn.classList.toggle('active', shouldOpen);
  if (shouldOpen) {
    toggleHistoryDrawer(false);
    const inp = document.getElementById('manualTicketCode');
    if (inp) {
      inp.focus();
    }
  }
}

function toggleHistoryDrawer(show) {
  const drawer = document.getElementById('drawerHistory');
  if (!drawer) return;
  const isCurrentlyOpen = drawer.style.display !== 'none';
  const shouldOpen = show !== undefined ? show : !isCurrentlyOpen;
  drawer.style.display = shouldOpen ? 'block' : 'none';
  const btn = document.getElementById('btnToggleHistoryDrawer');
  if (btn) btn.classList.toggle('active', shouldOpen);
  if (shouldOpen) {
    toggleManualDrawer(false);
  }
}

window.dismissScanResult = dismissScanResult;
window.toggleManualDrawer = toggleManualDrawer;
window.toggleHistoryDrawer = toggleHistoryDrawer;

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

  // Formulario de emisión de boleto (Simplificado)
  document.getElementById('sellTicketForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('attendeeName').value.trim();
    const phone = document.getElementById('attendeePhone').value.trim();
    const dni = document.getElementById('attendeeDni').value.trim();
    const type = document.getElementById('ticketTypeSelect').value;
    const price = document.getElementById('ticketPrice').value;
    const paymentMethod = document.getElementById('paymentMethod').value;
    const notes = document.getElementById('ticketNotes').value.trim();
    const quantity = parseInt(document.getElementById('ticketQuantity').value, 10) || 1;

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
          notes: notes,
          quantity: quantity,
          soldBy: appState.userRole === 'seller' ? (appState.sellerName || 'Vendedor Taquilla') : 'Administración'
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
        document.getElementById('ticketQuantity').value = '1';

        if (data.count > 1) {
          showActionAlertModal('🎉', 'Lote de Boletos Emitido', `¡Se han generado con éxito <strong>${data.count} boletos</strong> con códigos QR únicos!`);
          setTimeout(() => {
            openTicketModal(data.ticket.id);
          }, 1500);
        } else {
          // Abrir de inmediato el boleto generado
          openTicketModal(data.ticket.id);
        }
      } else {
        showActionAlertModal('⚠️', 'Error al Emitir Boleto', data.error || 'Error al emitir el boleto.');
      }
    } catch (err) {
      console.error(err);
      showActionAlertModal('🛑', 'Error de Conexión', 'No se pudo comunicar con el servidor para emitir el boleto.');
    }
  });

  // Listeners de Formularios de Autenticación
  const formGate = document.getElementById('formGatekeeperAuth');
  if (formGate) {
    formGate.addEventListener('submit', (e) => {
      e.preventDefault();
      submitGatekeeperAuth();
    });
  }

  const formSeller = document.getElementById('formSellerAuth');
  if (formSeller) {
    formSeller.addEventListener('submit', (e) => {
      e.preventDefault();
      submitSellerAuth();
    });
  }

  const formAdm = document.getElementById('formAdminAuth');
  if (formAdm) {
    formAdm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitAdminAuth();
    });
  }

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      toggleUserDropdown(false);
      logout();
    });
  }

  const btnSwitchGate = document.getElementById('btnSwitchToGatekeeper');
  if (btnSwitchGate) {
    btnSwitchGate.addEventListener('click', () => {
      toggleUserDropdown(false);
      switchTab('scanner');
    });
  }

  const btnSwitchSeller = document.getElementById('btnSwitchToSeller');
  if (btnSwitchSeller) {
    btnSwitchSeller.addEventListener('click', () => {
      toggleUserDropdown(false);
      switchTab('pos');
    });
  }

  // Menú de Usuario / Selector de Modo
  const userMenuBtn = document.getElementById('userMenuBtn');
  if (userMenuBtn) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleUserDropdown();
    });
  }

  // Cerrar dropdown al hacer clic en cualquier lugar fuera de él
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('userDropdownMenu');
    const trigger = document.getElementById('userMenuBtn');
    if (dropdown && dropdown.classList.contains('open')) {
      if (!dropdown.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
        toggleUserDropdown(false);
      }
    }
  });

  // Control de Apertura / Cierre de Cajón Lateral en Móviles
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => toggleMobileSidebar(true));
  }
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', () => toggleMobileSidebar(false));
  }
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => toggleMobileSidebar(false));
  }
  const mobileNavMoreBtn = document.getElementById('mobileNavMoreBtn');
  if (mobileNavMoreBtn) {
    mobileNavMoreBtn.addEventListener('click', () => toggleMobileSidebar(true));
  }

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
  const btnDismissResult = document.getElementById('btnDismissResult');
  if (btnDismissResult) {
    btnDismissResult.addEventListener('click', dismissScanResult);
  }
  const btnDismissResultTop = document.getElementById('btnDismissResultTop');
  if (btnDismissResultTop) {
    btnDismissResultTop.addEventListener('click', dismissScanResult);
  }

  // Controles HUD de portería (Zero-Scroll)
  const btnHudSwitchCamera = document.getElementById('btnHudSwitchCamera');
  if (btnHudSwitchCamera) {
    btnHudSwitchCamera.addEventListener('click', switchCamera);
  }

  const btnHudToggleAudio = document.getElementById('btnHudToggleAudio');
  if (btnHudToggleAudio) {
    btnHudToggleAudio.addEventListener('click', () => {
      appState.audioEnabled = !appState.audioEnabled;
      const hudIcon = document.getElementById('hudAudioIcon');
      if (hudIcon) hudIcon.textContent = appState.audioEnabled ? '🔊' : '🔇';
      const audioIcon = document.getElementById('audioIcon');
      if (audioIcon) audioIcon.textContent = appState.audioEnabled ? '🔊' : '🔇';
    });
  }

  const btnToggleManualDrawer = document.getElementById('btnToggleManualDrawer');
  if (btnToggleManualDrawer) {
    btnToggleManualDrawer.addEventListener('click', () => toggleManualDrawer());
  }

  const btnToggleHistoryDrawer = document.getElementById('btnToggleHistoryDrawer');
  if (btnToggleHistoryDrawer) {
    btnToggleHistoryDrawer.addEventListener('click', () => toggleHistoryDrawer());
  }

  // Controles de cámara estándar (compatibilidad)
  const btnToggleCamera = document.getElementById('btnToggleCamera');
  if (btnToggleCamera) {
    btnToggleCamera.addEventListener('click', () => {
      if (appState.isScanning) {
        stopCamera();
      } else {
        startCamera();
      }
    });
  }

  const btnSwitchCamera = document.getElementById('btnSwitchCamera');
  if (btnSwitchCamera) {
    btnSwitchCamera.addEventListener('click', switchCamera);
  }

  const btnToggleAudio = document.getElementById('btnToggleAudio');
  if (btnToggleAudio) {
    btnToggleAudio.addEventListener('click', () => {
      appState.audioEnabled = !appState.audioEnabled;
      const audioIcon = document.getElementById('audioIcon');
      if (audioIcon) audioIcon.textContent = appState.audioEnabled ? '🔊' : '🔇';
      const hudIcon = document.getElementById('hudAudioIcon');
      if (hudIcon) hudIcon.textContent = appState.audioEnabled ? '🔊' : '🔇';
    });
  }

  // Filtros de búsqueda en tabla
  document.getElementById('attendeesSearchInput').addEventListener('input', renderAttendeesTable);
  document.getElementById('filterStatusSelect').addEventListener('change', renderAttendeesTable);
  const filterSellerSelect = document.getElementById('filterSellerSelect');
  if (filterSellerSelect) {
    filterSellerSelect.addEventListener('change', renderAttendeesTable);
  }

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

    const pinInput = document.getElementById('setGatekeeperPin');
    const pinVal = pinInput ? pinInput.value.trim() : '';
    if (pinVal && !/^\d{4}$/.test(pinVal)) {
      showActionAlertModal('⚠️', 'PIN Inválido', 'El PIN de portería debe tener exactamente 4 cifras numéricas (ej: 1234).');
      return;
    }

    const sellerPinInput = document.getElementById('setSellerPin');
    const sellerPinVal = sellerPinInput ? sellerPinInput.value.trim() : '';
    if (sellerPinVal && !/^\d{4}$/.test(sellerPinVal)) {
      showActionAlertModal('⚠️', 'PIN Inválido', 'El PIN de ventas debe tener exactamente 4 cifras numéricas (ej: 4321).');
      return;
    }

    const passInput = document.getElementById('setAdminPassword');
    const passVal = passInput ? passInput.value.trim() : '';
    if (passVal && passVal.length < 4) {
      showActionAlertModal('⚠️', 'Contraseña Corta', 'La contraseña de administrador debe tener al menos 4 caracteres.');
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

    if (pinVal) updated.gatekeeperPin = pinVal;
    if (sellerPinVal) updated.sellerPin = sellerPinVal;
    if (passVal) updated.adminPassword = passVal;

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
        showActionAlertModal('💾', 'Configuración Guardada', '¡La configuración del evento, tipos de entrada y claves de seguridad han sido guardadas con éxito!');
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

  const gatekeeperPinInput = document.getElementById('setGatekeeperPin');
  if (gatekeeperPinInput) {
    gatekeeperPinInput.value = ev.gatekeeperPin || '1234';
  }
  const sellerPinInput = document.getElementById('setSellerPin');
  if (sellerPinInput) {
    sellerPinInput.value = ev.sellerPin || '4321';
  }
  const adminPasswordInput = document.getElementById('setAdminPassword');
  if (adminPasswordInput) {
    adminPasswordInput.value = '';
  }

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

// ============================================================================
// 8. PUNTO DE VENTA EXPRESS (POS) & CAJA DE VENDEDORES
// ============================================================================
function renderPosCatalog() {
  const container = document.getElementById('posTicketTypesGrid');
  if (!container) return;

  const ev = appState.event || {};
  const currency = ev.currency || '$';
  const posEventEl = document.getElementById('posEventName');
  if (posEventEl) posEventEl.textContent = ev.name || 'Mi Gran Evento';
  const posPrefixEl = document.getElementById('posCurrencyPrefix');
  if (posPrefixEl) posPrefixEl.textContent = currency;
  const sellerPillEl = document.getElementById('posCurrentSellerName');
  if (sellerPillEl) sellerPillEl.textContent = appState.sellerName || 'Taquilla 1';

  // Available seats
  const activeCount = appState.tickets.filter(t => t.status !== 'cancelled').length;
  const capacity = ev.capacity || 0;
  const remaining = Math.max(0, capacity - activeCount);
  const seatsEl = document.getElementById('posAvailableSeats');
  if (seatsEl) {
    seatsEl.textContent = capacity > 0 ? `${remaining} cupos` : 'Ilimitado';
    seatsEl.style.color = remaining <= 10 && capacity > 0 ? '#f87171' : '#34d399';
  }

  const types = (ev.ticketTypes && ev.ticketTypes.length > 0) ? ev.ticketTypes : [
    { id: 'general', name: 'General', price: 50 },
    { id: 'vip', name: 'VIP', price: 100 }
  ];

  container.innerHTML = types.map(t => {
    const qty = appState.posCart[t.id] || 0;
    const inCartClass = qty > 0 ? 'in-cart' : '';
    return `
      <div class="pos-ticket-card ${inCartClass}" id="posCard-${t.id}">
        <div>
          <div class="pos-ticket-name">${escapeHtml(t.name)}</div>
          <div class="pos-ticket-price">${currency}${t.price}</div>
        </div>
        <div class="pos-card-qty-controls">
          <button type="button" class="pos-qty-btn" onclick="removeTicketFromPos('${t.id}')" title="Quitar 1">-</button>
          <span class="pos-qty-display" id="posCardQty-${t.id}">${qty}</span>
          <button type="button" class="pos-qty-btn" onclick="addTicketToPos('${t.id}')" title="Agregar 1">+</button>
        </div>
      </div>
    `;
  }).join('');
}

function addTicketToPos(typeId) {
  sounds.playSuccess();
  appState.posCart[typeId] = (appState.posCart[typeId] || 0) + 1;
  updatePosCartUI();
  const card = document.getElementById(`posCard-${typeId}`);
  if (card) {
    card.classList.add('in-cart');
    const qtyEl = document.getElementById(`posCardQty-${typeId}`);
    if (qtyEl) qtyEl.textContent = appState.posCart[typeId];
  }
}

function removeTicketFromPos(typeId) {
  if (!appState.posCart[typeId]) return;
  appState.posCart[typeId] -= 1;
  if (appState.posCart[typeId] <= 0) {
    delete appState.posCart[typeId];
  }
  updatePosCartUI();
  const card = document.getElementById(`posCard-${typeId}`);
  if (card) {
    const qty = appState.posCart[typeId] || 0;
    if (qty === 0) card.classList.remove('in-cart');
    const qtyEl = document.getElementById(`posCardQty-${typeId}`);
    if (qtyEl) qtyEl.textContent = qty;
  }
}

function clearPosCart() {
  appState.posCart = {};
  updatePosCartUI();
  renderPosCatalog();
}

function updatePosCartUI() {
  const container = document.getElementById('posOrderItemsList');
  if (!container) return;

  const ev = appState.event || {};
  const currency = ev.currency || '$';
  const types = ev.ticketTypes || [];
  const entries = Object.entries(appState.posCart);

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="pos-empty-cart">
        <span>🛒</span>
        <p>Selecciona una o más entradas a la izquierda para comenzar la venta</p>
      </div>
    `;
    const grandDisp = document.getElementById('posGrandTotalDisplay');
    if (grandDisp) grandDisp.textContent = `${currency}0`;
    const countDisp = document.getElementById('posTotalTicketsCount');
    if (countDisp) countDisp.textContent = '0';
    calculatePosChange();
    return;
  }

  let grandTotal = 0;
  let totalTickets = 0;

  let html = '';
  entries.forEach(([typeId, qty]) => {
    const ticketType = types.find(t => t.id === typeId) || { name: 'Entrada', price: 0 };
    const lineTotal = (ticketType.price || 0) * qty;
    grandTotal += lineTotal;
    totalTickets += qty;

    html += `
      <div class="pos-order-item">
        <div class="pos-item-info">
          <span class="pos-item-qty-tag">x${qty}</span>
          <strong>${escapeHtml(ticketType.name)}</strong>
        </div>
        <div style="display: flex; align-items: center; gap: 0.65rem;">
          <span class="pos-item-total">${currency}${lineTotal.toLocaleString()}</span>
          <button type="button" class="btn-text-danger" onclick="removeTicketFromPos('${typeId}')" title="Quitar uno" style="font-size: 1rem; padding: 0.1rem 0.35rem;">✕</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  const grandDisp = document.getElementById('posGrandTotalDisplay');
  if (grandDisp) grandDisp.textContent = `${currency}${grandTotal.toLocaleString()}`;
  const countDisp = document.getElementById('posTotalTicketsCount');
  if (countDisp) countDisp.textContent = totalTickets;

  calculatePosChange();
}

function togglePosBuyerFields(isCustom) {
  const wrap = document.getElementById('posCustomBuyerFields');
  const optBearer = document.getElementById('togglePosBearer');
  const optCustom = document.getElementById('togglePosCustom');

  appState.posBuyerType = isCustom ? 'custom' : 'bearer';
  if (wrap) wrap.style.display = isCustom ? 'flex' : 'none';
  if (optBearer) optBearer.classList.toggle('active', !isCustom);
  if (optCustom) optCustom.classList.toggle('active', isCustom);

  if (isCustom) {
    setTimeout(() => {
      const inp = document.getElementById('posBuyerName');
      if (inp) inp.focus();
    }, 50);
  }
}

function selectPosPaymentMethod(method) {
  appState.posPaymentMethod = method;
  document.querySelectorAll('.payment-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-method') === method);
  });

  const calcBox = document.getElementById('posCashCalculatorBox');
  if (calcBox) {
    calcBox.style.display = method === 'Efectivo' ? 'block' : 'none';
  }
  calculatePosChange();
}

function calculatePosChange() {
  if (appState.posPaymentMethod !== 'Efectivo') return;

  const ev = appState.event || {};
  const currency = ev.currency || '$';
  const types = ev.ticketTypes || [];

  let grandTotal = 0;
  Object.entries(appState.posCart).forEach(([typeId, qty]) => {
    const t = types.find(x => x.id === typeId) || { price: 0 };
    grandTotal += (t.price || 0) * qty;
  });

  const cashInp = document.getElementById('posCashReceivedInput');
  const cashVal = parseFloat(cashInp ? cashInp.value : 0) || 0;
  const changeBox = document.getElementById('posChangeBox');
  const changeAmt = document.getElementById('posChangeAmount');

  if (!changeBox || !changeAmt) return;

  if (cashVal === 0 && grandTotal > 0) {
    changeBox.className = 'change-display-box';
    changeAmt.textContent = `${currency}0`;
    return;
  }

  const diff = cashVal - grandTotal;
  if (diff >= 0) {
    changeBox.className = 'change-display-box';
    changeAmt.textContent = `${currency}${diff.toLocaleString()}`;
  } else {
    changeBox.className = 'change-display-box short';
    changeAmt.textContent = `Faltan: ${currency}${Math.abs(diff).toLocaleString()}`;
  }
}

function addQuickCash(amount) {
  const cashInp = document.getElementById('posCashReceivedInput');
  if (!cashInp) return;
  const current = parseFloat(cashInp.value) || 0;
  cashInp.value = current + amount;
  calculatePosChange();
}

function setExactCash() {
  const ev = appState.event || {};
  const types = ev.ticketTypes || [];
  let grandTotal = 0;
  Object.entries(appState.posCart).forEach(([typeId, qty]) => {
    const t = types.find(x => x.id === typeId) || { price: 0 };
    grandTotal += (t.price || 0) * qty;
  });

  const cashInp = document.getElementById('posCashReceivedInput');
  if (cashInp) {
    cashInp.value = grandTotal;
    calculatePosChange();
  }
}

async function submitPosSale() {
  const entries = Object.entries(appState.posCart);
  if (entries.length === 0) {
    showActionAlertModal('🛒', 'Orden Vacía', 'Selecciona al menos una entrada para cobrar.');
    return;
  }

  const ev = appState.event || {};
  const types = ev.ticketTypes || [];
  const currency = ev.currency || '$';

  let grandTotal = 0;
  let totalCount = 0;
  entries.forEach(([typeId, qty]) => {
    const t = types.find(x => x.id === typeId) || { price: 0 };
    grandTotal += (t.price || 0) * qty;
    totalCount += qty;
  });

  const cashInp = document.getElementById('posCashReceivedInput');
  const cashVal = parseFloat(cashInp ? cashInp.value : 0) || 0;
  if (appState.posPaymentMethod === 'Efectivo' && cashVal > 0 && cashVal < grandTotal) {
    showActionAlertModal('💵', 'Efectivo Insuficiente', `El efectivo recibido (${currency}${cashVal}) es menor al total a cobrar (${currency}${grandTotal}).`);
    return;
  }

  const isCustom = appState.posBuyerType === 'custom';
  const buyerName = isCustom ? (document.getElementById('posBuyerName').value || '').trim() : '';
  const buyerPhone = isCustom ? (document.getElementById('posBuyerPhone').value || '').trim() : '';
  const buyerDni = isCustom ? (document.getElementById('posBuyerDni').value || '').trim() : '';
  const seller = appState.sellerName || 'Taquilla 1';

  const btnSubmit = document.getElementById('btnPosSubmitOrder');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<span>⏳</span> Procesando Venta...';

  const createdTicketsList = [];

  try {
    for (const [typeId, qty] of entries) {
      const t = types.find(x => x.id === typeId) || { name: 'General', price: 0 };
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendeeName: buyerName,
          attendeePhone: buyerPhone,
          attendeeDni: buyerDni,
          type: t.name,
          price: t.price,
          paymentMethod: appState.posPaymentMethod,
          quantity: qty,
          soldBy: seller
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Error al generar boletos');
      }
      if (Array.isArray(data.tickets)) {
        createdTicketsList.push(...data.tickets);
      } else if (data.ticket) {
        createdTicketsList.push(data.ticket);
      }
    }

    sounds.playSuccess();
    appState.lastSoldTickets = createdTicketsList;

    // Resetear formulario POS
    clearPosCart();
    if (cashInp) cashInp.value = '';
    if (isCustom) {
      document.getElementById('posBuyerName').value = '';
      document.getElementById('posBuyerPhone').value = '';
      document.getElementById('posBuyerDni').value = '';
      togglePosBuyerFields(false);
    }

    // Mostrar modal de éxito
    openPosSuccessModal(createdTicketsList, grandTotal, cashVal);

  } catch (err) {
    sounds.playWarning();
    showActionAlertModal('🛑', 'Error en la Venta', err.message || 'No se pudo completar la venta.');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<span>🎟️</span> Cobrar y Generar Boletos';
  }
}

function openPosSuccessModal(tickets, totalPaid, cashReceived) {
  if (!tickets || tickets.length === 0) return;
  const firstTicket = tickets[0];
  const ev = appState.event || {};
  const currency = ev.currency || '$';

  document.getElementById('posSuccessCountText').textContent = tickets.length === 1 
    ? `1 Entrada (${firstTicket.type})` 
    : `${tickets.length} Entradas (${firstTicket.type})`;

  document.getElementById('posSuccessAttendeeName').textContent = firstTicket.attendeeName || 'Al Portador';
  document.getElementById('posSuccessTotalPaid').textContent = `${currency}${totalPaid.toLocaleString()} (${firstTicket.paymentMethod})`;
  document.getElementById('posSuccessFolio').textContent = firstTicket.id + (tickets.length > 1 ? ` (+${tickets.length - 1} más)` : '');

  // Cambio
  const changeRow = document.getElementById('posSuccessChangeRow');
  if (cashReceived > totalPaid && firstTicket.paymentMethod === 'Efectivo') {
    changeRow.style.display = 'flex';
    document.getElementById('posSuccessChangeText').textContent = `${currency}${(cashReceived - totalPaid).toLocaleString()}`;
  } else {
    changeRow.style.display = 'none';
  }

  // Pre-fill WhatsApp si tenía teléfono
  const phoneInp = document.getElementById('posSuccessPhoneInput');
  if (phoneInp) {
    phoneInp.value = firstTicket.attendeePhone || '';
  }

  document.getElementById('posSuccessModal').classList.add('open');
}

function closePosSuccessModal() {
  document.getElementById('posSuccessModal').classList.remove('open');
}

function sendPosTicketWhatsApp() {
  if (!appState.lastSoldTickets || appState.lastSoldTickets.length === 0) return;
  const firstTicket = appState.lastSoldTickets[0];
  const ev = appState.event || {};
  const phoneInp = document.getElementById('posSuccessPhoneInput');
  const phone = (phoneInp ? phoneInp.value : firstTicket.attendeePhone || '').replace(/[^0-9]/g, '');

  const url = `${window.location.origin}/ticket.html?id=${firstTicket.id}`;
  const count = appState.lastSoldTickets.length;
  const countText = count > 1 ? ` (${count} boletos emitidos)` : '';

  const msg = `¡Hola ${firstTicket.attendeeName}! 👋 Aquí tienes tu entrada oficial para *${ev.name || 'el evento'}*${countText}:\n\n🎟️ Folio: *${firstTicket.id}*\n🎫 Tipo: *${firstTicket.type}*\n🔗 Accede a tu boleto digital con código QR aquí:\n${url}\n\n*Presenta este código en la entrada el día del evento.* ¡Te esperamos!`;

  let waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
  if (phone) {
    waUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`;
  }
  window.open(waUrl, '_blank');
}

function printPosThermalReceipt() {
  if (!appState.lastSoldTickets || appState.lastSoldTickets.length === 0) return;
  const firstTicket = appState.lastSoldTickets[0];
  const ev = appState.event || {};
  const currency = ev.currency || '$';

  document.getElementById('receiptEventName').textContent = ev.name || 'Mi Gran Evento';
  document.getElementById('receiptEventSubtitle').textContent = ev.subtitle || '';
  document.getElementById('receiptDate').textContent = ev.date ? new Date(ev.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Fecha por definir';
  document.getElementById('receiptLocation').textContent = ev.location || 'Recinto';

  document.getElementById('receiptQrImage').src = firstTicket.qrDataUrl;
  document.getElementById('receiptFolio').textContent = firstTicket.id;
  document.getElementById('receiptTicketType').textContent = `ENTRADA ${firstTicket.type.toUpperCase()}`;

  document.getElementById('receiptAttendee').textContent = firstTicket.attendeeName;
  if (firstTicket.attendeeDni) {
    document.getElementById('receiptDniRow').style.display = 'flex';
    document.getElementById('receiptDni').textContent = firstTicket.attendeeDni;
  } else {
    document.getElementById('receiptDniRow').style.display = 'none';
  }

  const count = appState.lastSoldTickets.length;
  const totalPrice = appState.lastSoldTickets.reduce((sum, t) => sum + (t.price || 0), 0);
  document.getElementById('receiptPrice').textContent = count > 1 ? `${currency}${totalPrice} (${count} boletos)` : `${currency}${firstTicket.price}`;
  document.getElementById('receiptPayment').textContent = firstTicket.paymentMethod || 'Efectivo';
  document.getElementById('receiptSeller').textContent = firstTicket.soldBy || appState.sellerName || 'Taquilla';
  document.getElementById('receiptTime').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  window.print();
}

function copyPosTicketLink() {
  if (!appState.lastSoldTickets || appState.lastSoldTickets.length === 0) return;
  const firstTicket = appState.lastSoldTickets[0];
  const url = `${window.location.origin}/ticket.html?id=${firstTicket.id}`;
  navigator.clipboard.writeText(url).then(() => {
    showActionAlertModal('🔗', 'Enlace Copiado', `El enlace público del boleto digital ha sido copiado.`);
  });
}

// ============================================================================
// 9. CORTE DE CAJA DEL TURNO (MI CAJA)
// ============================================================================
function renderSellerShiftBox() {
  const seller = appState.sellerName || 'Taquilla 1';
  const ev = appState.event || {};
  const currency = ev.currency || '$';

  const sellerBoxEl = document.getElementById('sellerBoxName');
  if (sellerBoxEl) sellerBoxEl.textContent = seller;
  const sellerDateEl = document.getElementById('sellerBoxDateTime');
  if (sellerDateEl) {
    sellerDateEl.textContent = new Date().toLocaleDateString([], { dateStyle: 'full' }) + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Filtrar boletos vendidos por este vendedor
  const myTickets = appState.tickets.filter(t => (t.soldBy || 'Administración') === seller);

  let cashTotal = 0;
  let digitalTotal = 0;
  let cardTotal = 0;
  let grandTotal = 0;

  myTickets.forEach(t => {
    if (t.status === 'cancelled') return;
    const p = t.price || 0;
    grandTotal += p;
    const method = (t.paymentMethod || '').toLowerCase();
    if (method.includes('efectivo')) {
      cashTotal += p;
    } else if (method.includes('tarjeta')) {
      cardTotal += p;
    } else if (method.includes('cortesía') || method.includes('gratuito')) {
      // 0
    } else {
      digitalTotal += p;
    }
  });

  const kpiCash = document.getElementById('sellerKpiCash');
  if (kpiCash) kpiCash.textContent = `${currency}${cashTotal.toLocaleString()}`;
  const kpiDig = document.getElementById('sellerKpiDigital');
  if (kpiDig) kpiDig.textContent = `${currency}${digitalTotal.toLocaleString()}`;
  const kpiCard = document.getElementById('sellerKpiCard');
  if (kpiCard) kpiCard.textContent = `${currency}${cardTotal.toLocaleString()}`;
  const kpiTot = document.getElementById('sellerKpiTotal');
  if (kpiTot) kpiTot.textContent = `${currency}${grandTotal.toLocaleString()}`;
  const kpiTkts = document.getElementById('sellerKpiTickets');
  if (kpiTkts) kpiTkts.textContent = myTickets.length;
  const recentCountEl = document.getElementById('sellerRecentCount');
  if (recentCountEl) recentCountEl.textContent = `${myTickets.length} boletos emitidos por ${seller}`;

  const tbody = document.getElementById('sellerTicketsTableBody');
  if (!tbody) return;

  if (myTickets.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          Aún no has realizado ventas en este turno. Abre el Punto de Venta para comenzar.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = myTickets.map(t => {
    const time = new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <tr>
        <td style="font-family: monospace; font-weight: 700; color: #38bdf8;">${t.id}</td>
        <td style="font-weight: 600;">${escapeHtml(t.attendeeName)}</td>
        <td>${escapeHtml(t.type)}</td>
        <td style="color: #34d399; font-weight: 700;">${currency}${t.price}</td>
        <td style="font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(t.paymentMethod || 'Efectivo')}</td>
        <td style="font-size: 0.85rem;">${time}</td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 0.35rem;">
            <button class="btn btn-secondary btn-sm" onclick="openTicketModal('${t.id}')" title="Ver Boleto">
              🎟️
            </button>
            <button class="btn btn-secondary btn-sm" onclick="printSingleTicketReceipt('${t.id}')" title="Imprimir Recibo">
              🖨️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function printSingleTicketReceipt(ticketId) {
  const ticket = appState.tickets.find(t => t.id === ticketId);
  if (!ticket) return;
  appState.lastSoldTickets = [ticket];
  printPosThermalReceipt();
}

function printShiftClosingReport() {
  const seller = appState.sellerName || 'Taquilla 1';
  const ev = appState.event || {};
  const currency = ev.currency || '$';

  const myTickets = appState.tickets.filter(t => (t.soldBy || 'Administración') === seller);

  let cashTotal = 0;
  let digitalTotal = 0;
  let cardTotal = 0;
  let grandTotal = 0;

  myTickets.forEach(t => {
    if (t.status === 'cancelled') return;
    const p = t.price || 0;
    grandTotal += p;
    const method = (t.paymentMethod || '').toLowerCase();
    if (method.includes('efectivo')) {
      cashTotal += p;
    } else if (method.includes('tarjeta')) {
      cardTotal += p;
    } else if (!method.includes('cortesía')) {
      digitalTotal += p;
    }
  });

  document.getElementById('shiftReceiptEvent').textContent = ev.name || 'Mi Gran Evento';
  document.getElementById('shiftReceiptSeller').textContent = seller;
  document.getElementById('shiftReceiptDate').textContent = new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  document.getElementById('shiftReceiptCount').textContent = `${myTickets.length} entradas emitidas`;

  document.getElementById('shiftReceiptCash').textContent = `${currency}${cashTotal.toLocaleString()}`;
  document.getElementById('shiftReceiptDigital').textContent = `${currency}${digitalTotal.toLocaleString()}`;
  document.getElementById('shiftReceiptCard').textContent = `${currency}${cardTotal.toLocaleString()}`;
  document.getElementById('shiftReceiptTotal').textContent = `${currency}${grandTotal.toLocaleString()}`;

  window.print();
}

// Global exposure for inline HTML callbacks in POS & Seller Box
window.addTicketToPos = addTicketToPos;
window.removeTicketFromPos = removeTicketFromPos;
window.clearPosCart = clearPosCart;
window.togglePosBuyerFields = togglePosBuyerFields;
window.selectPosPaymentMethod = selectPosPaymentMethod;
window.calculatePosChange = calculatePosChange;
window.addQuickCash = addQuickCash;
window.setExactCash = setExactCash;
window.submitPosSale = submitPosSale;
window.closePosSuccessModal = closePosSuccessModal;
window.sendPosTicketWhatsApp = sendPosTicketWhatsApp;
window.printPosThermalReceipt = printPosThermalReceipt;
window.copyPosTicketLink = copyPosTicketLink;
window.printShiftClosingReport = printShiftClosingReport;
window.printSingleTicketReceipt = printSingleTicketReceipt;
window.switchTab = switchTab;

