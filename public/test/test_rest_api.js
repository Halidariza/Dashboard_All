require('dotenv').config();

async function testRestAPI() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error("❌ API Key is missing");
        return;
    }

    console.log("🔑 Testing API Key:", apiKey.substring(0, 10) + "...");

    // Test 1: List available models
    console.log("\n📋 Test 1: Listing available models...");
    try {
        const listResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );

        if (!listResponse.ok) {
            console.error(`❌ Status: ${listResponse.status} - ${listResponse.statusText}`);
            const errorText = await listResponse.text();
            console.error("Error details:", errorText);
        } else {
            const data = await listResponse.json();
            console.log("✅ Available models:");
            data.models?.forEach(model => {
                console.log(`   - ${model.name} (${model.displayName})`);
            });
        }
    } catch (error) {
        console.error("❌ Network error:", error.message);
    }

    // Test 2: Try to generate content
    console.log("\n💬 Test 2: Generating content with gemini-1.5-flash...");
    try {
        const generateResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: "Say hello in Indonesian" }]
                    }]
                })
            }
        );

        if (!generateResponse.ok) {
            console.error(`❌ Status: ${generateResponse.status} - ${generateResponse.statusText}`);
            const errorText = await generateResponse.text();
            console.error("Error details:", errorText);
        } else {
            const data = await generateResponse.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
            console.log("✅ Gemini replied:", reply);
        }
    } catch (error) {
        console.error("❌ Network error:", error.message);
    }
}

testRestAPI();
