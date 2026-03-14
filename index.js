require('dotenv').config();
const express = require('express');

const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Clients
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
const AMC = `whatsapp:${process.env.AMC_WHATSAPP_NUMBER}`;

// Session store
const sessions = new Map();
function getSession(phone) { return sessions.get(phone) || null; }
function setSession(phone, data) { sessions.set(phone, data); }
function clearSession(phone) { sessions.delete(phone); }

// Tickets store
const tickets = new Map();

// Send WhatsApp text
async function sendMsg(to, text) {
  await twilioClient.messages.create({ from: FROM, to, body: text });
}

// Send WhatsApp with image
async function sendMedia(to, text, mediaUrl) {
  await twilioClient.messages.create({ from: FROM, to, body: text, mediaUrl: [mediaUrl] });
}

// Download image from Twilio
async function downloadImage(mediaUrl) {
  const res = await axios.get(mediaUrl, {
    auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
    responseType: 'arraybuffer',
    timeout: 15000,
  });
  const mimeType = res.headers['content-type']?.split(';')[0] || 'image/jpeg';
  const imageBase64 = Buffer.from(res.data).toString('base64');
  return { imageBase64, mimeType };
}

// Validate image with Claude AI
async function validateImage(imageBase64, mimeType) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
            { text: `You are a waste detection AI for a civic complaint system in India. Analyze this image and respond ONLY with a JSON object, no explanation, no markdown. Rules: VALID means waste or garbage or litter in outdoor PUBLIC area like road street footpath park. INVALID means no waste or indoor or private property or blurry. JSON format: {"valid":boolean,"wasteType":"Loose garbage|Garbage bags|Mixed waste|Plastic waste|Construction debris|N/A","severity":"HIGH|MEDIUM|LOW|N/A","reason":"short reason if invalid else empty string"}` }
          ]
        }]
      }
    );
    const raw = response.data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    console.log('[Gemini Raw]', raw);
    return JSON.parse(raw);
  } catch (e) {
    console.error('Gemini error:', e.message);
    return { valid: false, reason: 'AI validation failed. Please try again.' };
  }
}

// Create ticket
function createTicket(phone, mediaUrl, severity, wasteType) {
  const id = 'CL-' + Date.now().toString().slice(-6);
  const ticket = { id, phone, mediaUrl, severity, wasteType, status: 'PENDING', createdAt: new Date().toISOString() };
  tickets.set(id, ticket);
  return ticket;
}

