// Test apakah AI bisa langsung eksekusi perintah
async function testDirectExecution() {
    // Simulate Drive context dengan ID
    const mockContext = {
        currentFolder: "My Documents",
        folderId: "folder123",
        files: [
            { name: "testing", type: "folder", id: "file_testing_123" },
            { name: "Report 2024.pdf", type: "file", id: "file_report_456" },
            { name: "Photos", type: "folder", id: "folder_photos_789" },
            { name: "Budget.xlsx", type: "file", id: "file_budget_012" }
        ],
        totalItems: 4
    };

    const testCommands = [
        {
            command: "hapus file bernama testing",
            expectedAction: "deleteFile",
            expectedTarget: "testing",
            description: "DELETE command test"
        },
        {
            command: "buat folder baru bernama Projects",
            expectedAction: "createFolder",
            expectedTarget: "Projects",
            description: "CREATE FOLDER command test"
        },
        {
            command: "buka folder Photos",
            expectedAction: "openFolder",
            expectedTarget: "Photos",
            description: "OPEN FOLDER command test"
        },
        {
            command: "apa saja file yang ada?",
            expectedAction: null,
            description: "INFO query (no action expected)"
        }
    ];

    console.log("🧪 Testing Direct Execution\n");
    console.log("📂 Mock Drive Context:");
    console.log(`   Folder: ${mockContext.currentFolder}`);
    console.log(`   Files: ${mockContext.files.map(f => `${f.name} (${f.id})`).join(', ')}\n`);
    console.log("=".repeat(70));

    for (let i = 0; i < testCommands.length; i++) {
        const test = testCommands[i];
        console.log(`\n[Test ${i + 1}/${testCommands.length}] ${test.description}`);
        console.log(`💬 Command: "${test.command}"`);

        try {
            const response = await fetch('http://localhost:3000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: test.command,
                    context: mockContext
                })
            });

            const data = await response.json();
            console.log(`📨 Reply: ${data.reply}`);

            if (data.action) {
                console.log(`⚡ Action Detected:`);
                console.log(`   Type: ${data.action.type}`);
                console.log(`   Name: ${data.action.name || 'N/A'}`);
                console.log(`   ID: ${data.action.id || 'N/A'}`);

                if (test.expectedAction) {
                    if (data.action.type === test.expectedAction) {
                        console.log(`✅ PASS: Correct action type`);
                    } else {
                        console.log(`❌ FAIL: Expected ${test.expectedAction}, got ${data.action.type}`);
                    }
                } else {
                    console.log(`⚠️  Unexpected action returned`);
                }
            } else {
                if (test.expectedAction) {
                    console.log(`❌ FAIL: Expected action ${test.expectedAction}, but got none`);
                } else {
                    console.log(`✅ PASS: No action (as expected for info query)`);
                }
            }

        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
        }

        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log("\n" + "=".repeat(70));
    console.log("✅ Testing complete!");
    console.log("\n💡 Jika semua test PASS, AI sudah bisa langsung eksekusi!");
}

testDirectExecution();
