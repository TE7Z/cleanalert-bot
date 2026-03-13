const axios = require('axios');

/**
 * Reverse geocodes GPS coordinates to determine the AMC ward/area name.
 * Uses Google Maps Geocoding API.
 *
 * Falls back to coordinates string if API unavailable.
 */
async function getWardFromCoords(lat, lng) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('[Geo] No GOOGLE_MAPS_API_KEY set. Using raw coordinates.');
    return `Near ${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    const { data } = await axios.get(url, { timeout: 5000 });

    if (data.status !== 'OK' || !data.results.length) {
      return `${lat}, ${lng}`;
    }

    // Extract sublocality or locality from result components
    const result = data.results[0];
    const components = result.address_components || [];

    const sublocality = components.find(c => c.types.includes('sublocality_level_1'))?.long_name;
    const locality    = components.find(c => c.types.includes('locality'))?.long_name;
    const route       = components.find(c => c.types.includes('route'))?.long_name;

    return sublocality || route || locality || result.formatted_address.split(',')[0];
  } catch (err) {
    console.error('[Geo] Geocoding error:', err.message);
    return `${lat}, ${lng}`;
  }
}

module.exports = { getWardFromCoords };
