const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Data directory and paths
const DATA_DIR = path.join(__dirname, 'data');
const EVENT_FILE = path.join(DATA_DIR, 'event.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial default configuration
const defaultEvent = {
  name: "Mi Gran Evento 2026",
  subtitle: "Acceso Exclusivo & Experiencia Única",
  date: "2026-11-20T20:00",
  location: "Auditorio Principal / Recinto del Evento",
  capacity: 300,
  currency: "$",
  gatekeeperPin: "1234",
  sellerPin: "4321",
  adminPassword: "admin123",
  sellers: [
    { id: "seller-1", name: "Taquilla 1", pin: "4321", active: true, createdAt: new Date().toISOString() }
  ],
  ticketTypes: [
    { id: "general", name: "General", price: 50 },
    { id: "vip", name: "VIP", price: 100 },
    { id: "preventa", name: "Preventa", price: 35 },
    { id: "cortesia", name: "Cortesía", price: 0 }
  ]
};

function getEventData() {
  if (!fs.existsSync(EVENT_FILE)) {
    fs.writeFileSync(EVENT_FILE, JSON.stringify(defaultEvent, null, 2), 'utf-8');
    return defaultEvent;
  }
  try {
    const data = JSON.parse(fs.readFileSync(EVENT_FILE, 'utf-8'));
    if (!data.gatekeeperPin) data.gatekeeperPin = "1234";
    if (!data.sellerPin) data.sellerPin = "4321";
    if (!data.adminPassword) data.adminPassword = "admin123";
    if (!Array.isArray(data.sellers) || data.sellers.length === 0) {
      data.sellers = [
        { id: "seller-1", name: "Taquilla 1", pin: data.sellerPin || "4321", active: true, createdAt: new Date().toISOString() }
      ];
    }
    return data;
  } catch (err) {
    return defaultEvent;
  }
}

function saveEventData(data) {
  fs.writeFileSync(EVENT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getTickets() {
  if (!fs.existsSync(TICKETS_FILE)) {
    fs.writeFileSync(TICKETS_FILE, JSON.stringify([], null, 2), 'utf-8');
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function saveTickets(tickets) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2), 'utf-8');
}

// Server-Sent Events subscribers
let sseClients = [];

function broadcastEvent(type, data) {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(payload);
    } catch (e) {
      // client disconnected
    }
  });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file fallback (allows uploading flat style.css and app.js to public/ or nested)
app.get('/css/style.css', (req, res, next) => {
  const nested = path.join(__dirname, 'public', 'css', 'style.css');
  const flat = path.join(__dirname, 'public', 'style.css');
  if (fs.existsSync(nested)) return res.sendFile(nested);
  if (fs.existsSync(flat)) return res.sendFile(flat);
  next();
});

