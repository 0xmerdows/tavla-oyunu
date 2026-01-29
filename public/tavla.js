const socket = io();

let myColor = 0; 
let currentRoom = "";
let myUsername = "";
let gameState = null;
let selectedIndex = null; // -99: Beyaz Bar, -98: Siyah Bar, 0-23: Tahta

// --- BAĞLANTI ---
function joinRoom() {
    const roomName = document.getElementById('roomInput').value;
    const username = document.getElementById('usernameInput').value;
    if (!roomName || !username) { alert("Bilgileri girin!"); return; }
    myUsername = username;
    socket.emit('joinGame', { roomId: roomName, username });
}

socket.on('init', (data) => {
    document.getElementById('login-screen').style.display = 'none';
    document.querySelector('.game-container').style.display = 'flex';
    myColor = data.color;
    currentRoom = data.roomId;
    gameState = data.state;
    updateVisuals();
});

socket.on('updateGameState', (newState) => {
    gameState = newState;
    selectedIndex = null;
    updateVisuals();
});

// --- KONTROLLER ---
function visualRollDice() {
    if (gameState.turn !== myColor) return;
    const diceContainer = document.getElementById('dice-display');
    diceContainer.innerHTML = '<div class="die shaking">?</div><div class="die shaking">?</div>';
    
    setTimeout(() => {
        const d1 = Math.ceil(Math.random() * 6);
        const d2 = Math.ceil(Math.random() * 6);
        gameState.dice = (d1 === d2) ? [d1, d1, d1, d1] : [d1, d2];
        socket.emit('diceRolled', { roomId: currentRoom, state: gameState });
        updateVisuals();
    }, 600);
}

function requestUndo() {
    socket.emit('undoMove', currentRoom);
}

function passTurn() {
    if (confirm("Pas geçmek istiyor musun?")) {
        gameState.dice = [];
        gameState.turn *= -1;
        socket.emit('makeMove', { roomId: currentRoom, state: gameState });
    }
}

// --- OYUN MANTIĞI (PATHFINDING) ---

// Tüm taşlar evde mi? (Taş toplama kuralı)
function canBearOff(player) {
    if (player === 1 && gameState.bar.white > 0) return false;
    if (player === -1 && gameState.bar.black > 0) return false;

    for (let i = 0; i < 24; i++) {
        if (gameState.board[i] !== 0) {
            const owner = gameState.board[i] > 0 ? 1 : -1;
            if (owner === player) {
                // Beyaz evi: 18-23. Eğer 0-17 arasında taşı varsa toplayamaz.
                if (player === 1 && i < 18) return false;
                // Siyah evi: 0-5. Eğer 6-23 arasında taşı varsa toplayamaz.
                if (player === -1 && i > 5) return false;
            }
        }
    }
    return true;
}

