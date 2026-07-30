// Test the /api/chat endpoint to verify it's using the correct model
async function testChatEndpoint() {
    try {
        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Halo, kamu menggunakan model apa?'
            })
        });

        const data = await response.json();
        console.log('✅ Server Response:', data);
        console.log('\n📝 Reply:', data.reply);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n💡 Pastikan server sudah running di http://localhost:3000');
    }
}

testChatEndpoint();