app.get('/js/app.js', (req, res, next) => {
  const nested = path.join(__dirname, 'public', 'js', 'app.js');
  const flat = path.join(__dirname, 'public', 'app.js');
  if (fs.existsSync(nested)) return res.sendFile(nested);
  if (fs.existsSync(flat)) return res.sendFile(flat);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// SSE Endpoint for live real-time sync across all devices
app.get('/api/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// Event Settings API
app.get('/api/event', (req, res) => {
  res.json(getEventData());
});

app.post('/api/event', (req, res) => {
  const current = getEventData();
  const updated = {
    ...current,
    name: req.body.name !== undefined ? req.body.name.trim() : current.name,
    subtitle: req.body.subtitle !== undefined ? req.body.subtitle.trim() : current.subtitle,
    date: req.body.date !== undefined ? req.body.date : current.date,
    location: req.body.location !== undefined ? req.body.location.trim() : current.location,
    capacity: parseInt(req.body.capacity, 10) || current.capacity || 100,
    currency: req.body.currency !== undefined ? req.body.currency.trim() : (current.currency || '$')
  };

  // Update PIN if provided (must be 4 digits)
  if (req.body.gatekeeperPin !== undefined) {
    const pin = String(req.body.gatekeeperPin).trim();
    if (/^\d{4}$/.test(pin)) {
      updated.gatekeeperPin = pin;
    }
  }

  // Update seller PIN if provided (must be 4 digits)
  if (req.body.sellerPin !== undefined) {
    const sPin = String(req.body.sellerPin).trim();
    if (/^\d{4}$/.test(sPin)) {
      updated.sellerPin = sPin;
    }
  }

  // Update admin password if provided (min 4 characters)
  if (req.body.adminPassword !== undefined && String(req.body.adminPassword).trim().length >= 4) {
    updated.adminPassword = String(req.body.adminPassword).trim();
  }

  if (Array.isArray(req.body.ticketTypes) && req.body.ticketTypes.length > 0) {
    updated.ticketTypes = req.body.ticketTypes.map((t, idx) => ({
      id: (t.id || t.name || `tipo-${idx + 1}`).toLowerCase().replace(/[^a-z0-9]/gi, '-') || `tipo-${idx + 1}`,
      name: (t.name || 'Entrada').trim(),
      price: Math.max(0, Number(t.price) || 0)
    })).filter(t => t.name.length > 0);
  }

  saveEventData(updated);
  broadcastEvent('EVENT_UPDATED', updated);
  res.json({ success: true, event: updated });
});

// Sellers Management APIs
app.get('/api/sellers', (req, res) => {
  const event = getEventData();
  const tickets = getTickets();
  const activeTickets = tickets.filter(t => t.status !== 'cancelled');

  const sellersWithStats = (event.sellers || []).map(seller => {
    const sellerTickets = activeTickets.filter(t => 
      (t.sellerId && t.sellerId === seller.id) ||
      (t.soldBy && t.soldBy.toLowerCase() === seller.name.toLowerCase())
    );
    const ticketsSold = sellerTickets.length;
    const totalRevenue = sellerTickets.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
    const cashRevenue = sellerTickets.filter(t => t.paymentMethod === 'Efectivo').reduce((sum, t) => sum + (Number(t.price) || 0), 0);
    const digitalRevenue = totalRevenue - cashRevenue;
    const enteredCount = sellerTickets.filter(t => t.status === 'used').length;

    return {
      id: seller.id,
      name: seller.name,
      pin: seller.pin,
      active: seller.active !== false,
      createdAt: seller.createdAt || new Date().toISOString(),
      stats: {
        ticketsSold,
        totalRevenue,
        cashRevenue,
        digitalRevenue,
        enteredCount
      }
    };
  });

  res.json({ sellers: sellersWithStats });
});

app.post('/api/sellers', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "El nombre del vendedor es obligatorio." });
  }
  const cleanPin = String(pin || '').trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    return res.status(400).json({ error: "El PIN debe tener exactamente 4 dígitos numéricos." });
  }

  const event = getEventData();
  if (!Array.isArray(event.sellers)) event.sellers = [];

  const pinExists = event.sellers.some(s => s.pin === cleanPin);
  if (pinExists) {
    return res.status(400).json({ error: "Ese código PIN ya está asignado a otro vendedor. Asigne un PIN único." });
  }

  const newSeller = {
    id: `seller-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: String(name).trim(),
    pin: cleanPin,
    active: true,
    createdAt: new Date().toISOString()
  };

  event.sellers.push(newSeller);
  saveEventData(event);
  broadcastEvent('SELLERS_UPDATED', { sellers: event.sellers });

  res.json({ success: true, seller: newSeller });
});

app.put('/api/sellers/:id', (req, res) => {
  const { id } = req.params;
  const { name, pin, active } = req.body;

  const event = getEventData();
  if (!Array.isArray(event.sellers)) event.sellers = [];

  const sellerIndex = event.sellers.findIndex(s => s.id === id);
  if (sellerIndex === -1) {
    return res.status(404).json({ error: "Vendedor no encontrado." });
  }

  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) return res.status(400).json({ error: "El nombre no puede estar vacío." });
    event.sellers[sellerIndex].name = cleanName;
  }

  if (pin !== undefined) {
    const cleanPin = String(pin).trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      return res.status(400).json({ error: "El PIN debe tener 4 dígitos numéricos." });
    }
    const pinExists = event.sellers.some(s => s.id !== id && s.pin === cleanPin);
    if (pinExists) {
      return res.status(400).json({ error: "El PIN ya pertenece a otro vendedor." });
    }
    event.sellers[sellerIndex].pin = cleanPin;
  }

  if (active !== undefined) {
    event.sellers[sellerIndex].active = Boolean(active);
  }

  saveEventData(event);
  broadcastEvent('SELLERS_UPDATED', { sellers: event.sellers });

  res.json({ success: true, seller: event.sellers[sellerIndex] });
});

app.delete('/api/sellers/:id', (req, res) => {
  const { id } = req.params;
  const event = getEventData();
  if (!Array.isArray(event.sellers)) event.sellers = [];

  const prevLen = event.sellers.length;
  event.sellers = event.sellers.filter(s => s.id !== id);

  if (event.sellers.length === prevLen) {
    return res.status(404).json({ error: "Vendedor no encontrado." });
  }

  saveEventData(event);
  broadcastEvent('SELLERS_UPDATED', { sellers: event.sellers });

  res.json({ success: true, message: "Vendedor eliminado correctamente." });
});

// Authentication APIs
app.post('/api/auth/gatekeeper', (req, res) => {
  const { pin } = req.body;
  const event = getEventData();
  const currentPin = String(event.gatekeeperPin || '1234').trim();

  if (String(pin).trim() === currentPin) {
    res.json({ success: true, role: 'gatekeeper', eventName: event.name });
  } else {
    res.status(401).json({ success: false, error: "Código PIN incorrecto. Ingrese el código de 4 cifras asignado para portería." });
  }
});

app.post('/api/auth/seller', (req, res) => {
  const { pin, sellerName } = req.body;
  const event = getEventData();
  const cleanPin = String(pin || '').trim();

  // 1. Search in individual sellers list
  const sellers = Array.isArray(event.sellers) ? event.sellers : [];
  const matchedSeller = sellers.find(s => s.pin === cleanPin && s.active !== false);

  if (matchedSeller) {
    return res.json({
      success: true,
      role: 'seller',
      sellerId: matchedSeller.id,
      sellerName: matchedSeller.name,
      eventName: event.name
    });
  }

  // 2. Fallback against default sellerPin
  const defaultPin = String(event.sellerPin || '4321').trim();
  if (cleanPin === defaultPin) {
    const resolvedName = (sellerName && String(sellerName).trim()) ? String(sellerName).trim() : 'Taquilla 1';
    return res.json({
      success: true,
      role: 'seller',
      sellerId: 'seller-default',
      sellerName: resolvedName,
      eventName: event.name
    });
  }

  res.status(401).json({
    success: false,
    error: "PIN de vendedor no reconocido o inactivo. Contacte al administrador para verificar su código."
  });
});

app.post('/api/auth/admin', (req, res) => {
  const { password } = req.body;
  const event = getEventData();
  const currentPassword = String(event.adminPassword || 'admin123').trim();

  if (String(password).trim() === currentPassword) {
    res.json({ success: true, role: 'admin', eventName: event.name });
  } else {
    res.status(401).json({ success: false, error: "Contraseña de administrador incorrecta." });
  }
});

// Calculate metrics
function calculateStats(tickets, event) {
  const totalIssued = tickets.length;
  const activeTickets = tickets.filter(t => t.status !== 'cancelled');
  const usedTickets = activeTickets.filter(t => t.status === 'used');
  const pendingTickets = activeTickets.filter(t => t.status === 'valid');
  const totalRevenue = activeTickets.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
  
  // Count fraud / duplicate scan attempts
  const fraudAttempts = tickets.reduce((sum, t) => {
    const extraScans = (t.scanCount || 0) > 1 ? (t.scanCount - 1) : 0;
    return sum + extraScans;
  }, 0);

  // Sales breakdown by seller
  const salesBySellerMap = {};
  if (Array.isArray(event.sellers)) {
    event.sellers.forEach(s => {
      salesBySellerMap[s.name] = {
        sellerId: s.id,
        sellerName: s.name,
        ticketsCount: 0,
        totalRevenue: 0,
        cashRevenue: 0,
        digitalRevenue: 0,
        active: s.active !== false
      };
    });
  }

  activeTickets.forEach(t => {
    const name = t.soldBy || 'Administración';
    if (!salesBySellerMap[name]) {
      salesBySellerMap[name] = {
        sellerId: t.sellerId || null,
        sellerName: name,
        ticketsCount: 0,
        totalRevenue: 0,
        cashRevenue: 0,
        digitalRevenue: 0,
        active: true
      };
    }
    const s = salesBySellerMap[name];
    s.ticketsCount += 1;
    const price = Number(t.price) || 0;
    s.totalRevenue += price;
    if (t.paymentMethod === 'Efectivo') {
      s.cashRevenue += price;
    } else {
      s.digitalRevenue += price;
    }
  });

  const salesBySeller = Object.values(salesBySellerMap).sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    totalIssued,
    activeCount: activeTickets.length,
    enteredCount: usedTickets.length,
    pendingCount: pendingTickets.length,
    cancelledCount: tickets.filter(t => t.status === 'cancelled').length,
    totalRevenue,
    fraudAttempts,
    capacity: event.capacity,
    occupancyPercent: event.capacity > 0 ? Math.round((usedTickets.length / event.capacity) * 100) : 0,
    salesBySeller
  };
}

// List all tickets with stats
app.get('/api/tickets', (req, res) => {
  const tickets = getTickets();
  const event = getEventData();
  const stats = calculateStats(tickets, event);
  res.json({
    tickets,
    stats,
    event
  });
});

// Create new ticket (Simplified: Name and DNI are optional, supports quantity batch creation!)
app.post('/api/tickets', async (req, res) => {
  try {
    const { attendeeName, attendeePhone, attendeeDni, attendeeEmail, type, price, paymentMethod, notes, quantity, soldBy, sellerId } = req.body;

    const tickets = getTickets();
    const event = getEventData();
    const count = Math.max(1, Math.min(50, parseInt(quantity, 10) || 1));

    // Validar aforo máximo del evento
    const activeTicketsCount = tickets.filter(t => t.status !== 'cancelled').length;
    if (event.capacity && (activeTicketsCount + count) > event.capacity) {
      const remaining = Math.max(0, event.capacity - activeTicketsCount);
      return res.status(400).json({
        error: `Aforo máximo superado. Aforo límite: ${event.capacity}. Boletos activos: ${activeTicketsCount}. Cupos disponibles: ${remaining}.`
      });
    }

    const createdTickets = [];

    for (let i = 0; i < count; i++) {
      // Unique secure ID: TKT-XXXX-XXXX
      const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
      const randomHex2 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const ticketId = `TKT-${randomHex}-${randomHex2}`;

      // Final attendee name: default to friendly bearer name if not provided
      let finalName = '';
      const ticketTypeLabel = type || 'General';
      if (attendeeName && attendeeName.trim()) {
        finalName = count > 1 ? `${attendeeName.trim()} (#${i + 1})` : attendeeName.trim();
      } else {
        const nextOrderNum = tickets.length + createdTickets.length + 1;
        finalName = `Portador Entrada (${ticketTypeLabel}) #${nextOrderNum}`;
      }

      // Antifraud secret hash
      const secretHash = crypto.createHash('sha256').update(`${ticketId}:${Date.now()}:${i}:${finalName}`).digest('hex').substring(0, 16);

      // QR Payload contains JSON verification code
      const qrPayload = JSON.stringify({
        id: ticketId,
        token: secretHash,
        event: event.name
      });

      // Generate crisp QR Data URL
      const qrDataUrl = await QRCode.toDataURL(qrPayload, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 400,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });

      const resolvedSoldBy = (soldBy && String(soldBy).trim()) ? String(soldBy).trim() : 'Administración';

      const newTicket = {
        id: ticketId,
        secretToken: secretHash,
        qrDataUrl,
        attendeeName: finalName,
        attendeePhone: attendeePhone ? attendeePhone.trim() : '',
        attendeeDni: attendeeDni ? attendeeDni.trim() : '',
        attendeeEmail: attendeeEmail ? attendeeEmail.trim() : '',
        type: ticketTypeLabel,
        price: Number(price) >= 0 ? Number(price) : 0,
        paymentMethod: paymentMethod || 'Efectivo',
        notes: notes ? notes.trim() : '',
        soldBy: resolvedSoldBy,
        sellerId: sellerId || null,
        status: 'valid', // 'valid', 'used', 'cancelled'
        createdAt: new Date().toISOString(),
        usedAt: null,
        scanCount: 0,
        scanHistory: []
      };

      createdTickets.push(newTicket);
      tickets.unshift(newTicket);
    }

    saveTickets(tickets);

    const stats = calculateStats(tickets, event);
    createdTickets.forEach(t => {
      broadcastEvent('TICKET_CREATED', { ticket: t, stats });
    });

    res.status(201).json({
      success: true,
      ticket: createdTickets[0],
      tickets: createdTickets,
      count: createdTickets.length,
      stats
    });
  } catch (err) {
    console.error("Error creating ticket:", err);
    res.status(500).json({ error: "Error al generar el boleto." });
  }
});

