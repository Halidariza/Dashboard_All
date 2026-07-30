// Test apakah AI bisa "melihat" dan mengakses informasi Drive
async function testDriveAccess() {
    // Simulate Drive context (seperti yang dikirim dari frontend)
    const mockContext = {
        currentFolder: "My Documents",
        folderId: "abc123",
        files: [
            { name: "Report 2024.pdf", type: "file" },
            { name: "Photos", type: "folder" },
            { name: "Budget.xlsx", type: "file" },
            { name: "Presentation.pptx", type: "file" }
        ],
        totalItems: 4
    };

    const testQuestions = [
        "Apa saja file yang ada di folder ini?",
        "Berapa jumlah file di folder saat ini?",
        "Ada folder apa saja?",
        "Apakah ada file PDF?",
        "Tolong jelaskan isi folder ini"
    ];

    console.log("🧪 Testing AI Drive Access\n");
    console.log("📂 Mock Drive Context:");
    console.log(`   Folder: ${mockContext.currentFolder}`);
    console.log(`   Files: ${mockContext.files.map(f => f.name).join(', ')}\n`);
    console.log("=".repeat(60));

    for (let i = 0; i < testQuestions.length; i++) {
        const question = testQuestions[i];
        console.log(`\n[Test ${i + 1}/${testQuestions.length}]`);
        console.log(`❓ Question: "${question}"`);

        try {
            const response = await fetch('http://localhost:3000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: question,
                    context: mockContext
                })
            });

            const data = await response.json();
            console.log(`💬 AI Reply:\n${data.reply}\n`);

            // Check if AI mentions specific files (shows it can "see" them)
            const mentionsFiles = mockContext.files.some(f =>
                data.reply.toLowerCase().includes(f.name.toLowerCase())
            );

            if (mentionsFiles) {
                console.log("✅ AI can SEE the files! (mentioned specific file names)");
            } else {
                console.log("⚠️  AI didn't mention specific files");
            }

        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
        }

        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Testing complete!");
}

testDriveAccess();
