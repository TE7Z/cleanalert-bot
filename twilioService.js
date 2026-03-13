const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

/**
 * Send a plain text WhatsApp message.
 */
async function sendMessage(to, text) {
  try {
    const msg = await client.messages.create({
      from: FROM,
      to,
      body: text,
    });
    console.log(`[Twilio] Sent to ${to}: ${msg.sid}`);
    return msg;
  } catch (err) {
    console.error(`[Twilio] Failed to send to ${to}:`, err.message);
    throw err;
  }
}

/**
 * Send a WhatsApp message with an image attachment.
 * mediaUrl must be a publicly accessible URL (e.g. from Twilio or S3).
 */
async function sendMessageWithMedia(to, text, mediaUrl) {
  try {
    const msg = await client.messages.create({
      from: FROM,
      to,
      body: text,
      mediaUrl: [mediaUrl],
    });
    console.log(`[Twilio] Sent media to ${to}: ${msg.sid}`);
    return msg;
  } catch (err) {
    console.error(`[Twilio] Failed to send media to ${to}:`, err.message);
    throw err;
  }
}

module.exports = { sendMessage, sendMessageWithMedia };