// Belirli bir noktadan, belirli zarlarla gidilebilecek yerleri bulur
function getValidMoves(startIdx, dice, player) {
    let moves = []; // { target: int, usedDice: [], path: [] }
    
    // Recursive fonksiyon: currentIdx'den kalan zarlarla nereye gidebilirim?
    function findPaths(currentIdx, availableDice, pathDice) {
        // Zarları tek tek dene
        let uniqueDice = [...new Set(availableDice)];
        
        uniqueDice.forEach(die => {
            // Hedef hesapla
            let targetIdx;
            let isBearOff = false;

            if (currentIdx === -99) targetIdx = die - 1; // Beyaz Bar -> 0..5
            else if (currentIdx === -98) targetIdx = 24 - die; // Siyah Bar -> 23..18
            else {
                // Tahtadan ilerle
                targetIdx = (player === 1) ? currentIdx + die : currentIdx - die;
            }

            // --- TAŞ TOPLAMA (BEARING OFF) ---
            // Hedef tahta dışı mı?
            if ((player === 1 && targetIdx > 23) || (player === -1 && targetIdx < 0)) {
                if (canBearOff(player)) {
                    // Tam oturan zar mı? Veya daha büyük zarla en uzaktaki taşı mı alıyor?
                    let canOut = false;
                    if (targetIdx === 24 || targetIdx === -1) canOut = true; // Tam oturdu
                    else {
                        // Zar büyük geldi. Eğer daha geride taş yoksa çıkabilir.
                        // Örn: Beyaz 6 attı, taşı 5. hanede (target 11). 6. hanede taş yoksa çıkabilir.
                        // Bu basit versiyonda: Sadece tam oturan veya target dışı olanı kabul edelim.
                        // Gelişmiş kural: 
                        let distance = (player === 1) ? 24 - currentIdx : currentIdx + 1; // Çıkışa mesafe
                        if (die >= distance) {
                             // Büyük zarla çıkma kuralı: Arkada (daha yüksek pointte) taş olmamalı.
                             let hasBehind = false;
                             if(player === 1) {
                                 for(let k=18; k<currentIdx; k++) if(gameState.board[k]>0) hasBehind=true;
                             } else {
                                 for(let k=currentIdx+1; k<=5; k++) if(gameState.board[k]<0) hasBehind=true;
                             }
                             if(!hasBehind) canOut = true;
                        }
                    }

                    if (canOut) {
                        // Çıkış hamlesi geçerli
                        let newPath = [...pathDice, die];
                        let remaining = [...availableDice];
                        remaining.splice(remaining.indexOf(die), 1);
                        
                        // Özel Target ID'leri: Beyaz Çıkış 25, Siyah Çıkış -2
                        let outId = (player === 1) ? 25 : -2;
                        
                        // Daha önce bu hedefe bu zarlarla gitmiş miyiz?
                        if(!moves.some(m => m.target === outId && m.usedDice.length === newPath.length)) {
                            moves.push({ target: outId, usedDice: newPath });
                        }
                        // Çıktıktan sonra devam edemezsin, return.
                        // (Çift zarda diğer zarlar başka taşla oynanır)
                    }
                }
                return; // Tahta dışına taşarsa ve çıkamazsa bu yol biter.
            }

            // --- NORMAL HAMLE ---
            // Hedef müsait mi?
            let count = gameState.board[targetIdx];
            let blocked = (player === 1 && count < -1) || (player === -1 && count > 1);

            if (!blocked) {
                // Bu noktaya geldik. Kaydet.
                let newPath = [...pathDice, die];
                let remaining = [...availableDice];
                remaining.splice(remaining.indexOf(die), 1);

                // Bu bir geçerli durak noktasıdır.
                // Mevcut path daha kısaysa güncelle veya yenisini ekle
                let existing = moves.find(m => m.target === targetIdx);
                if (!existing || existing.usedDice.length < newPath.length) {
                    if(existing) moves = moves.filter(m => m.target !== targetIdx); // Eskiyi sil
                    moves.push({ target: targetIdx, usedDice: newPath });
                }

                // Eğer daha zar varsa, buradan yürümeye devam et (RECURSION)
                if (remaining.length > 0) {
                    findPaths(targetIdx, remaining, newPath);
                }
            }
        });
    }

    findPaths(startIdx, dice, []);
    return moves;
}

function handlePointClick(index) {
    if (gameState.turn !== myColor) return;
    if (gameState.dice.length === 0) return;
    
    const player = gameState.turn;

    // Kırık taş kontrolü
    if (player === 1 && gameState.bar.white > 0 && selectedIndex !== -99) {
        alert("Bar'daki taşa tıklayın!"); return;
    }
    if (player === -1 && gameState.bar.black > 0 && selectedIndex !== -98) {
        alert("Bar'daki taşa tıklayın!"); return;
    }

    // Seçim yoksa -> Seç
    if (selectedIndex === null) {
        // Taş var mı?
        if (index >= 0 && index <= 23) {
             if (gameState.board[index] === 0) return;
             if (player === 1 && gameState.board[index] < 0) return;
             if (player === -1 && gameState.board[index] > 0) return;
        }
        // Toplama alanı tıklaması engelle (seçim yokken)
        if (index === 25 || index === -2) return;

        selectedIndex = index;
        updateVisuals();
        highlightMoves();
    } 
    // Seçim varsa -> Hamle veya Değiştir
    else {
        if (selectedIndex === index) { selectedIndex = null; updateVisuals(); return; }

        // Kendi taşına tıkladıysa seçimi değiştir (eğer hamle değilse)
        // Ama önce hamle mi diye bakmalıyız. 
        // Burada basitlik adına: Eğer hedef yeşil yanıyorsa (validMoves içindeyse) hamledir.
        
        let validMoves = getValidMoves(selectedIndex, gameState.dice, player);
        let move = validMoves.find(m => m.target === index);

        if (move) {
            executeMove(selectedIndex, index, move.usedDice);
        } else {
            // Hamle değil, o zaman seçim değiştirmeyi dene
            if (index >= 0 && index <= 23) {
                let isMine = (player === 1 && gameState.board[index] > 0) || (player === -1 && gameState.board[index] < 0);
                if (isMine) {
                    selectedIndex = index;
                    updateVisuals();
                    highlightMoves();
                }
            }
        }
    }
}

function handleBarClick(type) {
    if (gameState.turn !== myColor) return;
    // Sadece kendi barını seçebilir
    if (type === 'white' && myColor === 1 && gameState.bar.white > 0) {
        selectedIndex = -99; updateVisuals(); highlightMoves();
    }
    if (type === 'black' && myColor === -1 && gameState.bar.black > 0) {
        selectedIndex = -98; updateVisuals(); highlightMoves();
    }
}

// Taş Toplama Alanına Tıklama (Sağdaki boşluklar veya özel alan)
function handleBearOffClick() {
    if (selectedIndex === null) return;
    let targetId = (myColor === 1) ? 25 : -2;
    
    let validMoves = getValidMoves(selectedIndex, gameState.dice, myColor);
    let move = validMoves.find(m => m.target === targetId);
    
    if (move) {
        executeMove(selectedIndex, targetId, move.usedDice);
    }
}

