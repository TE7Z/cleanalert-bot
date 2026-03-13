const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Validates a waste image using Claude Vision.
 *
 * Returns:
 *   { valid: true,  severity: 'HIGH'|'MEDIUM'|'LOW', wasteType: string }
 *   { valid: false, reason: string }
 */
async function validateWasteImage(imageBase64, mimeType = 'image/jpeg') {
  const prompt = `You are a waste detection AI for a civic complaint system in India.

Analyze this image and respond ONLY with a JSON object — no explanation, no markdown.

Rules:
1. VALID report: image shows waste/garbage/litter/dumping in a clearly OUTDOOR PUBLIC area (road, street, footpath, park, public drain, open ground).
2. INVALID if:
   - No visible waste or garbage
   - Indoor location (home, shop, inside a room)
   - Private property
   - Image is too blurry or dark to analyze
   - Image appears to be a screenshot, meme, or unrelated photo

JSON schema:
{
  "valid": boolean,
  "wasteType": "Loose garbage" | "Garbage bags" | "Construction debris" | "Plastic waste" | "Food waste" | "Mixed waste" | "Hazardous material" | "N/A",
  "severity": "HIGH" | "MEDIUM" | "LOW" | "N/A",
  "locationType": "public_road" | "footpath" | "park" | "drain" | "open_ground" | "private" | "indoor" | "unclear",
  "reason": "Short reason if invalid, else empty string",
  "confidence": number between 0 and 1
}

Severity guide:
- HIGH: Large pile, blocking path, health hazard, or hazardous material
- MEDIUM: Moderate amount, not blocking
- LOW: Small litter, minor issue`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const raw = response.content[0].text.trim();
    console.log('[AI Raw]', raw);

    // Strip markdown fences if present
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    if (!result.valid) {
      return {
        valid: false,
        reason: result.reason || 'Image did not pass validation.',
      };
    }

    return {
      valid: true,
      severity: result.severity || 'MEDIUM',
      wasteType: result.wasteType || 'Mixed waste',
      locationType: result.locationType,
      confidence: result.confidence,
    };
  } catch (err) {
    console.error('[AI] Validation error:', err.message);
    // Fail open — let human review if AI errors
    return {
      valid: false,
      reason: 'AI validation temporarily unavailable. Please try again in a minute.',
    };
  }
}

module.exports = { validateWasteImage };
