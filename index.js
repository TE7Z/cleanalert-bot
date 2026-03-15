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

// Validate image with Gemini AI
async function validateImage(imageBase64, mimeType) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
            { text: 'You are a waste detection AI for a civic complaint system in India. Analyze this image and respond ONLY with a JSON object, no explanation, no markdown. Rules: VALID means waste or garbage or litter in outdoor PUBLIC area like road street footpath park. INVALID means no waste or indoor or private property or blurry. JSON format: {"valid":boolean,"wasteType":"Loose garbage|Garbage bags|Mixed waste|Plastic waste|Construction debris|N/A","severity":"HIGH|MEDIUM|LOW|N/A","reason":"short reason if invalid else empty string"}' }
          ]
        }]
      }
    );
    const raw = response.data.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    console.log('[Gemini Raw]', raw);
    return JSON.parse(raw);
  } catch (e) {
    console.error('Gemini error:', e.message);
    return { valid: false, reason: '' };
  }
}

// Create ticket
function createTicket(phone, mediaUrl, severity, wasteType) {
  const id = 'CL-' + Date.now().toString().slice(-6);
  const ticket = { id, phone, mediaUrl, severity, wasteType, status: 'PENDING', createdAt: new Date().toISOString() };
  tickets.set(id, ticket);
  return ticket;
}

// Detect language
function detectLang(text) {
  const gujaratiPattern = /[\u0A80-\u0AFF]/;
  return gujaratiPattern.test(text) ? 'gu' : 'en';
}

// Messages in English and Gujarati
const MESSAGES = {
  en: {
    welcome: '🌿 *Welcome to CleanAlert!*\n\nReport waste in public areas.\nAMC will be notified and you will get confirmation once cleaned.\n\n📸 Please send a *photo of the waste* to begin.\n\nType *cancel* anytime to stop',
    sendPhoto: '📸 Please send a *photo* of the waste in a public area.',
    validating: '🤖 Got your photo! Validating with AI...',
    rejected: () => `❌ *Report Not Accepted*\n\nPlease send a clear photo of waste in a *public outdoor area*.\nType *Hi* to try again.`,
    askLocation: (type, severity) => `✅ *Waste Detected!*\nType: ${type}\nSeverity: ${severity}\n\n📍 Now share your *live location*\n*(Tap 📎 → Location → Send Current Location)*\n\nOr type *skip* to continue`,
    noLocation: '📍 Please share your *live location*.\n*(Tap 📎 → Location → Send Current Location)*\n\nOr type *skip*',
    ticketRaised: (id, severity) => `🎫 *Ticket Raised!*\n\nID: *${id}*\nSeverity: ${severity}\nStatus: Pending AMC\n\nYou will receive cleaned photo once AMC finishes.\n\nType *status* to check anytime`,
    cancelled: '❌ Cancelled. Type *Hi* to start a new report.',
    noTicket: 'ℹ️ No active report. Type *Hi* to report waste.',
    cleaned: (id) => `🎉 *Your Reported Area Has Been Cleaned!*\n\nTicket: *${id}*\nCompleted: ${new Date().toLocaleString('en-IN')}\n\nThank you for keeping our town clean! 🌿\n\nType *Hi* to report another issue`,
    error: '⚠️ Something went wrong. Type *Hi* to try again.',
  },
  gu: {
    welcome: '🌿 *CleanAlert માં આપનું સ્વાગત છે!*\n\nજાહેર વિસ્તારમાં કચરાની જાણ કરો.\nAMC ને સૂચના આપવામાં આવશે અને સફાઈ પછી તમને ખબર મળશે.\n\n📸 શરૂ કરવા કચરાનો ફોટો મોકલો.\n\nબંધ કરવા cancel ટાઈપ કરો',
    sendPhoto: '📸 કૃપા કરીને જાહેર વિસ્તારમાં કચરાનો ફોટો મોકલો.',
    validating: '🤖 ફોટો મળ્યો! AI થી ચકાસણી થઈ રહી છે...',
    rejected: () => `❌ *રિપોર્ટ સ્વીકારાયો નથી*\n\nજાહેર બહારના વિસ્તારમાં કચરાનો સ્પષ્ટ ફોટો મોકલો.\nફરી પ્રયાસ કરવા Hi ટાઈપ કરો.`,
    askLocation: (type, severity) => `✅ *કચરો મળ્યો!*\nપ્રકાર: ${type}\nગંભીરતા: ${severity}\n\n📍 હવે લાઈવ લોકેશન મોકલો\n(📎 દબાવો - Location - હાલનું સ્થાન મોકલો)\n\nઆગળ વધવા skip ટાઈપ કરો`,
    noLocation: '📍 લાઈવ લોકેશન મોકલો.\n(📎 દબાવો - Location - હાલનું સ્થાન મોકલો)\n\nઅથવા skip ટાઈપ કરો',
    ticketRaised: (id, severity) => `🎫 *ફરિયાદ નોંધાઈ!*\n\nID: *${id}*\nગંભીરતા: ${severity}\nસ્થિતિ: AMC ની રાહ\n\nAMC કામ પૂર્ણ કરે પછી સફાઈના ફોટો સાથે સૂચના મળશે.\n\nસ્થિતિ જાણવા status ટાઈપ કરો`,
    cancelled: '❌ રદ કરવામાં આવ્યું. નવો રિપોર્ટ કરવા Hi ટાઈપ કરો.',
    noTicket: 'ℹ️ કોઈ સક્રિય રિપોર્ટ નથી. Hi ટાઈપ કરો.',
    cleaned: (id) => `🎉 *સફાઈ થઈ ગઈ!*\n\nટિકિટ: *${id}*\nપૂર્ણ: ${new Date().toLocaleString('en-IN')}\n\nઆભાર! 🌿\n\nબીજો રિપોર્ট કરવા Hi ટાઈપ કરો`,
    error: '⚠️ કંઈક ખોટું થયું. Hi ટાઈપ કરો.',
  }
};

