require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function checkModels() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("❌ API Key is missing");
        return;
    }

    // Updated to use currently available models (as of Feb 2026)
    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

    const genAI = new GoogleGenerativeAI(key);

    for (const modelName of models) {
        try {
            console.log(`📡 Connecting to model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });

            // Simple prompt
            const result = await model.generateContent("Hello");
            const response = await result.response;
            const text = response.text();

            console.log(`✅ SUCCESS! Model '${modelName}' works!`);
            console.log("Reply:", text);
            return; // Exit on first success
        } catch (error) {
            console.error(`❌ FAILED '${modelName}': Status ${error.status} - ${error.statusText}`);
        }
    }
    console.log("⚠️ All standard models failed. Please check if 'Vertex AI API' or 'Generative AI API' is enabled in your Google Cloud Console.");
}

checkModels();
