// Test apakah AI hanya fokus pada Google Drive management
async function testDriveFocus() {
    const testCases = [
        {
            question: "Bagaimana cara upload file ke Google Drive?",
            shouldAnswer: true,
            description: "Pertanyaan tentang Drive (HARUS dijawab)"
        },
        {
            question: "Apa itu JavaScript?",
            shouldAnswer: false,
            description: "Pertanyaan umum programming (HARUS ditolak)"
        },
        {
            question: "Berapa hasil 2 + 2?",
            shouldAnswer: false,
            description: "Pertanyaan matematika (HARUS ditolak)"
        },
        {
            question: "Bagaimana cara membuat folder baru di Drive?",
            shouldAnswer: true,
            description: "Pertanyaan tentang Drive (HARUS dijawab)"
        },
        {
            question: "Siapa presiden Indonesia?",
            shouldAnswer: false,
            description: "Pertanyaan umum (HARUS ditolak)"
        }
    ];

    console.log("🧪 Testing Drive Focus System Prompt\n");
    console.log("=".repeat(60));

    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        console.log(`\n[Test ${i + 1}/${testCases.length}] ${testCase.description}`);
        console.log(`❓ Question: "${testCase.question}"`);

        try {
            const response = await fetch('http://localhost:3000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: testCase.question })
            });

            const data = await response.json();
            const reply = data.reply;

            console.log(`💬 Reply: ${reply.substring(0, 150)}${reply.length > 150 ? '...' : ''}`);

            // Check if reply indicates rejection for non-Drive questions
            const isRejected = reply.toLowerCase().includes('maaf') ||
                reply.toLowerCase().includes('hanya') ||
                reply.toLowerCase().includes('google drive');

            if (testCase.shouldAnswer) {
                console.log(isRejected ? "❌ FAIL: Seharusnya dijawab tapi ditolak" : "✅ PASS: Dijawab dengan benar");
            } else {
                console.log(isRejected ? "✅ PASS: Ditolak dengan benar" : "❌ FAIL: Seharusnya ditolak tapi dijawab");
            }

        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
        }

        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Testing complete!");
}

testDriveFocus();