// Get single ticket details
app.get('/api/tickets/:id', (req, res) => {
  const tickets = getTickets();
  const ticket = tickets.find(t => t.id === req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: "Boleto no encontrado." });
  }
  const event = getEventData();
  res.json({ ticket, event });
});

// SCANNER / ACCESS CONTROL - ANTIFRAUD VERIFICATION
app.post('/api/scan', (req, res) => {
  const { code, gatekeeper } = req.body;
  if (!code) {
    return res.status(400).json({ status: 'invalid', message: "No se proporcionó ningún código." });
  }

  let searchId = code.trim();
  let scannedToken = null;

  // If code is JSON payload from QR
  try {
    const parsed = JSON.parse(code);
    if (parsed && parsed.id) {
      searchId = parsed.id;
      scannedToken = parsed.token;
    }
  } catch (e) {
    // Normal raw ID scan
  }

  const tickets = getTickets();
  const event = getEventData();
  const ticketIndex = tickets.findIndex(t => t.id.toUpperCase() === searchId.toUpperCase() || t.attendeeDni === searchId);

  if (ticketIndex === -1) {
    return res.json({
      status: 'invalid',
      code: searchId,
      title: "BOLETO NO ENCONTRADO / FALSIFICADO",
      message: "Este código no existe en la base de datos de este evento. Posible boleto falso o de otro evento.",
      color: "yellow"
    });
  }

  const ticket = tickets[ticketIndex];
  const nowStr = new Date().toISOString();

  // Case 0: TRANSFERRED OLD QR DETECTED (FRAUD PREVENTION!)
  if (scannedToken && ticket.transferHistory && ticket.transferHistory.length > 0) {
    const matchedOldTransfer = ticket.transferHistory.find(th => th.oldToken === scannedToken);
    if (matchedOldTransfer) {
      ticket.scanCount = (ticket.scanCount || 0) + 1;
      ticket.scanHistory.push({
        timestamp: nowStr,
        result: 'fraud_transferred_old_code',
        gatekeeper: gatekeeper || 'Puerta Principal'
      });
      saveTickets(tickets);

      const stats = calculateStats(tickets, event);
      broadcastEvent('FRAUD_DETECTED', { ticket, stats });

      return res.json({
        status: 'fraud_transferred_old_code',
        ticket,
        title: "¡ALERTA! BOLETO TRANSFERIDO (CÓDIGO VIEJO)",
        message: `Este código QR pertenecía a ${matchedOldTransfer.fromName}, pero la entrada fue TRANSFERIDA a ${ticket.attendeeName} el ${new Date(matchedOldTransfer.transferredAt).toLocaleDateString()} a las ${new Date(matchedOldTransfer.transferredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Este código viejo quedó DESTRUIDO e INVALIDADO. Solo el nuevo titular (${ticket.attendeeName}) tiene el código QR válido.`,
        color: "red",
        transferInfo: matchedOldTransfer
      });
    }
  }

  // Case 1: Cancelled ticket
  if (ticket.status === 'cancelled') {
    ticket.scanCount = (ticket.scanCount || 0) + 1;
    ticket.scanHistory.push({
      timestamp: nowStr,
      result: 'cancelled',
      gatekeeper: gatekeeper || 'Puerta'
    });
    saveTickets(tickets);
    return res.json({
      status: 'cancelled',
      ticket,
      title: "BOLETO CANCELADO",
      message: "Este boleto fue cancelado previamente por la administración.",
      color: "red"
    });
  }

  // Case 2: ALREADY USED - FRAUD ATTEMPT!
  if (ticket.status === 'used') {
    ticket.scanCount = (ticket.scanCount || 0) + 1;
    ticket.scanHistory.push({
      timestamp: nowStr,
      result: 'fraud_already_used',
      gatekeeper: gatekeeper || 'Puerta'
    });
    saveTickets(tickets);

    const stats = calculateStats(tickets, event);
    broadcastEvent('FRAUD_DETECTED', { ticket, stats });

    return res.json({
      status: 'fraud_already_used',
      ticket,
      title: "¡ALERTA DE FRAUDE! BOLETO YA UTILIZADO",
      message: `Este boleto YA FUE INGRESADO previamente el ${new Date(ticket.usedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. No se permite reingreso.`,
      color: "red",
      firstUsedAt: ticket.usedAt,
      scanCount: ticket.scanCount
    });
  }

  // Case 3: SUCCESS - VALID TICKET FIRST USE
  if (ticket.status === 'valid') {
    ticket.status = 'used';
    ticket.usedAt = nowStr;
    ticket.scanCount = 1;
    ticket.gatekeeper = gatekeeper || 'Puerta Principal';
    ticket.scanHistory.push({
      timestamp: nowStr,
      result: 'success',
      gatekeeper: ticket.gatekeeper
    });

    tickets[ticketIndex] = ticket;
    saveTickets(tickets);

    const stats = calculateStats(tickets, event);
    broadcastEvent('TICKET_SCANNED', { ticket, stats });

    return res.json({
      status: 'success',
      ticket,
      title: "ACCESO PERMITIDO",
      message: `¡Bienvenido(a), ${ticket.attendeeName}! Boleto validado correctamente.`,
      color: "green",
      stats
    });
  }

  return res.status(500).json({ error: "Estado desconocido del boleto." });
});