// Main webhook
app.post('/webhook', async (req, res) => {
  res.status(200).send('');
  const from = req.body.From;
  const body = (req.body.Body || '').trim().toLowerCase().replace(/[*_]/g, '');
  const mediaUrl = req.body.MediaUrl0;
  let session = getSession(from);
if (!session) {
  session = { state: 'AWAITING_IMAGE' };
  setSession(from, session);
}
  try {
    // Global commands
    if (['hi','hello','start','menu','ok','hey'].includes(body) && !mediaUrl) {
      clearSession(from);
      setSession(from, { state: 'AWAITING_IMAGE' });
      return await sendMsg(from,
        '🌿 *Welcome to CleanAlert!*\n\n' +
        'Report waste in public areas of our town.\n' +
        'AMC will be notified and you will get confirmation once cleaned.\n\n' +
        '📸 Please send a *photo of the waste* to begin.\n\n' +
        '_Type *cancel* anytime to stop_');
    }

    if (body === 'cancel') {
      clearSession(from);
      return await sendMsg(from, '❌ Cancelled. Type *Hi* to start a new report.');
    }

    if (body === 'status') {
      const s = getSession(from);
      if (!s?.ticketId) return await sendMsg(from, 'ℹ️ No active report. Type *Hi* to report waste.');
      const t = tickets.get(s.ticketId);
      return await sendMsg(from, `📋 *Ticket ${t.id}*\nStatus: ${t.status}\nSeverity: ${t.severity}\nRaised: ${new Date(t.createdAt).toLocaleString('en-IN')}`);
    }

    // Worker closing ticket: "done CL-XXXXXX" + photo
    const workers = (process.env.AMC_WORKER_NUMBERS || '').split(',').map(n => n.trim());
    if (workers.includes(from) && body.startsWith('done ') && mediaUrl) {
      const ticketId = body.replace('done ', '').trim().toUpperCase();
      const ticket = tickets.get(ticketId);
      if (!ticket) return await sendMsg(from, `❌ Ticket ${ticketId} not found.`);
      ticket.status = 'RESOLVED';
      tickets.set(ticketId, ticket);
      await sendMsg(from, `✅ Ticket *${ticketId}* closed. Great work! 👷`);
      await sendMedia(ticket.phone,
        `🎉 *Your Reported Area Has Been Cleaned!*\n\n` +
        `Ticket: *${ticketId}*\n` +
        `Completed: ${new Date().toLocaleString('en-IN')}\n\n` +
        `Thank you for keeping our town clean! 🌿\n\n` +
        `_Type *Hi* to report another issue_`,
        mediaUrl);
      return;
    }

    // State machine
    switch (session.state) {
      case 'IDLE':
      case 'AWAITING_IMAGE':
        if (!mediaUrl) {
          return await sendMsg(from, '📸 Please send a *photo* of the waste in a public area.');
        }
        await sendMsg(from, '🤖 Got your photo! Validating with AI...');
        const { imageBase64, mimeType } = await downloadImage(mediaUrl);
        const result = await validateImage(imageBase64, mimeType);
        if (!result.valid) {
          setSession(from, { state: 'AWAITING_IMAGE' });
          return await sendMsg(from,
            `❌ *Report Not Accepted*\n\nReason: ${result.reason}\n\n` +
            `Please send a clear photo of waste in a *public outdoor area*.\n_Type *Hi* to try again._`);
        }
        setSession(from, { state: 'AWAITING_LOCATION', mediaUrl, severity: result.severity, wasteType: result.wasteType });
        return await sendMsg(from,
          `✅ *Waste Detected!*\nType: ${result.wasteType}\nSeverity: ${result.severity}\n\n` +
          `📍 Now share your *live location* so I can alert the right AMC ward.\n` +
          `*(Tap 📎 → Location → Send Current Location)*\n\n` +
          `_Or type *skip* to continue without location_`);

      case 'AWAITING_LOCATION':
        const lat = req.body.Latitude;
        const lng = req.body.Longitude;
        const hasLocation = lat && lng;
        if (!hasLocation && body !== 'skip') {
          return await sendMsg(from,
            '📍 Please share your *live location*.\n*(Tap 📎 → Location → Send Current Location)*\n\n_Or type *skip*_');
        }
        const mapsLink = hasLocation ? `https://maps.google.com/?q=${lat},${lng}` : 'Not provided';
        const ticket = createTicket(from, session.mediaUrl, session.severity, session.wasteType);
        setSession(from, { state: 'TICKET_OPEN', ticketId: ticket.id });

        // Alert AMC
        const sevEmoji = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢' }[ticket.severity] || '⚪';
        await sendMedia(AMC,
          `🚨 *NEW WASTE COMPLAINT*\n` +
          `━━━━━━━━━━━━━━━\n` +
          `🎫 Ticket: *${ticket.id}*\n` +
          `${sevEmoji} Severity: *${ticket.severity}*\n` +
          `🗑️ Type: ${ticket.wasteType}\n` +
          `🗺️ Location: ${mapsLink}\n` +
          `🕐 Time: ${new Date().toLocaleString('en-IN')}\n` +
          `━━━━━━━━━━━━━━━\n` +
          `After cleaning reply:\n*DONE ${ticket.id}*\nwith a photo of cleaned area.`,
          session.mediaUrl);

        return await sendMsg(from,
          `🎫 *Ticket Raised!*\n\n` +
          `ID: *${ticket.id}*\n` +
          `Severity: ${ticket.severity}\n` +
          `Status: Pending AMC\n\n` +
          `You will receive a message with cleaned photo once AMC finishes.\n\n` +
          `_Type *status* to check anytime_`);

      default:
        clearSession(from);
        return await sendMsg(from, 'Type *Hi* to start a new report.');
    }
  } catch (err) {
    console.error('Error:', err);
    await sendMsg(from, '⚠️ Something went wrong. Type *Hi* to try again.');
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`CleanAlert running on port ${PORT}`));