// Main webhook
app.post('/webhook', async (req, res) => {
  res.status(200).send('');

  const from = req.body.From;
  const body = (req.body.Body || '').trim().toLowerCase().replace(/[*_]/g, '');
  const mediaUrl = req.body.MediaUrl0;
  const lang = detectLang(req.body.Body || '');

  let session = getSession(from);
  if (!session) {
    session = { state: 'AWAITING_IMAGE', lang: lang };
    setSession(from, session);
  }

  const M = MESSAGES[session.lang || lang || 'en'];

  try {
    // Global commands
    const greetings = ['hi', 'hello', 'start', 'menu', 'ok', 'hey'];
    const isGujarati = /[\u0A80-\u0AFF]/.test(req.body.Body || '');
const isShortGujarati = isGujarati && (req.body.Body || '').trim().length < 15 && !mediaUrl;
const isGreeting = (greetings.includes(body) && !mediaUrl) || isShortGujarati;

    if (isGreeting) {
      clearSession(from);
      setSession(from, { state: 'AWAITING_IMAGE', lang: lang });
      const M2 = MESSAGES[lang];
      return await sendMsg(from, M2.welcome);
    }

    if (body === 'cancel') {
      clearSession(from);
      return await sendMsg(from, M.cancelled);
    }

    if (body === 'status') {
      const s = getSession(from);
      if (!s || !s.ticketId) return await sendMsg(from, M.noTicket);
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
      const reporterSession = [...sessions.entries()].find(([k, v]) => v.ticketId === ticketId);
      const reporterLang = reporterSession ? reporterSession[1].lang || 'en' : 'en';
      const RM = MESSAGES[reporterLang];
      await sendMedia(ticket.phone, RM.cleaned(ticketId), mediaUrl);
      return;
    }

    // State machine
    switch (session.state) {
      case 'IDLE':
      case 'AWAITING_IMAGE':
        if (!mediaUrl) {
          return await sendMsg(from, M.sendPhoto);
        }
        await sendMsg(from, M.validating);
        const { imageBase64, mimeType } = await downloadImage(mediaUrl);
        const result = await validateImage(imageBase64, mimeType);
        if (!result.valid) {
          setSession(from, { state: 'AWAITING_IMAGE', lang: session.lang });
          return await sendMsg(from, M.rejected(result.reason));
        }
        setSession(from, { state: 'AWAITING_LOCATION', mediaUrl, severity: result.severity, wasteType: result.wasteType, lang: session.lang });
        return await sendMsg(from, M.askLocation(result.wasteType, result.severity));

      case 'AWAITING_LOCATION':
        const lat = req.body.Latitude;
        const lng = req.body.Longitude;
        const hasLocation = lat && lng;
        if (!hasLocation && body !== 'skip') {
          return await sendMsg(from, M.noLocation);
        }
        const mapsLink = hasLocation ? `https://maps.google.com/?q=${lat},${lng}` : 'Not provided';
        const ticket = createTicket(from, session.mediaUrl, session.severity, session.wasteType);
        setSession(from, { state: 'TICKET_OPEN', ticketId: ticket.id, lang: session.lang });

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

        return await sendMsg(from, M.ticketRaised(ticket.id, ticket.severity));

      default:
        clearSession(from);
        return await sendMsg(from, M.welcome);
    }
  } catch (err) {
    console.error('Error:', err);
    await sendMsg(from, M.error);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`CleanAlert running on port ${PORT}`));