// Transfer ticket to a new attendee with complete QR regeneration
app.post('/api/tickets/:id/transfer', async (req, res) => {
  try {
    const { newAttendeeName, newAttendeePhone, newAttendeeDni, reason } = req.body;

    if (!newAttendeeName || !newAttendeeName.trim()) {
      return res.status(400).json({ error: "El nombre del nuevo titular es obligatorio." });
    }

    const tickets = getTickets();
    const event = getEventData();
    const ticketIndex = tickets.findIndex(t => t.id === req.params.id);

    if (ticketIndex === -1) {
      return res.status(404).json({ error: "Boleto no encontrado." });
    }

    const ticket = tickets[ticketIndex];

    if (ticket.status === 'used') {
      return res.status(400).json({ error: "No es posible transferir un boleto que YA FUE INGRESADO al evento." });
    }

    if (ticket.status === 'cancelled') {
      return res.status(400).json({ error: "No es posible transferir un boleto cancelado." });
    }

    // Save transfer record in history
    if (!ticket.transferHistory) {
      ticket.transferHistory = [];
    }

    const nowIso = new Date().toISOString();
    const oldOwnerRecord = {
      fromName: ticket.attendeeName,
      fromPhone: ticket.attendeePhone || '',
      fromDni: ticket.attendeeDni || '',
      toName: newAttendeeName.trim(),
      toPhone: newAttendeePhone ? newAttendeePhone.trim() : '',
      toDni: newAttendeeDni ? newAttendeeDni.trim() : '',
      transferredAt: nowIso,
      oldToken: ticket.secretToken,
      reason: reason ? reason.trim() : 'Transferencia autorizada'
    };

    ticket.transferHistory.push(oldOwnerRecord);

    // Generate NEW cryptographic secret token (invalidating previous QR permanently!)
    const newSecretHash = crypto.createHash('sha256').update(`${ticket.id}:${Date.now()}:${newAttendeeName}`).digest('hex').substring(0, 16);

    const newQrPayload = JSON.stringify({
      id: ticket.id,
      token: newSecretHash,
      event: event.name
    });

    const newQrDataUrl = await QRCode.toDataURL(newQrPayload, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      color: { dark: '#0f172a', light: '#ffffff' }
    });

    // Update ticket owner and credentials
    ticket.attendeeName = newAttendeeName.trim();
    ticket.attendeePhone = newAttendeePhone ? newAttendeePhone.trim() : '';
    ticket.attendeeDni = newAttendeeDni ? newAttendeeDni.trim() : '';
    ticket.secretToken = newSecretHash;
    ticket.qrDataUrl = newQrDataUrl;
    ticket.updatedAt = nowIso;

    tickets[ticketIndex] = ticket;
    saveTickets(tickets);

    const stats = calculateStats(tickets, event);
    broadcastEvent('TICKET_UPDATED', { ticket, stats });

    res.json({
      success: true,
      ticket,
      stats,
      message: "Boleto transferido con éxito. El código QR anterior ha sido invalidado de forma permanente."
    });
  } catch (err) {
    console.error("Error al transferir boleto:", err);
    res.status(500).json({ error: "Error interno al transferir el boleto." });
  }
});

