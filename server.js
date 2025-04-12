const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = 2345;

const INITIAL_LIVES = 3;
const RESPAWN_TIME = 5000;

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

const gameState = {
    players: {},
    bullets: [],
    lastBulletId: 0
};

wss.on('connection', (ws) => {
    const playerId = Date.now().toString();
    const militaryPrefixes = ['Танк', 'Штурм', 'Снайпер', 'Командир', 'Капитан', 'Генерал', 'Сержант', 'Рейнджер', 'Десант', 'Развед'];
    const militarySuffixes = ['Огонь', 'Удар', 'Гром', 'Молот', 'Клинок', 'Щит', 'Ярость', 'Гроза', 'Сталь', 'Град'];
    const nickname = `${militaryPrefixes[Math.floor(Math.random() * militaryPrefixes.length)]}${militarySuffixes[Math.floor(Math.random() * militarySuffixes.length)]}${Math.floor(10 + Math.random() * 90)}`;
    
    gameState.players[playerId] = {
        id: playerId,
        nickname,
        x: Math.random() * 700 + 50,
        y: Math.random() * 500 + 50,
        angle: 0,
        lives: INITIAL_LIVES,
        isAlive: true,
        respawning: false,
        respawnTimer: null
    };

    // Отправляем текущее состояние новому игроку
    ws.send(JSON.stringify({
        type: 'init',
        playerId,
        gameState
    }));

    // Уведомляем других игроков
    broadcast({
        type: 'playerJoined',
        player: gameState.players[playerId]
    }, ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'update':
                    if (gameState.players[playerId]) {
                        gameState.players[playerId] = {
                            ...gameState.players[playerId],
                            ...data.updates
                        };
                        broadcast({
                            type: 'playerUpdated',
                            playerId,
                            updates: data.updates
                        }, ws);
                    }
                    break;
                case 'shoot':
                    const bulletId = ++gameState.lastBulletId;
                    const bullet = {
                        id: bulletId,
                        playerId,
                        x: data.x,
                        y: data.y,
                        angle: data.angle,
                        speed: 10,
                        conflict: false,
                        createdAt: Date.now(), // Добавляем время создания
                        ttl: 3000 // Время жизни пули (3 секунды)
                    };
                    gameState.bullets.push(bullet);
                    
                    broadcast({
                        type: 'bulletFired',
                        bullet
                    });
                    break;

                case 'chat':
                    broadcast({
                        type: 'chatMessage',
                        playerId,
                        nickname: gameState.players[playerId].nickname,
                        message: data.message.slice(0, 200) // Ограничение длины
                    });
                    break;
                case 'respawnRequest':
                    if (gameState.players[playerId] && !gameState.players[playerId].isAlive) {
                        clearTimeout(gameState.players[playerId].respawnTimer);
                        respawnPlayer(playerId); // Используем ту же функцию, что и для автоматического респавна
                    }
                    break;
            }
        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        delete gameState.players[playerId];
        broadcast({
            type: 'playerLeft',
            playerId
        });
    });
});

function broadcast(data, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// В игровом цикле (setInterval) измените обработку пуль:
setInterval(() => {
    const now = Date.now();
    
    // Update bullets
    gameState.bullets = gameState.bullets.filter(bullet => {
        bullet.x += Math.cos(bullet.angle) * bullet.speed;
        bullet.y += Math.sin(bullet.angle) * bullet.speed;
        
        // Проверка TTL (если bullet.createdAt существует)
        if (bullet.conflict) {
            console.log(123);
        }
        if ((bullet.createdAt && Date.now() - bullet.createdAt > bullet.ttl) || bullet.conflict) {
            return false; // Удалить пулю
        }
        
        // Проверка столкновений с игроками
        for (const playerId in gameState.players) {
            const player = gameState.players[playerId];
            
            // Не проверяем столкновение с собой и мертвыми игроками
            if (bullet.playerId === playerId || !player.isAlive) continue;
            
            const dx = player.x - bullet.x;
            const dy = player.y - bullet.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 40) { // Радиус столкновения
                player.lives--;
                bullet.conflict = true;
                if (player.lives <= 0) {
                    player.isAlive = false;
                    player.respawning = true; // Добавляем флаг возрождения
                    player.respawnTimer = setTimeout(() => {
                        respawnPlayer(playerId);
                    }, RESPAWN_TIME);
                }
                
                broadcast({
                    type: 'playerHit',
                    playerId,
                    lives: player.lives,
                    isAlive: player.isAlive,
                    respawning: player.respawning
                });
                
                return false; // Удалить пулю при столкновении
            }
        }
        
        // Проверка границ экрана
        return bullet.x > -50 && bullet.x < 850 && bullet.y > -50 && bullet.y < 650;
    });
}, 1000 / 60);

// Функция респауна игрока
function respawnPlayer(playerId) {
    const player = gameState.players[playerId];
    if (!player) return;
    
    player.x = Math.random() * 700 + 50;
    player.y = Math.random() * 500 + 50;
    player.lives = INITIAL_LIVES;
    player.isAlive = true;
    player.respawning = false; // Сбрасываем флаг
    player.respawnTimer = null;
    
    broadcast({
        type: 'playerRespawn',
        playerId
    });
}