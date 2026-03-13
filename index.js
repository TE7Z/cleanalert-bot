require('dotenv').config();
const express = require('express');
const { handleIncoming } = require('./messageHandler');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Twilio webhook — incoming WhatsApp messages
app.post('/webhook', handleIncoming);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'CleanAlert Bot' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CleanAlert bot running on port ${PORT}`));
