document.addEventListener('DOMContentLoaded', async () => {
    const messageForm = document.getElementById('messageForm');
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const micButton = document.getElementById('micButton');
    const sendButton = messageForm.querySelector('button[type="submit"]');
    const clearHistoryButton = document.getElementById('clearHistoryButton');
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

    // Store messages in localStorage with conversation history
    let messages = JSON.parse(localStorage.getItem('chatMessages')) || [];
    
    async function getAIResponse(message, onChunk) {
        const apiKey = await getStoredApiKey();
        if (!apiKey) {
            apiKeyModal.classList.add('show');
            return null;
        }

        try {
            // Build conversation history for context
            const conversationHistory = messages.map(msg => ({
                role: msg.type === 'sent' ? 'user' : 'assistant',
                content: msg.text
            }));

            // Add system message at the start
            conversationHistory.unshift({
                role: "system",
                content: `Your are a helpful german teacher.
                Response in a brief, concise, and comment-free format with no title and only with the following sections:
                Vocabulary: maximum 5 examples.
                Phrases: maximum 5 examples.
                Konjugation: most relevant conjugations in Präsens, Perfekt and Präteritum of the most relevant verb. 
                At the end of your response, suggest 3 suitable follow-up questions under the heading 'Next questions:'.\nFormat:\nNEXT_QUESTIONS:\n1) …\n2) …\n3) …`
            });

            // Add the new user message
            conversationHistory.push({
                role: 'user',
                content: message
            });

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4',
                    messages: conversationHistory,
                    temperature: 0.7,
                    stream: true
                })
            });

            if (!response.ok) {
                throw new Error('API request failed');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                // Decode the chunk
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const jsonData = JSON.parse(line.slice(6));
                            const content = jsonData.choices[0]?.delta?.content;
                            if (content) {
                                fullResponse += content;
                                onChunk(content);
                            }
                        } catch (e) {
                            console.error('Error parsing chunk:', e);
                        }
                    }
                }
            }

            return fullResponse;
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

        // Create response message container
        const responseDiv = document.createElement('div');
        responseDiv.className = 'message received';
        const contentDiv = document.createElement('div');
        contentDiv.className = 'markdown-content';
        responseDiv.appendChild(contentDiv);
        chatMessages.appendChild(responseDiv);
        scrollToBottom();

        let accumulatedText = '';
        let mainContent = '';
        let questionsContent = '';
        let isCollectingQuestions = false;
        
        // Get AI response with streaming
        const fullResponse = await getAIResponse(text, (chunk) => {
            accumulatedText += chunk;
            
            // Check if we've hit the questions section
            if (accumulatedText.includes('Next questions:') || accumulatedText.includes('NEXT_QUESTIONS:')) {
                if (!isCollectingQuestions) {
                    isCollectingQuestions = true;
                    // Split content at the questions marker
                    const parts = accumulatedText.split(/(?:Next questions:|NEXT_QUESTIONS:)/i);
                    mainContent = parts[0];
                    questionsContent = parts[1] || '';
                    
                    // Update the main content one last time
                    contentDiv.innerHTML = marked.parse(mainContent.trim(), {
                        breaks: true,
                        gfm: true
                    });
                    contentDiv.querySelectorAll('pre code').forEach((block) => {
                        hljs.highlightElement(block);
                    });
                } else {
                    // Just collect questions without rendering
                    questionsContent = accumulatedText.split(/(?:Next questions:|NEXT_QUESTIONS:)/i)[1] || '';
                }
            } else if (!isCollectingQuestions) {
                // Normal content rendering
                contentDiv.innerHTML = marked.parse(accumulatedText, {
                    breaks: true,
                    gfm: true
                });
                contentDiv.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            }
            scrollToBottom();
        });

        if (fullResponse) {
            // Save the complete message
            const response = {
                text: fullResponse,
                type: 'received',
                timestamp: new Date().toISOString()
            };
            messages.push(response);
            localStorage.setItem('chatMessages', JSON.stringify(messages));

            // Add follow-up questions if present
            if (questionsContent) {
                const questionsDiv = document.createElement('div');
                questionsDiv.className = 'follow-up-questions';
                
                const questions = questionsContent.trim().split('\n')
                    .map(q => q.trim())
                    .filter(q => q && q.match(/^\d+\)/))
                    .map(q => q.replace(/^\d+\)\s*/, ''));

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

                responseDiv.appendChild(questionsDiv);
            }
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
        
        if (message.type === 'received') {
            // Split the message if it contains follow-up questions
            const [mainText, questionsText] = message.text.includes('NEXT_QUESTIONS:') 
                ? message.text.split('NEXT_QUESTIONS:')
                : [message.text, ''];

            // Create markdown content div
            const contentDiv = document.createElement('div');
            contentDiv.className = 'markdown-content';
            // Use marked to render markdown
            contentDiv.innerHTML = marked.parse(mainText.trim(), {
                breaks: true,
                gfm: true
            });
            // Apply syntax highlighting to code blocks
            contentDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
            div.appendChild(contentDiv);

            // Add follow-up questions as buttons if they exist
            if (questionsText) {
                const questionsDiv = document.createElement('div');
                questionsDiv.className = 'follow-up-questions';
                
                const questions = questionsText.trim().split('\n')
                    .map(q => q.trim())
                    .filter(q => q && q.match(/^\d+\)/))
                    .map(q => q.replace(/^\d+\)\s*/, ''));

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
            // User messages remain as plain text
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

    // Add clear history functionality
    clearHistoryButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the chat history?')) {
            messages = [];
            localStorage.removeItem('chatMessages');
            chatMessages.innerHTML = '';
        }
    });
}); 