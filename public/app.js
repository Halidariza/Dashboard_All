document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide
    if (window.lucide) lucide.createIcons();

    // --- Existing Core Logic (GAS Config & File Ops) ---
    const connectBtn = document.getElementById('connectBtn');
    const resultArea = document.getElementById('resultArea');
    const fileList = document.getElementById('fileList');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const loader = document.getElementById('loader');

    // Controls
    const fileInput = document.getElementById('fileInput');
    const createFolderBtn = document.getElementById('createFolderBtn');
    const folderNameDisplay = document.getElementById('folderName');
    const backBtn = document.getElementById('backBtn');
    const userDisplay = document.getElementById('user-display');

    let GAS_URL = '';
    let currentFolderId = ''; // Current folder
    let rootFolderId = null;  // To identify the absolute top level
    let parentFolderId = null; // From GAS
    let navHistory = []; // Local stack fallback
    let allDriveItems = []; // Global context for AI
    let isLoggedIn = false; // Auth state
    let chatHistory = []; // Conversation memory

    // Load functionality
    async function loadConfig() {
        try {
            const response = await fetch('/api/config');
            const data = await response.json();
            GAS_URL = data.gasUrl;

            if (!GAS_URL || GAS_URL.includes('YOUR_SCRIPT_ID')) {
                console.warn('GAS URL not configured');
                statusText.innerText = 'Config Missing';
                statusDot.style.backgroundColor = 'orange';
            } else {
                fetchFiles();
            }
        } catch (error) {
            console.error('Failed to load config:', error);
        }
    }

    loadConfig();

    if (connectBtn) connectBtn.addEventListener('click', () => fetchFiles());

    async function fetchFiles(folderId = '', isBack = false) {
        if (!GAS_URL) return;
        setLoading(true);

        try {
            const url = folderId ? `${GAS_URL}?action=list&folderId=${folderId}` : `${GAS_URL}?action=list`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'success') {
                statusDot.classList.add('connected');
                statusText.innerText = 'Connected';

                // Capture Root ID once (Handle common root names like 'Drive', 'My Drive', 'Drive Saya')
                const rootNames = ['Drive', 'My Drive', 'Drive Saya', 'MyDrive'];
                if (!rootFolderId && (rootNames.includes(data.currentFolder.name) || !data.currentFolder.parentId)) {
                    rootFolderId = data.currentFolder.id;
                    console.log('🏠 Root Folder ID detected:', rootFolderId, 'Name:', data.currentFolder.name);
                }

                // Track History with clean names (Ensure root names are stored as 'Root' for filtering)
                let cleanCurrentNameForHistory = (folderNameDisplay.dataset.simpleName || 'Root');
                if (rootNames.includes(cleanCurrentNameForHistory)) cleanCurrentNameForHistory = 'Root';

                if (!isBack && currentFolderId && currentFolderId !== data.currentFolder.id) {
                    navHistory.push({ id: currentFolderId, name: cleanCurrentNameForHistory });
                }

                currentFolderId = data.currentFolder.id;
                parentFolderId = data.currentFolder.parentId;

                // Build Breadcrumb String for History Badge (Exclude Root names from path)
                const isRoot = data.currentFolder.id === rootFolderId || rootNames.includes(data.currentFolder.name);
                const currentFolderName = isRoot ? 'Root' : data.currentFolder.name;

                // Store simple name for next history push
                folderNameDisplay.dataset.simpleName = currentFolderName;

                // Path calculation: filter out 'Root' and join with '>'
                let pathItems = navHistory.map(h => h.name).filter(n => n !== 'Root' && !rootNames.includes(n));
                if (currentFolderName !== 'Root') {
                    pathItems.push(currentFolderName);
                }

                folderNameDisplay.innerText = pathItems.length > 0 ? pathItems.join(' > ') : 'Root';

                // Re-bind click event for the 'x' button (exit folder)
                setTimeout(() => {
                    const closeIcon = document.querySelector('.nav-history-badge .close-icon');
                    if (closeIcon) {
                        closeIcon.onclick = (e) => {
                            e.stopPropagation();
                            if (navHistory.length > 0) {
                                const prev = navHistory.pop();
                                fetchFiles(prev.id, true);
                            } else if (currentFolderId !== rootFolderId) {
                                // Fallback to root if history is empty but we aren't at root
                                fetchFiles(rootFolderId, true);
                            }
                        };
                    }
                }, 100);

                // BACK BUTTON LOGIC:
                // Hide if we are at root OR if there's no history/parent
                const isAtRoot = currentFolderId === rootFolderId || rootNames.includes(data.currentFolder.name);

                if (backBtn) {
                    if (!isAtRoot && (navHistory.length > 0 || parentFolderId)) {
                        backBtn.classList.remove('hidden');
                    } else {
                        backBtn.classList.add('hidden');
                    }
                }
                if (isAtRoot) navHistory = [];

                renderFiles(data.items);
                resultArea.classList.remove('hidden');
                if (connectBtn) connectBtn.classList.add('hidden');

                // Fetch global context in background for AI
                fetchAllDriveItems();
            } else {
                showError(data.message);
            }
        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(false);
        }
    }

    async function fetchAllDriveItems() {
        if (!GAS_URL) return;
        try {
            const response = await fetch(`${GAS_URL}?action=listAll`);
            const data = await response.json();
            if (data.status === 'success') {
                allDriveItems = data.items;
                console.log('🌐 Global Drive Context Updated:', allDriveItems.length, 'items');
            }
        } catch (error) {
            console.error('Failed to fetch global context:', error);
        }
    }

    async function uploadFile(file) {
        if (!isLoggedIn) {
            showLoginModal(() => uploadFile(file));
            return;
        }
        setLoading(true);
        const reader = new FileReader();

        reader.onload = async function (e) {
            const content = e.target.result.split(',')[1];

            const payload = {
                action: 'upload',
                folderId: currentFolderId,
                name: file.name,
                mimeType: file.type,
                content: content
            };

            try {
                await sendPostRequest(payload);
                fetchFiles(currentFolderId);
            } catch (err) {
                showError(err.message);
            } finally {
                setLoading(false);
                if (fileInput) fileInput.value = '';
            }
        };

        reader.readAsDataURL(file);
    }

    async function createFolder(name = null) {
        if (!isLoggedIn) {
            showLoginModal(() => createFolder(name));
            return;
        }
        if (!name) name = prompt("Enter folder name:");
        if (!name) return;

        setLoading(true);
        try {
            await sendPostRequest({
                action: 'createFolder',
                parentId: currentFolderId,
                name: name
            });
            fetchFiles(currentFolderId);
        } catch (err) {
            showError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function deleteItem(id) {
        if (!isLoggedIn) {
            showLoginModal(() => deleteItem(id));
            return;
        }
        if (!confirm("Are you sure you want to delete this item?")) return;

        setLoading(true);
        try {
            await sendPostRequest({
                action: 'delete',
                id: id
            });
            fetchFiles(currentFolderId);
        } catch (err) {
            showError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function sendPostRequest(data) {
        const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        if (result.status !== 'success') throw new Error(result.message);
        return result;
    }

    function renderFiles(items) {
        fileList.innerHTML = '';

        // Add Concept Groups if at Root to match the screenshot
        const isAtRoot = currentFolderId === rootFolderId || folderNameDisplay.innerText === 'Root';
        if (isAtRoot) {
            const groupRow = document.createElement('tr');
            groupRow.className = 'group-row';
            groupRow.innerHTML = `<td colspan="9"><i data-lucide="chevron-down" size="16"></i> Managed Projects (${items.length})</td>`;
            fileList.appendChild(groupRow);
        }

        items.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.className = 'data-row';

            const iconName = item.type === 'folder' ? 'folder' : 'file-text';
            const iconColor = item.type === 'folder' ? '#facc15' : '#64748b';

            // Mock Data for Concept style
            const projectId = `PRJ${250000 + index}`;
            const statusClass = item.type === 'folder' ? 'status-progress' : 'status-done';
            const statusText = item.type === 'folder' ? 'In Progress' : 'Done';
            const pmInitial = item.name.charAt(0).toUpperCase();

            tr.innerHTML = `
                <td><input type="checkbox"></td>
                <td style="color: #64748b; font-family: monospace; font-size: 0.75rem;"></td>
                <td>
                    <div class="clickable-item" style="display: flex; align-items: center; gap: 8px; cursor: pointer" 
                         data-id="${item.id}" data-type="${item.type}" data-url="${item.url || ''}">
                        <i data-lucide="${iconName}" style="color: ${iconColor};" size="18"></i>
                        <span class="file-name" style="font-weight: 500;">${item.name}</span>
                    </div>
                </td>
                <td></td>
                <td style="color: #64748b; font-size: 0.75rem;"></td>
                <td style="color: #64748b; font-size: 0.75rem;"></td>
                <td></td>
                <td></td>
                <td>
                    <div class="row-actions" style="font-size: 0.75rem;">
                        <a href="${item.url || `https://drive.google.com/open?id=${item.id}`}" target="_blank" style="text-decoration: none; color: #3b82f6;"><span>Open</span></a>
                        <span onclick="window.deleteItem('${item.id}')" style="color: #ef4444; cursor: pointer;">Delete</span>
                    </div>
                </td>
            `;

            // Add Click Handler
            const clickable = tr.querySelector('.clickable-item');
            clickable.onclick = (e) => {
                const id = clickable.dataset.id;
                const type = clickable.dataset.type;
                const url = clickable.dataset.url;

                if (type === 'folder') {
                    window.openFolder(id);
                } else {
                    const finalUrl = (url && url !== 'undefined') ? url : `https://drive.google.com/open?id=${id}`;
                    window.open(finalUrl, '_blank');
                }
            };

            fileList.appendChild(tr);
        });

        // Refresh icons for new items
        if (window.lucide) lucide.createIcons();
    }

    function setLoading(isLoading) {
        if (isLoading) {
            loader.classList.remove('hidden');
            resultArea.classList.add('blurred');
        } else {
            loader.classList.add('hidden');
            resultArea.classList.remove('blurred');
        }
    }

    function showError(msg) {
        console.error(msg);
        let userMsg = msg;
        if (msg.includes('Failed to fetch')) {
            userMsg = 'Gagal terhubung ke Google Drive.\n\nSOLUSI:\n1. Pastikan Deployment Akses di set ke "Anyone" (Siapa Saja).\n2. Apps Script Anda berakhiran "/exec".';
        }
        alert(userMsg);
        setLoading(false);
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                uploadFile(e.target.files[0]);
            }
        });
    }

    const uploadLabel = document.getElementById('uploadLabel');
    if (uploadLabel) {
        uploadLabel.addEventListener('click', (e) => {
            e.preventDefault();
            if (isLoggedIn) {
                fileInput.click();
            } else {
                showLoginModal(() => {
                    updateAuthUI();
                    fileInput.click();
                });
            }
        });
    }

    if (createFolderBtn) createFolderBtn.addEventListener('click', () => createFolder());

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (navHistory.length > 0) {
                const prev = navHistory.pop();
                fetchFiles(prev.id, true);
            } else if (parentFolderId) {
                fetchFiles(parentFolderId, true);
            }
        });
    }

    window.openFolder = (id) => fetchFiles(id);
    window.deleteItem = (id) => deleteItem(id);


    // --- Chatbot Logic ---
    const chatWidget = document.getElementById('chat-widget');
    const chatWindow = document.getElementById('chat-window');
    const chatToggleBtn = document.getElementById('chat-toggle-btn');
    const closeChatBtn = document.getElementById('close-chat');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatMessages = document.getElementById('chat-messages');

    if (chatWidget) {
        // Toggle Chat via Logo Text
        const logoText = document.getElementById('logo-text');
        if (logoText) {
            logoText.addEventListener('click', () => {
                chatWindow.classList.toggle('hidden');
                if (!chatWindow.classList.contains('hidden')) {
                    chatInput.focus();
                }
            });
        }

        // Toggle Chat via Floating Button
        if (chatToggleBtn) {
            chatToggleBtn.addEventListener('click', () => {
                chatWindow.classList.toggle('hidden');
                if (!chatWindow.classList.contains('hidden')) {
                    chatInput.focus();
                }
            });
        }

        closeChatBtn.addEventListener('click', () => {
            chatWindow.classList.add('hidden');
        });

        async function processLocalCommand(text) {
            console.log("Processing command:", text);
            const t = text.toLowerCase();

            // Regex for "create folder" patterns
            // Captures: "buatkan folder [testing]", "create folder [testing]", "folder baru [testing]"
            // Flexible matching for "bernama", "named", etc.
            const createFolderRegex = /(?:buat|create|tambah|add|new).*(?:folder|directory).*(?:bernama|named|\s)\s*(.+)/i;
            const simpleFolderRegex = /folder\s+(?:baru|new)?\s*(?:bernama|named)?\s*(.+)/i;

            let match = t.match(createFolderRegex) || t.match(simpleFolderRegex);

            if (match && match[1]) {
                let name = match[1].trim();
                // Remove potential punctuation at the end
                name = name.replace(/[.,!?]$/, '');

                if (name) {
                    appendMessage(`📂 Processing: Creating folder "${name}"...`, 'bot');
                    await createFolder(name);
                    appendMessage(`✅ Folder "${name}" created successfully!`, 'bot');
                    return true;
                }
            }
            return false;
        }

        // Get current Drive context for AI
        function getDriveContext() {
            const files = Array.from(fileList.querySelectorAll('.data-row')).map(tr => {
                const nameEl = tr.querySelector('.file-name');
                const iconEl = tr.querySelector('[data-lucide="folder"]');
                const deleteBtn = tr.querySelector('[onclick*="deleteItem"]');

                // Extract ID from onclick attribute
                let id = null;
                if (deleteBtn) {
                    const onclickAttr = deleteBtn.getAttribute('onclick');
                    const idMatch = onclickAttr.match(/deleteItem\('([^']+)'\)/);
                    if (idMatch) id = idMatch[1];
                }

                return {
                    name: nameEl ? nameEl.textContent : 'Unknown',
                    type: iconEl ? 'folder' : 'file',
                    id: id
                };
            });

            return {
                currentFolder: folderNameDisplay.textContent || 'Root',
                folderId: currentFolderId,
                files: files,
                totalItems: files.length,
                allFiles: allDriveItems // Include global context
            };
        }

        // Send Message
        async function sendMessage() {
            const text = chatInput.value.trim();
            if (!text) return;

            // 1. User Message
            appendMessage(text, 'user');
            chatInput.value = '';

            // 2. Kirim langsung ke AI (Logic Regex lokal dihapus karena sering salah interpretasi 'hapus' jadi 'buat')

            // 3. Loading Indicator
            const loadingId = appendLoading();

            try {
                // 4. Get current Drive context
                const driveContext = getDriveContext();

                // 5. Update history with user message
                chatHistory.push({ role: 'user', content: text });
                if (chatHistory.length > 20) chatHistory.shift(); // Keep last 10 turns

                // 6. Send to Backend with context and history
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: text,
                        context: driveContext,
                        history: chatHistory
                    })
                });

                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}. Did you restart the server?`);
                }

                const data = await response.json();

                // 6. Remove Loading & Show Bot Response
                removeMessage(loadingId);
                appendMessage(data.reply, 'bot');

                // 7. Update history with bot reply
                chatHistory.push({ role: 'bot', content: data.reply });
                if (chatHistory.length > 20) chatHistory.shift();

                // 8. Execute actions if AI suggests any
                if (data.action) {
                    await executeAction(data.action);
                }

            } catch (error) {
                console.error(error);
                removeMessage(loadingId);
                appendMessage("⚠️ Connection Failed. Please RESTART your Node.js server to apply updates.", 'bot');
            }
        }

        // Execute actions suggested by AI
        async function executeAction(action) {
            if (action.type === 'createFolder' && action.name) {
                appendMessage(`📂 Executing: Creating folder "${action.name}"...`, 'bot');
                await createFolder(action.name);
                appendMessage(`✅ Folder "${action.name}" created!`, 'bot');
            } else if (action.type === 'deleteFile' && action.id) {
                await deleteItem(action.id);
                appendMessage(`✅ Item deleted!`, 'bot');
            } else if (action.type === 'openFolder' || action.type === 'openFile') {
                const item = allDriveItems.find(i => i.id === action.id);

                if (item && item.type !== 'folder') {
                    // It's a file, open in new tab
                    const finalUrl = item.url && item.url !== 'undefined' ? item.url : `https://drive.google.com/open?id=${item.id}`;
                    window.open(finalUrl, '_blank');
                    appendMessage(`✅ Membuka file: "${item.name}"`, 'bot');
                } else if (action.id) {
                    await fetchFiles(action.id);
                    appendMessage(`✅ Opened folder!`, 'bot');
                }
            }
        }

        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }

    function appendMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        msgDiv.innerHTML = `<div class="message-content">${text}</div>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return msgDiv;
    }

    function appendLoading() {
        const id = 'loading-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.id = id;
        msgDiv.className = `message bot`;
        msgDiv.innerHTML = `<div class="message-content">Typing...</div>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return id;
    }

    function removeMessage(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    // --- Login Modal Logic ---
    const loginModal = document.getElementById('login-modal');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('loginBtn');
    const cancelLoginBtn = document.getElementById('cancelLoginBtn');
    const authBtn = document.getElementById('authBtn');
    const userBadge = document.getElementById('user-badge');
    let onLoginSuccess = null;

    function updateAuthUI() {
        const authTrigger = document.getElementById('authBtnTrigger');
        if (!authTrigger) return;

        const icon = authTrigger.querySelector('i');
        const span = authTrigger.querySelector('span');
        const userInitial = document.getElementById('user-initial');

        if (isLoggedIn) {
            authTrigger.title = 'Logout Admin';
            authTrigger.classList.add('active');
            if (userBadge) userBadge.classList.remove('hidden');
            if (userDisplay) userDisplay.innerText = 'Administrator';
            if (userInitial) userInitial.innerText = 'A';
            if (icon) icon.setAttribute('data-lucide', 'log-out');
            if (span) span.innerText = 'Logout Admin';
        } else {
            authTrigger.title = 'Admin Login';
            authTrigger.classList.remove('active');
            if (userBadge) userBadge.classList.add('hidden');
            if (userDisplay) userDisplay.innerText = 'Guest';
            if (userInitial) userInitial.innerText = 'G';
            if (icon) icon.setAttribute('data-lucide', 'log-in');
            if (span) span.innerText = 'Login Admin';
        }

        // Re-create icons to apply changes
        if (window.lucide) lucide.createIcons();
    }

    const authTrigger = document.getElementById('authBtnTrigger');
    if (authTrigger) {
        authTrigger.addEventListener('click', () => {
            if (isLoggedIn) {
                isLoggedIn = false;
                updateAuthUI();
                console.log('User logged out');
            } else {
                showLoginModal(() => {
                    updateAuthUI();
                });
            }
        });
    }

    function showLoginModal(callback) {
        onLoginSuccess = callback;
        loginModal.classList.remove('hidden');
        usernameInput.focus();
    }

    function hideLoginModal() {
        loginModal.classList.add('hidden');
        usernameInput.value = '';
        passwordInput.value = '';
        onLoginSuccess = null;
    }

    loginBtn.addEventListener('click', () => {
        const user = usernameInput.value;
        const pass = passwordInput.value;

        if (user === 'admin' && pass === 'admin') {
            isLoggedIn = true;
            const callback = onLoginSuccess;
            hideLoginModal();
            if (callback) callback();
        } else {
            alert('Invalid username or password!');
        }
    });

    cancelLoginBtn.addEventListener('click', hideLoginModal);

    // --- Global Search Logic ---
    const globalSearchInput = document.getElementById('globalSearchInput');
    if (globalSearchInput) {
        globalSearchInput.addEventListener('input', (e) => {
            const term = e.target.value.trim().toLowerCase();

            if (!term) {
                // Return to current folder view
                fetchFiles(currentFolderId, true);
                return;
            }

            // Filter from global context (allDriveItems)
            const results = allDriveItems.filter(item =>
                item.name.toLowerCase().includes(term)
            );

            // Update badge to indicate search mode
            folderNameDisplay.innerText = `Search: "${term}"`;
            folderNameDisplay.dataset.simpleName = 'Search';

            // Render matching items
            renderFiles(results);
        });

        // Clear search on 'Enter' if needed, or just let it filter
        globalSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                globalSearchInput.blur();
            }
        });
    }

    // Initialize UI on load
    updateAuthUI();
});