function executeMove(from, to, diceUsed) {
    const player = gameState.turn;

    // 1. Kaynaktan düş
    if (from === -99) gameState.bar.white--;
    else if (from === -98) gameState.bar.black--;
    else gameState.board[from] -= player;

    // 2. Hedefe ekle (veya topla)
    if (to === 25) {
        gameState.collected.white++;
    } else if (to === -2) {
        gameState.collected.black++;
    } else {
        // Vurma kontrolü
        if (player === 1 && gameState.board[to] === -1) {
            gameState.bar.black++; gameState.board[to] = 1;
        } else if (player === -1 && gameState.board[to] === 1) {
            gameState.bar.white++; gameState.board[to] = -1;
        } else {
            gameState.board[to] += player;
        }
    }

    // 3. Zarları sil
    for (let d of diceUsed) {
        let idx = gameState.dice.indexOf(d);
        if (idx > -1) gameState.dice.splice(idx, 1);
    }

    // 4. Tur değişimi
    if (gameState.dice.length === 0) gameState.turn *= -1;

    // SERVER'A GÖNDER (makeMove eventi ile history kaydedilecek)
    socket.emit('makeMove', { roomId: currentRoom, state: gameState });
    
    selectedIndex = null;
    updateVisuals();
}

function highlightMoves() {
    if (selectedIndex === null) return;
    let moves = getValidMoves(selectedIndex, gameState.dice, gameState.turn);
    
    moves.forEach(m => {
        if (m.target === 25 || m.target === -2) {
            // Toplama alanı parlasın
            document.querySelector('.middle-area').style.boxShadow = "inset 0 0 20px #2ecc71";
        } else {
            const p = document.getElementById(`point-${m.target}`);
            if (p) p.classList.add('valid-target');
        }
    });
}

function updateVisuals() {
    // Temizlik
    document.querySelectorAll('.valid-target').forEach(e => e.classList.remove('valid-target'));
    document.querySelector('.middle-area').style.boxShadow = "none";
    
    // Tahta çizimi
    for (let i = 0; i < 24; i++) {
        const p = document.getElementById(`point-${i}`);
        p.innerHTML = "";
        p.className = "point";
        if (i === selectedIndex) p.classList.add("selected-point");
        p.onclick = () => handlePointClick(i);

        let count = gameState.board[i];
        if (count !== 0) {
            let cColor = count > 0 ? "white" : "black";
            for (let k = 0; k < Math.abs(count); k++) {
                let div = document.createElement("div");
                div.className = `checker ${cColor}`;
                p.appendChild(div);
            }
        }
    }

    // Barlar
    renderBar('bar-top', gameState.bar.white, 'white');
    renderBar('bar-bottom', gameState.bar.black, 'black');

    // İstatistikler
    document.getElementById('turn-display').innerText = gameState.turn===1 ? "Sıra: BEYAZ" : "Sıra: SİYAH";
    
    // Toplanan Taşlar Göstergesi (Yeni)
    // Bunu CSS ile eklemek gerekir ama şimdilik text olarak butonların oraya yazalım
    let info = `Toplanan - B:${gameState.collected.white} S:${gameState.collected.black}`;
    let diceDiv = document.getElementById('dice-display');
    if(gameState.dice.length > 0) {
        diceDiv.innerHTML = gameState.dice.map(d=>`<div class="die">${d}</div>`).join('') + `<br><small>${info}</small>`;
    } else {
        diceDiv.innerHTML = `Zar Atın<br><small>${info}</small>`;
    }
    
    // Butonlar
    const btnRoll = document.getElementById('btn-roll');
    const btnUndo = document.getElementById('btn-undo');
    
    if (gameState.turn === myColor) {
        if (gameState.dice.length === 0) {
            btnRoll.style.display = 'inline-block';
            btnUndo.style.display = 'none';
        } else {
            btnRoll.style.display = 'none';
            btnUndo.style.display = 'inline-block';
            btnUndo.innerText = "Geri Al"; // Metni güncelle
        }
    } else {
        btnRoll.style.display = 'none';
        btnUndo.style.display = 'none';
    }
    
    // Toplama alanı için event listener (Middle area'ya tıklayınca toplasın)
    document.querySelector('.middle-area').onclick = handleBearOffClick;
}

function renderBar(id, count, color) {
    const el = document.getElementById(id);
    el.innerHTML = "";
    el.className = "bar";
    if ((color==='white' && selectedIndex===-99) || (color==='black' && selectedIndex===-98)) {
        el.style.border = "3px solid gold";
    } else {
        el.style.border = "none";
    }
    for(let i=0; i<count; i++) {
        let c = document.createElement("div"); c.className = `checker ${color}`;
        el.appendChild(c);
    }
    el.onclick = () => handleBarClick(color);
}