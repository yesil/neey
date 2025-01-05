document.addEventListener('DOMContentLoaded', async () => {
    const messageForm = document.getElementById('messageForm');
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const micButton = document.getElementById('micButton');
    const sendButton = messageForm.querySelector('button[type="submit"]');
    const apiKeyModal = document.getElementById('apiKeyModal');
    const apiKeyForm = document.getElementById('apiKeyForm');

    // QR Scanner Elements
    const scanQrButton = document.getElementById('scanQrButton');
    const qrScannerModal = document.getElementById('qrScannerModal');
    const closeScanner = document.getElementById('closeScanner');
    const qrVideo = document.getElementById('qrVideo');
    let videoStream = null;

    // Check if the browser supports the required crypto APIs
    if (!window.crypto || !window.crypto.subtle) {
        alert('Your browser does not support the required security features. Please use a modern browser.');
        return;
    }

    // Generate a random encryption key and store it
    let encryptionKey;
    if (!localStorage.getItem('encryption_key')) {
        const key = await window.crypto.subtle.generateKey(
            {
                name: 'AES-GCM',
                length: 256
            },
            true,
            ['encrypt', 'decrypt']
        );
        const exportedKey = await window.crypto.subtle.exportKey('raw', key);
        const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
        localStorage.setItem('encryption_key', keyBase64);
        encryptionKey = key;
    } else {
        const keyBase64 = localStorage.getItem('encryption_key');
        const keyBuffer = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
        encryptionKey = await window.crypto.subtle.importKey(
            'raw',
            keyBuffer,
            'AES-GCM',
            true,
            ['encrypt', 'decrypt']
        );
    }

    // Encryption function
    async function encryptData(text) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encodedText = new TextEncoder().encode(text);

        const ciphertext = await window.crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            encryptionKey,
            encodedText
        );

        const encryptedData = {
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(ciphertext))
        };

        return btoa(JSON.stringify(encryptedData));
    }

    // Decryption function
    async function decryptData(encryptedString) {
        try {
            const { iv, data } = JSON.parse(atob(encryptedString));
            const decrypted = await window.crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: new Uint8Array(iv)
                },
                encryptionKey,
                new Uint8Array(data)
            );

            return new TextDecoder().decode(decrypted);
        } catch (error) {
            console.error('Decryption error:', error);
            return null;
        }
    }

    // Get stored API key
    async function getStoredApiKey() {
        const encryptedKey = localStorage.getItem('openai_api_key');
        if (!encryptedKey) return null;
        return await decryptData(encryptedKey);
    }

    // Show API key modal if no key is stored
    const storedKey = await getStoredApiKey();
    if (!storedKey) {
        apiKeyModal.classList.add('show');
    }

    // Handle API key submission
    apiKeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const apiKey = document.getElementById('apiKeyInput').value.trim();
        if (apiKey) {
            const encryptedKey = await encryptData(apiKey);
            localStorage.setItem('openai_api_key', encryptedKey);
            apiKeyModal.classList.remove('show');
        }
    });

    async function getAIResponse(message) {
        const apiKey = await getStoredApiKey();
        if (!apiKey) {
            apiKeyModal.classList.add('show');
            return null;
        }

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: [ 
                        {
                            role: "system", 
                            content: "Provide a brief, concise, and comment-free answer in the language the user asked the question. At the end of your response, suggest 3 suitable follow-up questions under the heading 'NEXT_QUESTIONS:'.\nFormat:\nNEXT_QUESTIONS:\n1) …\n2) …\n3) …",
                        },
                        {
                            role: 'user',
                            content: message
                        }
                    ],
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error('API request failed');
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error('Error calling OpenAI API:', error);
            return 'Sorry, I encountered an error processing your message.';
        }
    }

    async function sendMessage(text) {
        if (!text.trim()) return;

        // Create and display user message
        const message = {
            text: text.trim(),
            type: 'sent',
            timestamp: new Date().toISOString()
        };
        messages.push(message);
        localStorage.setItem('chatMessages', JSON.stringify(messages));

        const messageElement = createMessageElement(message);
        chatMessages.appendChild(messageElement);
        scrollToBottom();

        // Clear input
        messageInput.value = '';

        // Add thinking indicator
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'message received thinking';
        thinkingDiv.textContent = 'Thinking...';
        chatMessages.appendChild(thinkingDiv);
        scrollToBottom();

        // Get AI response
        const aiResponse = await getAIResponse(text);

        // Remove thinking indicator
        chatMessages.removeChild(thinkingDiv);

        if (aiResponse) {
            const response = {
                text: aiResponse,
                type: 'received',
                timestamp: new Date().toISOString()
            };
            messages.push(response);
            localStorage.setItem('chatMessages', JSON.stringify(messages));

            const responseElement = createMessageElement(response);
            chatMessages.appendChild(responseElement);
            scrollToBottom();
        }
    }

    // Check if speech recognition is supported
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isListening = false;

    function toggleSendButtonToCancelMode(showCancel) {
        if (showCancel) {
            sendButton.innerHTML = '<span class="material-icons">close</span>';
            sendButton.classList.add('cancel-button');
            sendButton.type = 'button';
        } else {
            sendButton.textContent = 'Send';
            sendButton.classList.remove('cancel-button');
            sendButton.type = 'submit';
        }
    }

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isListening = true;
            micButton.classList.add('active');
            messageInput.placeholder = 'Listening...';
            toggleSendButtonToCancelMode(true);
        };

        recognition.onend = () => {
            isListening = false;
            micButton.classList.remove('active');
            messageInput.placeholder = 'Type a message...';
            toggleSendButtonToCancelMode(false);

            if (messageInput.value.trim() && !wasRecognitionCancelled) {
                sendMessage(messageInput.value);
            }
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            messageInput.value = transcript;
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            isListening = false;
            micButton.classList.remove('active');
            messageInput.placeholder = 'Type a message...';
            toggleSendButtonToCancelMode(false);
        };

        let wasRecognitionCancelled = false;

        micButton.addEventListener('click', () => {
            if (isListening) {
                wasRecognitionCancelled = true;
                recognition.stop();
            } else {
                wasRecognitionCancelled = false;
                recognition.start();
            }
        });

        sendButton.addEventListener('click', (e) => {
            if (isListening) {
                e.preventDefault();
                wasRecognitionCancelled = true;
                recognition.stop();
                messageInput.value = '';
            }
        });
    } else {
        micButton.style.display = 'none';
    }

    // Store messages in localStorage
    let messages = JSON.parse(localStorage.getItem('chatMessages')) || [];

    function displayMessages() {
        chatMessages.innerHTML = '';
        messages.forEach(message => {
            const messageElement = createMessageElement(message);
            chatMessages.appendChild(messageElement);
        });
        scrollToBottom();
    }

    function createMessageElement(message) {
        const div = document.createElement('div');
        div.classList.add('message', message.type);
        
        // Split the message if it contains follow-up questions
        if (message.type === 'received' && message.text.includes('NEXT_QUESTIONS:')) {
            const [mainText, questionsText] = message.text.split('NEXT_QUESTIONS:');
            
            // Add main message text
            const textDiv = document.createElement('div');
            textDiv.textContent = mainText.trim();
            div.appendChild(textDiv);

            // Add follow-up questions as buttons
            if (questionsText) {
                const questionsDiv = document.createElement('div');
                questionsDiv.className = 'follow-up-questions';
                
                // Extract questions and create buttons
                const questions = questionsText.trim().split('\n')
                    .map(q => q.trim())
                    .filter(q => q && q.match(/^\d+\)/)) // Only process numbered questions
                    .map(q => q.replace(/^\d+\)\s*/, '')); // Remove the numbering

                questions.forEach(question => {
                    const button = document.createElement('button');
                    button.className = 'follow-up-button';
                    button.textContent = question;
                    button.addEventListener('click', () => {
                        messageInput.value = question;
                        sendMessage(question);
                    });
                    questionsDiv.appendChild(button);
                });

                div.appendChild(questionsDiv);
            }
        } else {
            div.textContent = message.text;
        }

        return div;
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage(messageInput.value);
    });

    displayMessages();

    // QR Scanner Functions
    async function startQrScanner() {
        try {
            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };

            videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            qrVideo.srcObject = videoStream;
            qrVideo.play();

            // Start scanning frames
            requestAnimationFrame(scanQrCode);
        } catch (error) {
            console.error('Error accessing camera:', error);
            alert('Unable to access camera. Please check permissions.');
        }
    }

    function stopQrScanner() {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            videoStream = null;
        }
        qrVideo.srcObject = null;
        qrScannerModal.classList.remove('show');
    }

    async function scanQrCode() {
        if (!videoStream) return;

        try {
            // Create a temporary canvas to process the video frame
            const canvas = document.createElement('canvas');
            canvas.width = qrVideo.videoWidth;
            canvas.height = qrVideo.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);

            // Get the image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Try jsQR library
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            
            if (code) {
                const apiKey = code.data;
                console.log('Found QR code:', apiKey); // For debugging
                if (apiKey.startsWith('sk-')) {
                    document.getElementById('apiKeyInput').value = apiKey;
                    stopQrScanner();
                    return;
                }
            }

            // Continue scanning if no valid QR code was found
            requestAnimationFrame(scanQrCode);
        } catch (error) {
            console.error('Error scanning QR code:', error);
            // Continue scanning even if there's an error
            requestAnimationFrame(scanQrCode);
        }
    }

    // Event Listeners for QR Scanner
    scanQrButton.addEventListener('click', () => {
        qrScannerModal.classList.add('show');
        startQrScanner();
    });

    closeScanner.addEventListener('click', stopQrScanner);

    // Check if the browser supports the required APIs
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        scanQrButton.style.display = 'none';
    }
}); 