const { sendMessage, sendMessageWithMedia } = require('./twilioService');

const AMC_WHATSAPP = `whatsapp:${process.env.AMC_WHATSAPP_NUMBER}`;

/**
 * Sends a WhatsApp alert to the AMC control room number
 * with full ticket details and the waste image.
 */
async function notifyAMC(ticket) {
  const mapsLink = ticket.lat && ticket.lng
    ? `https://maps.google.com/?q=${ticket.lat},${ticket.lng}`
    : 'Location not available';

  const severityEmoji = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢' }[ticket.severity] || '⚪';

  const message =
    `🚨 *NEW WASTE COMPLAINT*\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🎫 Ticket: *${ticket.id}*\n` +
    `${severityEmoji} Severity: *${ticket.severity}*\n` +
    `🗑️ Type: ${ticket.wasteType}\n` +
    `📍 Ward: ${ticket.ward}\n` +
    `🗺️ Location: ${mapsLink}\n` +
    `🕐 Reported: ${new Date(ticket.createdAt).toLocaleString('en-IN')}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `After cleaning, reply:\n` +
    `*DONE ${ticket.id}*\n` +
    `with a photo of the cleaned area.\n\n` +
    `_CleanAlert Civic Bot_`;

  try {
    // Send text alert + waste photo to AMC
    await sendMessageWithMedia(AMC_WHATSAPP, message, ticket.imageUrl);
    console.log(`[AMC] Notified for ticket ${ticket.id}`);
  } catch (err) {
    // Fallback: send text only if image send fails
    console.warn('[AMC] Media send failed, sending text only:', err.message);
    await sendMessage(AMC_WHATSAPP, message);
  }
}

module.exports = { notifyAMC };
