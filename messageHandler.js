const { getSession, setSession, clearSession } = require('./services/sessionStore');
const { sendMessage, sendMessageWithMedia } = require('./services/twilioService');
const { validateWasteImage } = require('./services/aiService');
const { createTicket, closeTicket } = require('./services/ticketService');
const { notifyAMC } = require('./services/amcService');
const { downloadTwilioMedia } = require('./utils/mediaUtils');

/**
 * Entry point for all incoming WhatsApp messages from Twilio webhook.
 * Routes based on session state for each user.
 */
async function handleIncoming(req, res) {
  // Always respond 200 immediately so Twilio doesn't retry
  res.sendStatus(200);

  const from     = req.body.From;          // e.g. "whatsapp:+919876543210"
  const body     = (req.body.Body || '').trim().toLowerCase();
  const mediaUrl = req.body.MediaUrl0;     // First attached image (if any)
  const lat      = req.body.Latitude;      // Sent with WhatsApp Live Location
  const lng      = req.body.Longitude;

  const session = await getSession(from);
  const state   = session?.state || 'IDLE';

  console.log(`[${from}] state=${state} | body="${body}" | media=${!!mediaUrl} | gps=${lat},${lng}`);

  try {
    // ── Global commands (work in any state) ─────────────────────────────────
    if (body === 'hi' || body === 'hello' || body === 'start' || body === 'menu') {
      return await startFlow(from);
    }
    if (body === 'cancel' || body === 'stop') {
      await clearSession(from);
      return await sendMessage(from,
        '❌ Report cancelled.\n\nType *Hi* anytime to start a new report. 🙏');
    }
    if (body === 'status') {
      return await handleStatusCheck(from, session);
    }

    // ── State machine ────────────────────────────────────────────────────────
    switch (state) {
      case 'IDLE':
        return await startFlow(from);

      case 'AWAITING_IMAGE':
        if (mediaUrl) return await handleImageReceived(from, mediaUrl, session);
        return await sendMessage(from,
          '📸 Please *send a photo* of the waste.\n\nMake sure the area is clearly visible in the image.');

      case 'AWAITING_LOCATION':
        if (lat && lng) return await handleLocationReceived(from, lat, lng, session);
        if (body === 'skip') return await handleLocationSkipped(from, session);
        return await sendMessage(from,
          '📍 Please share your *live location* so I can route this to the right AMC ward.\n\n' +
          '*(Tap 📎 → Location → Send Current Location)*\n\n' +
          'Or type *skip* if you cannot share location (less accurate).');

      case 'AI_VALIDATING':
        return await sendMessage(from, '⏳ Still validating your image, please wait a moment...');

      case 'TICKET_OPEN':
        return await handleWorkerResponse(from, mediaUrl, body, session);

      default:
        return await startFlow(from);
    }
  } catch (err) {
    console.error(`[ERROR] ${from}:`, err);
    await sendMessage(from, '⚠️ Something went wrong. Please type *Hi* to start again.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

async function startFlow(from) {
  await clearSession(from);
  await setSession(from, { state: 'AWAITING_IMAGE' });
  await sendMessage(from,
    '🌿 *Welcome to CleanAlert!*\n\n' +
    'I help report waste in public areas of our town. AMC will be notified and you\'ll get a confirmation once cleaned.\n\n' +
    '━━━━━━━━━━━━━━━\n' +
    '📸 *Send a photo* of the waste on a public road, street, or park to begin.\n' +
    '━━━━━━━━━━━━━━━\n\n' +
    '_Commands: *cancel* to stop | *status* to check your report_');
}

async function handleImageReceived(from, mediaUrl, session) {
  await sendMessage(from, '📥 Image received! Downloading...');
  await setSession(from, { ...session, state: 'AI_VALIDATING', mediaUrl });

  // Download image from Twilio
  let imageBase64, mimeType;
  try {
    ({ imageBase64, mimeType } = await downloadTwilioMedia(mediaUrl));
  } catch (e) {
    console.error('Media download failed:', e);
    await setSession(from, { state: 'AWAITING_IMAGE' });
    return await sendMessage(from, '❌ Could not download your image. Please try sending it again.');
  }

  await sendMessage(from, '🤖 Validating image with AI...');

  // Run AI validation
  const result = await validateWasteImage(imageBase64, mimeType);
  console.log(`[AI Result] ${from}:`, result);

  if (!result.valid) {
    await setSession(from, { state: 'AWAITING_IMAGE' });
    return await sendMessage(from,
      `❌ *Report Not Accepted*\n\n` +
      `Reason: ${result.reason}\n\n` +
      `Please send a clear photo of *waste in a public outdoor area* (road, footpath, park).\n\n` +
      `_Type *Hi* to try again._`);
  }

  // Valid — ask for location
  await setSession(from, {
    ...session,
    state: 'AWAITING_LOCATION',
    imageBase64,
    mimeType,
    mediaUrl,
    severity: result.severity,
    wasteType: result.wasteType,
  });

  await sendMessage(from,
    `✅ *Waste Detected!*\n` +
    `Type: ${result.wasteType}\n` +
    `Severity: ${result.severity}\n\n` +
    `📍 Now please share your *live location* so I can alert the right AMC ward.\n\n` +
    `*(Tap 📎 → Location → Send Current Location)*\n\n` +
    `_Or type *skip* to continue without GPS_`);
}

async function handleLocationReceived(from, lat, lng, session) {
  await sendMessage(from, '📍 Location received! Raising ticket with AMC...');
  await raiseTicket(from, lat, lng, session);
}

async function handleLocationSkipped(from, session) {
  await sendMessage(from, '⚠️ Proceeding without GPS. Ward assignment may be less accurate.\n\nRaising ticket...');
  await raiseTicket(from, null, null, session);
}

async function raiseTicket(from, lat, lng, session) {
  const ticket = await createTicket({
    reporterPhone: from,
    lat, lng,
    imageBase64: session.imageBase64,
    mimeType: session.mimeType,
    mediaUrl: session.mediaUrl,
    severity: session.severity,
    wasteType: session.wasteType,
  });

  // Alert AMC via WhatsApp
  await notifyAMC(ticket);

  // Save ticket to session
  await setSession(from, {
    state: 'TICKET_OPEN',
    ticketId: ticket.id,
    ticket,
  });

  await sendMessage(from,
    `🎫 *Ticket Raised Successfully!*\n\n` +
    `Ticket ID: *${ticket.id}*\n` +
    `Ward: ${ticket.ward || 'Determining...'}\n` +
    `Severity: ${ticket.severity}\n` +
    `Status: Pending AMC assignment\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `You will receive a message with a *cleaned photo* once AMC completes the work.\n\n` +
    `_Average response time: 2–4 hours_\n` +
    `_Type *status* to check anytime_`);
}

async function handleStatusCheck(from, session) {
  if (!session?.ticketId) {
    return await sendMessage(from,
      'ℹ️ You have no active report.\n\nType *Hi* to report waste.');
  }
  const { ticket } = session;
  const statusEmoji = { PENDING: '🟡', ASSIGNED: '🔵', CLEANING: '🧹', RESOLVED: '✅' };
  const emoji = statusEmoji[ticket.status] || '🟡';

  await sendMessage(from,
    `${emoji} *Ticket Status*\n\n` +
    `ID: ${ticket.id}\n` +
    `Status: ${ticket.status}\n` +
    `Raised: ${new Date(ticket.createdAt).toLocaleString('en-IN')}\n` +
    (ticket.assignedTo ? `Worker: ${ticket.assignedTo}\n` : '') +
    `\n_We'll notify you when done. 🙏_`);
}

/**
 * Handle message from AMC worker phone number.
 * Worker sends cleaned-area photo to close the ticket.
 */
async function handleWorkerResponse(from, mediaUrl, body, session) {
  // Check if this sender is a registered AMC worker
  const AMC_WORKERS = (process.env.AMC_WORKER_NUMBERS || '').split(',').map(n => n.trim());
  const isWorker = AMC_WORKERS.includes(from);

  if (!isWorker) {
    // Regular user checking on open ticket
    return await handleStatusCheck(from, session);
  }

  // Worker closing a ticket — they should send: "DONE <ticketId>"
  if (body.startsWith('done ') && mediaUrl) {
    const ticketId = body.replace('done ', '').trim().toUpperCase();
    return await handleWorkerDone(from, ticketId, mediaUrl);
  }

  await sendMessage(from,
    '👷 *AMC Worker Portal*\n\n' +
    'To close a ticket, send:\n' +
    '`DONE <TICKET_ID>`\n' +
    'along with a *photo of the cleaned area*.\n\n' +
    'Example: _DONE CL-2024-0891_');
}

async function handleWorkerDone(workerPhone, ticketId, cleanedMediaUrl) {
  const ticket = await closeTicket(ticketId, workerPhone, cleanedMediaUrl);
  if (!ticket) {
    return await sendMessage(workerPhone,
      `❌ Ticket *${ticketId}* not found or already closed.`);
  }

  // Thank the worker
  await sendMessage(workerPhone,
    `✅ Ticket *${ticketId}* closed. Great work! 👷🏽`);

  // Notify original reporter with the cleaned photo
  const reporterPhone = ticket.reporterPhone;
  await sendMessageWithMedia(
    reporterPhone,
    `🎉 *Your Reported Area Has Been Cleaned!*\n\n` +
    `Ticket: *${ticketId}*\n` +
    `Cleaned by: AMC Worker\n` +
    `Completed: ${new Date().toLocaleString('en-IN')}\n\n` +
    `Thank you for helping keep our town clean! 🌿\n\n` +
    `_Type *Hi* to report another issue_`,
    cleanedMediaUrl
  );

  console.log(`[RESOLVED] Ticket ${ticketId} closed. Reporter ${reporterPhone} notified.`);
}

module.exports = { handleIncoming };
