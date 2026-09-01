// Native fetch is available in Node.js 18+

async function testConfirmation() {
    const URL = 'http://localhost:3000/api/chat';

    // Mock Context
    const context = {
        currentFolder: 'Root',
        files: [],
        allFiles: [
            { name: 'Feedback CP phase 4', id: 'file_id_123', type: 'file', parentId: 'root' }
        ]
    };

    // Step 1: Initial Search
    console.log('--- Step 1: Searching for file ---');
    const res1 = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: 'Cari file Feedback CP phase 4',
            context: context,
            history: [{ role: 'user', content: 'Cari file Feedback CP phase 4' }]
        })
    });
    const data1 = await res1.json();
    console.log('Bot Response:', data1.reply);

    // Update history for the next turn
    const history = [
        { role: 'user', content: 'Cari file Feedback CP phase 4' },
        { role: 'bot', content: data1.reply }
    ];

    // Step 2: Confirmation
    console.log('\n--- Step 2: Confirming with "ya" ---');
    history.push({ role: 'user', content: 'ya' });

    const res2 = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: 'ya',
            context: context,
            history: history
        })
    });
    const data2 = await res2.json();
    console.log('Full Bot Response:', JSON.stringify(data2, null, 2));

    if (data2.action && data2.action.id === 'file_id_123') {
        console.log('\n✅ SUCCESS: Bot remembered context and provided the correct action!');
    } else {
        console.log('\n❌ FAILED: Bot did not provide the expected action.');
    }
}

testConfirmation();
