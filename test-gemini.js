require('dotenv').config({ path: '.env.local' });
const { GoogleGenAI } = require('@google/genai');

async function test() {
  if (!process.env.GEMINI_API_KEY) {
      console.log("NO API KEY");
      return;
  }
  
  const ai = new GoogleGenAI({});
  try {
      const response = await ai.models.generateContent({
          model: "gemini-2.5-pro",
          contents: "Hello",
      });
      console.log("Response:", response.text);
  } catch (e) {
      console.log("Error:", e);
  }
}
test();
