const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const games = {}; 

const initialBoard = [
    2, 0, 0, 0, 0, -5, 
    0, -3, 0, 0, 0, 5, 
    -5, 0, 0, 0, 3, 0, 
    5, 0, 0, 0, 0, -2 
];

// Güvenli veri gönderimi (history'i gönderme)
function sanitizeState(gameState) {
    const clean = { ...gameState };
    delete clean.turnHistory; 
    return clean;
}

io.on('connection', (socket) => {
    console.log('Bağlantı:', socket.id);

    socket.on('joinGame', ({ roomId, username }) => {
        socket.join(roomId);
        const room = io.sockets.adapter.rooms.get(roomId);
        
        if (!games[roomId]) {
            games[roomId] = {
                board: [...initialBoard],
                bar: { white: 0, black: 0 },
                collected: { white: 0, black: 0 },
                turn: 1,
                dice: [],
                players: { white: null, black: null },
                turnHistory: [] // Adım adım geri alma için liste
            };
        }

        const game = games[roomId];
        if (!game.players.white) {
            game.players.white = username;
            socket.emit('init', { color: 1, roomId, state: sanitizeState(game) });
        } else if (!game.players.black) {
            game.players.black = username;
            socket.emit('init', { color: -1, roomId, state: sanitizeState(game) });
            io.to(roomId).emit('updateGameState', sanitizeState(game));
        } else {
            // İzleyici veya yeniden bağlanma
            const color = game.players.white === username ? 1 : (game.players.black === username ? -1 : 0);
            socket.emit('init', { color, roomId, state: sanitizeState(game) });
        }
    });

    // ZAR ATILDI (Yeni Tur Başlangıcı)
    socket.on('diceRolled', (data) => {
        if (games[data.roomId]) {
            games[data.roomId] = data.state;
            // Yeni tur, geçmişi sıfırla ve şu anki hali kaydet
            games[data.roomId].turnHistory = [JSON.parse(JSON.stringify(data.state))];
            io.to(data.roomId).emit('updateGameState', sanitizeState(games[data.roomId]));
        }
    });

    // HAMLE YAPILDI (Geçmişe Ekle)
    socket.on('makeMove', (data) => {
        if (games[data.roomId]) {
            // Önceki durumu geçmişe ekle (zaten diceRolled'da ilk hal var, bu ara hamleler için)
            // İstemci zaten state'i güncelleyip gönderiyor, biz onu kaydetmeden önce
            // MEVCUT sunucu state'ini history'e eklemeliyiz.
            
            // DİKKAT: İstemciden gelen 'state' son haldir. 
            // Biz sunucudaki 'eski' hali history'e atmalıyız ki geri dönebilelim.
            // Ama history zaten adım adım gidiyor.
            
            // Basit mantık: Her hamlede sunucudaki mevcut state'i history'e pushla, sonra güncelle.
            const currentState = JSON.parse(JSON.stringify(games[data.roomId]));
            delete currentState.turnHistory; // History içinde history olmasın
            
            games[data.roomId].turnHistory.push(currentState);
            games[data.roomId].board = data.state.board;
            games[data.roomId].dice = data.state.dice;
            games[data.roomId].bar = data.state.bar;
            games[data.roomId].collected = data.state.collected;
            games[data.roomId].turn = data.state.turn;

            io.to(data.roomId).emit('updateGameState', sanitizeState(games[data.roomId]));
        }
    });

    // GERİ AL (Adım Adım)
    socket.on('undoMove', (roomId) => {
        const game = games[roomId];
        if (game && game.turnHistory && game.turnHistory.length > 1) {
            // Son durumu history'den çıkar (pop)
            // Şu anki bozuk/istenmeyen hamle history'de değil, game state'te.
            // History'nin son elemanı, bir önceki geçerli durumdur.
            
            const previousState = game.turnHistory.pop(); // Son kaydedilen geçerli duruma dön
            
            // State'i güncelle
            game.board = previousState.board;
            game.dice = previousState.dice;
            game.bar = previousState.bar;
            game.collected = previousState.collected;
            game.turn = previousState.turn;
            
            // turnHistory zaten poplandı, array kısaldı.
            
            io.to(roomId).emit('updateGameState', sanitizeState(game));
        }
    });

    socket.on('disconnect', () => { console.log('Ayrıldı:', socket.id); });
});

server.listen(3000, () => { console.log('Sunucu: 3000'); });