// Revert ticket to valid (for exit/re-entry or gatekeeper correction)
app.post('/api/tickets/:id/revert', (req, res) => {
  const tickets = getTickets();
  const ticketIndex = tickets.findIndex(t => t.id === req.params.id);
  if (ticketIndex === -1) {
    return res.status(404).json({ error: "Boleto no encontrado." });
  }

  tickets[ticketIndex].status = 'valid';
  tickets[ticketIndex].usedAt = null;
  tickets[ticketIndex].scanHistory.push({
    timestamp: new Date().toISOString(),
    result: 'reverted',
    reason: req.body.reason || 'Reingreso autorizado o reinicio manual'
  });

  saveTickets(tickets);
  const event = getEventData();
  const stats = calculateStats(tickets, event);
  broadcastEvent('TICKET_UPDATED', { ticket: tickets[ticketIndex], stats });

  res.json({ success: true, ticket: tickets[ticketIndex], stats });
});

// Cancel ticket
app.post('/api/tickets/:id/cancel', (req, res) => {
  const tickets = getTickets();
  const ticketIndex = tickets.findIndex(t => t.id === req.params.id);
  if (ticketIndex === -1) {
    return res.status(404).json({ error: "Boleto no encontrado." });
  }

  tickets[ticketIndex].status = 'cancelled';
  saveTickets(tickets);
  const event = getEventData();
  const stats = calculateStats(tickets, event);
  broadcastEvent('TICKET_UPDATED', { ticket: tickets[ticketIndex], stats });

  res.json({ success: true, ticket: tickets[ticketIndex], stats });
});

