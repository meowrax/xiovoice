const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const clients = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/create-room', (req, res) => {
    const roomId = uuidv4().slice(0, 8);
    const adminKey = uuidv4().slice(0, 12);
    
    rooms.set(roomId, {
        id: roomId,
        adminKey: adminKey,
        createdAt: Date.now(),
        participants: new Map(),
        messages: []
    });
    
    res.json({ roomId, adminKey, link: `/room/${roomId}` });
});

app.get('/api/room/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    res.json({ 
        exists: true, 
        participantCount: room.participants.size 
    });
});

function broadcast(roomId, message, excludeClientId = null) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.participants.forEach((participant, odId) => {
        if (excludeClientId && odId === excludeClientId) return;
        const client = clients.get(odId
        );
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    });
}

function sendToClient(clientId, message) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
    }
}

wss.on('connection', (ws) => {
    const clientId = uuidv4();
    clients.set(clientId, { ws, roomId: null, nickname: null, odId: null });
    
    ws.send(JSON.stringify({ type: 'connected', clientId }));
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(clientId, message);
        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    });
    
    ws.on('close', () => {
        const client = clients.get(clientId);
        if (client && client.roomId) {
            const room = rooms.get(client.roomId);
            if (room) {
                room.participants.delete(clientId);
                broadcast(client.roomId, {
                    type: 'user-left',
                    clientId,
                    nickname: client.nickname
                });
                
                broadcast(client.roomId, {
                    type: 'participants-update',
                    participants: Array.from(room.participants.values())
                });
            }
        }
        clients.delete(clientId);
    });
});

function handleMessage(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;
    
    switch (message.type) {
        case 'join-room': {
            const { roomId, nickname } = message;
            const room = rooms.get(roomId);
            
            if (!room) {
                sendToClient(clientId, { type: 'error', message: 'Комната не найдена' });
                return;
            }
            
            const userKey = uuidv4().slice(0, 8);
            client.roomId = roomId;
            client.nickname = nickname;
            client.userKey = userKey;
            
            room.participants.set(clientId, {
                id: clientId,
                nickname,
                userKey,
                joinedAt: Date.now(),
                isMuted: false,
                isDeafened: false,
                isScreenSharing: false
            });
            
            sendToClient(clientId, {
                type: 'joined',
                roomId,
                userKey,
                participants: Array.from(room.participants.values()),
                messages: room.messages.slice(-50)
            });
            
            broadcast(roomId, {
                type: 'user-joined',
                user: {
                    id: clientId,
                    nickname,
                    userKey
                }
            }, clientId);
            
            broadcast(roomId, {
                type: 'participants-update',
                participants: Array.from(room.participants.values())
            });
            break;
        }
        
        case 'chat-message': {
            const { roomId, content, image } = message;
            const room = rooms.get(roomId);
            if (!room) return;
            
            const chatMessage = {
                id: uuidv4(),
                senderId: clientId,
                senderName: client.nickname,
                content,
                image,
                timestamp: Date.now()
            };
            
            room.messages.push(chatMessage);
            if (room.messages.length > 200) {
                room.messages = room.messages.slice(-100);
            }
            
            broadcast(roomId, {
                type: 'chat-message',
                message: chatMessage
            });
            break;
        }
        
        case 'webrtc-offer': {
            const { targetId, offer } = message;
            sendToClient(targetId, {
                type: 'webrtc-offer',
                senderId: clientId,
                senderName: client.nickname,
                offer
            });
            break;
        }
        
        case 'webrtc-answer': {
            const { targetId, answer } = message;
            sendToClient(targetId, {
                type: 'webrtc-answer',
                senderId: clientId,
                answer
            });
            break;
        }
        
        case 'webrtc-ice-candidate': {
            const { targetId, candidate } = message;
            sendToClient(targetId, {
                type: 'webrtc-ice-candidate',
                senderId: clientId,
                candidate
            });
            break;
        }
        
        case 'toggle-mute': {
            const room = rooms.get(client.roomId);
            if (!room) return;
            
            const participant = room.participants.get(clientId);
            if (participant) {
                participant.isMuted = message.isMuted;
                broadcast(client.roomId, {
                    type: 'user-mute-changed',
                    clientId,
                    isMuted: message.isMuted
                });
            }
            break;
        }
        
        case 'toggle-deafen': {
            const room = rooms.get(client.roomId);
            if (!room) return;
            
            const participant = room.participants.get(clientId);
            if (participant) {
                participant.isDeafened = message.isDeafened;
                broadcast(client.roomId, {
                    type: 'user-deafen-changed',
                    clientId,
                    isDeafened: message.isDeafened
                });
            }
            break;
        }
        
        case 'screen-share-started': {
            const room = rooms.get(client.roomId);
            if (!room) return;
            
            const participant = room.participants.get(clientId);
            if (participant) {
                participant.isScreenSharing = true;
                broadcast(client.roomId, {
                    type: 'screen-share-started',
                    clientId,
                    nickname: client.nickname
                });
            }
            break;
        }
        
        case 'screen-share-stopped': {
            const room = rooms.get(client.roomId);
            if (!room) return;
            
            const participant = room.participants.get(clientId);
            if (participant) {
                participant.isScreenSharing = false;
                broadcast(client.roomId, {
                    type: 'screen-share-stopped',
                    clientId
                });
            }
            break;
        }
        
        case 'request-screen': {
            const { targetId } = message;
            sendToClient(targetId, {
                type: 'screen-requested',
                requesterId: clientId
            });
            break;
        }
    }
}

setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    
    rooms.forEach((room, roomId) => {
        if (room.participants.size === 0 && now - room.createdAt > maxAge) {
            rooms.delete(roomId);
        }
    });
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

