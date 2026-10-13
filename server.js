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
    return JSON.parse(fs.readFileSync(EVENT_FILE, 'utf-8'));
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

  return {
    totalIssued,
    activeCount: activeTickets.length,
    enteredCount: usedTickets.length,
    pendingCount: pendingTickets.length,
    cancelledCount: tickets.filter(t => t.status === 'cancelled').length,
    totalRevenue,
    fraudAttempts,
    capacity: event.capacity,
    occupancyPercent: event.capacity > 0 ? Math.round((usedTickets.length / event.capacity) * 100) : 0
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

// Create new ticket
app.post('/api/tickets', async (req, res) => {
  try {
    const { attendeeName, attendeePhone, attendeeDni, attendeeEmail, type, price, paymentMethod, notes } = req.body;

    if (!attendeeName || !attendeeName.trim()) {
      return res.status(400).json({ error: "El nombre del asistente es obligatorio." });
    }

    const tickets = getTickets();
    const event = getEventData();

    // Unique secure ID: TKT-XXXX-XXXX
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const randomHex2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const ticketId = `TKT-${randomHex}-${randomHex2}`;
    
    // Antifraud secret hash
    const secretHash = crypto.createHash('sha256').update(`${ticketId}:${Date.now()}:${attendeeName}`).digest('hex').substring(0, 16);

    // QR Payload contains JSON or unique ticket verification code
    const qrPayload = JSON.stringify({
      id: ticketId,
      token: secretHash,
      event: event.name
    });

    // Generate crisp QR Data URL (high error correction level 'H' so it scans even if screen is dimmed or scratched)
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    const newTicket = {
      id: ticketId,
      secretToken: secretHash,
      qrDataUrl,
      attendeeName: attendeeName.trim(),
      attendeePhone: attendeePhone ? attendeePhone.trim() : '',
      attendeeDni: attendeeDni ? attendeeDni.trim() : '',
      attendeeEmail: attendeeEmail ? attendeeEmail.trim() : '',
      type: type || 'General',
      price: Number(price) >= 0 ? Number(price) : 0,
      paymentMethod: paymentMethod || 'Efectivo',
      notes: notes ? notes.trim() : '',
      status: 'valid', // 'valid', 'used', 'cancelled'
      createdAt: new Date().toISOString(),
      usedAt: null,
      scanCount: 0,
      scanHistory: []
    };

    tickets.unshift(newTicket);
    saveTickets(tickets);

    const stats = calculateStats(tickets, event);
    broadcastEvent('TICKET_CREATED', { ticket: newTicket, stats });

    res.status(201).json({ success: true, ticket: newTicket, stats });
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
  csv += "Folio Boleto,Nombre Asistente,DNI / Documento,Telefono,Tipo Entrada,Precio,Metodo Pago,Estado,Fecha Emision,Hora Ingreso,Veces Escaneado\n";

  tickets.forEach(t => {
    const estado = t.status === 'valid' ? 'Por Ingresar' : (t.status === 'used' ? 'INGRESADO' : 'Cancelado');
    const precio = t.price || 0;
    const ingreso = t.usedAt ? new Date(t.usedAt).toLocaleString() : 'N/A';
    const emision = new Date(t.createdAt).toLocaleString();
    csv += `"${t.id}","${t.attendeeName}","${t.attendeeDni || ''}","${t.attendeePhone || ''}","${t.type}",${precio},"${t.paymentMethod}","${estado}","${emision}","${ingreso}",${t.scanCount || 0}\n`;
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