// Load demo data
app.post('/api/demo-data', async (req, res) => {
  const tickets = getTickets();
  const event = getEventData();

  const demoAttendees = [
    { name: "Sofía Valentina Ramirez", phone: "+57 311 555 0192", dni: "10283749", type: "VIP", price: 100, method: "Transferencia" },
    { name: "Alejandro Gómez Pardo", phone: "+57 300 234 8811", dni: "98765432", type: "General", price: 50, method: "Efectivo" },
    { name: "Camila Torres Restrepo", phone: "+57 315 889 1204", dni: "11438920", type: "Preventa", price: 35, method: "Nequi" },
    { name: "Mateo Herrera Silva", phone: "+57 320 445 7789", dni: "10328901", type: "VIP", price: 100, method: "Tarjeta" },
    { name: "Mariana Restrepo López", phone: "+57 312 998 3344", dni: "10984521", type: "Cortesía", price: 0, method: "Invitación" }
  ];

  for (const person of demoAttendees) {
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const randomHex2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const ticketId = `TKT-${randomHex}-${randomHex2}`;
    const secretHash = crypto.createHash('sha256').update(`${ticketId}:${person.name}`).digest('hex').substring(0, 16);

    const qrPayload = JSON.stringify({
      id: ticketId,
      token: secretHash,
      event: event.name
    });

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      color: { dark: '#0f172a', light: '#ffffff' }
    });

    tickets.push({
      id: ticketId,
      secretToken: secretHash,
      qrDataUrl,
      attendeeName: person.name,
      attendeePhone: person.phone,
      attendeeDni: person.dni,
      attendeeEmail: '',
      type: person.type,
      price: person.price,
      paymentMethod: person.method,
      notes: 'Boleto de demostración',
      status: 'valid',
      createdAt: new Date().toISOString(),
      usedAt: null,
      scanCount: 0,
      scanHistory: []
    });
  }

  saveTickets(tickets);
  const stats = calculateStats(tickets, event);
  broadcastEvent('DATA_RESET', { stats });

  res.json({ success: true, count: demoAttendees.length, stats });
});

