const axios = require('axios');

/**
 * Downloads a media file from Twilio's URL (requires Basic Auth)
 * and returns it as base64 + mimeType.
 */
async function downloadTwilioMedia(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
    responseType: 'arraybuffer',
    timeout: 15000,
  });

  const mimeType = response.headers['content-type']?.split(';')[0] || 'image/jpeg';
  const imageBase64 = Buffer.from(response.data).toString('base64');

  return { imageBase64, mimeType };
}

module.exports = { downloadTwilioMedia };
