const { uploadToStorage } = require('../utils/storageUtils');
const { getWardFromCoords } = require('../utils/geoUtils');
const { v4: uuidv4 } = require('uuid');

// In-memory ticket store. Replace with PostgreSQL in production.
// Schema: { id, reporterPhone, lat, lng, ward, imageUrl, severity, wasteType, status, createdAt, assignedTo, cleanedImageUrl, resolvedAt }
const tickets = new Map();

async function createTicket({ reporterPhone, lat, lng, imageBase64, mimeType, mediaUrl, severity, wasteType }) {
  const id = 'CL-' + Date.now().toString().slice(-6);

  // Determine ward from GPS (falls back to "Unknown" if no GPS)
  const ward = (lat && lng) ? await getWardFromCoords(lat, lng) : 'Unknown';

  // Upload image to persistent storage so AMC can view it
  let imageUrl = mediaUrl; // fallback to Twilio URL
  try {
    imageUrl = await uploadToStorage(imageBase64, mimeType, id);
  } catch (e) {
    console.warn('[Storage] Upload failed, using Twilio URL as fallback:', e.message);
  }

  const ticket = {
    id,
    reporterPhone,
    lat: lat || null,
    lng: lng || null,
    ward,
    imageUrl,
    severity,
    wasteType,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    assignedTo: null,
    cleanedImageUrl: null,
    resolvedAt: null,
  };

  tickets.set(id, ticket);
  console.log(`[Ticket] Created ${id} | Ward: ${ward} | Severity: ${severity}`);
  return ticket;
}

async function getTicket(id) {
  return tickets.get(id.toUpperCase()) || null;
}

async function closeTicket(ticketId, workerPhone, cleanedMediaUrl) {
  const ticket = tickets.get(ticketId.toUpperCase());
  if (!ticket || ticket.status === 'RESOLVED') return null;

  ticket.status = 'RESOLVED';
  ticket.assignedTo = workerPhone;
  ticket.cleanedImageUrl = cleanedMediaUrl;
  ticket.resolvedAt = new Date().toISOString();

  tickets.set(ticket.id, ticket);
  console.log(`[Ticket] Closed ${ticketId} by worker ${workerPhone}`);
  return ticket;
}

async function updateTicketStatus(ticketId, status, assignedTo = null) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;
  ticket.status = status;
  if (assignedTo) ticket.assignedTo = assignedTo;
  tickets.set(ticketId, ticket);
  return ticket;
}

module.exports = { createTicket, getTicket, closeTicket, updateTicketStatus };