// Clear all tickets (Factory reset)
app.post('/api/clear-tickets', (req, res) => {
  saveTickets([]);
  const event = getEventData();
  const stats = calculateStats([], event);
  broadcastEvent('DATA_RESET', { stats });
  res.json({ success: true, stats });
});

// CSV Export for Excel
app.get('/api/export/csv', (req, res) => {
  const tickets = getTickets();
  const event = getEventData();

  let csv = "\uFEFF"; // BOM for Excel UTF-8
  csv += "Folio Boleto,Nombre Asistente,DNI / Documento,Telefono,Tipo Entrada,Precio,Metodo Pago,Vendido Por,Estado,Fecha Emision,Hora Ingreso,Veces Escaneado\n";

  tickets.forEach(t => {
    const estado = t.status === 'valid' ? 'Por Ingresar' : (t.status === 'used' ? 'INGRESADO' : 'Cancelado');
    const precio = t.price || 0;
    const ingreso = t.usedAt ? new Date(t.usedAt).toLocaleString() : 'N/A';
    const emision = new Date(t.createdAt).toLocaleString();
    const vendedor = t.soldBy || 'Administración';
    csv += `"${t.id}","${t.attendeeName}","${t.attendeeDni || ''}","${t.attendeePhone || ''}","${t.type}",${precio},"${t.paymentMethod}","${vendedor}","${estado}","${emision}","${ingreso}",${t.scanCount || 0}\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="asistentes_${event.name.replace(/\s+/g, '_')}.csv"`);
  res.send(csv);
});

// Fallback routing to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🎫 EventPass Antifraude - Servidor Activo`);
  console.log(`📡 Acceso local:       http://localhost:${PORT}`);
  console.log(`📱 Acceso en red local: http://<tu-ip-local>:${PORT}`);
  console.log(`=======================================================`);
});
