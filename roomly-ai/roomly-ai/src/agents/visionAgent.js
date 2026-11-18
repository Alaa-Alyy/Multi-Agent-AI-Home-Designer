const fs = require('fs');
const db = require('../storage/database');
const ai = require('../ai/cloudflare');

const ROOM_TYPES = ['living_room', 'bedroom', 'home_office', 'dining_room', 'kids_room', 'other'];

const INSTRUCTION = `You are an expert interior designer looking at a photo of a room that will be redesigned.
Describe ONLY what is actually visible. Do not invent furniture that is not in the photo.
Return ONLY a JSON object with exactly this shape:
{
  "roomType": one of ${JSON.stringify(ROOM_TYPES)} (best guess from layout and furniture; "other" if unclear),
  "isEmptyRoom": true if there is no furniture,
  "roomDimensionsEstimate": { "widthM": number, "lengthM": number, "ceilingHeightM": number },
  "existingStyle": "short description, or 'empty room'",
  "furnitureAndObjects": [ { "name": "e.g. grey 3-seat sofa", "category": "seating|table|storage|bed|lighting|decor|rug|curtains|other", "condition": "good|worn|outdated", "position": "e.g. against back wall, left of window" } ],
  "colorPaletteDetected": { "dominantWallColor": "name + hex", "floorColor": "name + hex", "accentColors": ["name + hex"] },
  "architecturalElements": {
    "walls": "description",
    "flooring": "material and colour",
    "windows": { "count": number, "position": "e.g. centre of back wall", "naturalLight": "high|moderate|low" },
    "doors": { "count": number, "position": "where, if visible" },
    "ceiling": "description"
  },
  "lightingAssessment": { "naturalLight": "high|moderate|low", "existingFixtures": ["..."], "lightingDeficiencies": "short" },
  "availableFreeSpace": "high|moderate|tight",
  "spatialCharacteristics": "2 sentences: layout, focal wall, where large furniture can go"
}`;

class VisionAgent {
  async analyzeRoom(sessionId, roomId, imagePath) {
    if (!imagePath || !fs.existsSync(imagePath)) {
      throw new Error('No room photo found for this session. Upload a photo first.');
    }
    const session = db.getSession(sessionId);
    const imageHash = session?.imageHash || db.computeFileHash(imagePath);

    // Reuse the analysis if this exact photo was already analysed
    const cached = db.getVisionAnalysis(sessionId);
    if (cached?.imageHash === imageHash && cached.analysis) return cached.analysis;

    console.log(`[Vision Agent] Analysing room photo for session ${sessionId}...`);
    const raw = await ai.vision(fs.readFileSync(imagePath), INSTRUCTION);
    const analysis = this.normalize(raw);

    db.saveVisionAnalysis(sessionId, roomId, imageHash, analysis);
    return analysis;
  }

  normalize(raw) {
    const a = raw || {};
    const furniture = Array.isArray(a.furnitureAndObjects) ? a.furnitureAndObjects.filter(f => f && f.name) : [];
    return {
      roomType: ROOM_TYPES.includes(a.roomType) ? a.roomType : 'other',
      isEmptyRoom: furniture.length === 0 ? true : Boolean(a.isEmptyRoom),
      roomDimensionsEstimate: a.roomDimensionsEstimate || {},
      existingStyle: a.existingStyle || '',
      furnitureAndObjects: furniture,
      colorPaletteDetected: a.colorPaletteDetected || {},
      architecturalElements: a.architecturalElements || {},
      lightingAssessment: a.lightingAssessment || {},
      availableFreeSpace: a.availableFreeSpace || 'moderate',
      spatialCharacteristics: a.spatialCharacteristics || ''
    };
  }
}

module.exports = new VisionAgent();
