const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// CORS 설정
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// 게임 상태 관리
let gameState = {
    isStarted: false,
    host: null,
    numbers: {},
    diedUsers: {}
};

// 현재 접속한 유저들을 저장할 객체
const connectedUsers = {};

app.use(express.json());
app.use(express.static('public', { dotfiles: 'allow' }));

io.on('connection', (socket) => {
    console.log('새로운 유저 접속:', socket.id);

    // 유저 입장
    socket.on('join', (nickname) => {
        // 첫 번째 입장한 유저를 방장으로 설정
        const isFirstUser = Object.keys(connectedUsers).length === 0;
        
        connectedUsers[socket.id] = {
            nickname: nickname,
            id: socket.id,
            isHost: isFirstUser
        };

        if (isFirstUser) {
            gameState.host = socket.id;
        }

        // 현재 게임 상태와 함께 유저 정보 전송
        io.emit('userList', {
            users: Object.values(connectedUsers),
            gameState: {
                isStarted: gameState.isStarted,
                host: gameState.host,
                numbers: Object.entries(gameState.numbers).reduce((acc, [id, num]) => {
                    if (id !== socket.id) {
                        acc[id] = num;
                    }
                    return acc;
                }, {}),
                diedUsers: gameState.diedUsers
            }
        });
        
        io.emit('userJoined', {
            nickname: nickname,
            id: socket.id,
            isHost: isFirstUser
        });
    });

    // 게임 시작
    socket.on('startGame', () => {
        if (socket.id === gameState.host) {
            gameState.isStarted = true;
            gameState.numbers = {};
            gameState.diedUsers = {};
            
            // 각 유저에게 1~10 사이의 랜덤 번호 할당 (중복 허용)
            const users = Object.keys(connectedUsers);
            
            users.forEach(userId => {
                gameState.numbers[userId] = Math.floor(Math.random() * 10) + 1;
            });

            // 각 유저에게 다른 사람들의 번호만 전송
            users.forEach(userId => {
                const othersNumbers = {};
                users.forEach(otherId => {
                    if (otherId !== userId) {
                        othersNumbers[otherId] = gameState.numbers[otherId];
                    }
                });
                
                io.to(userId).emit('gameStarted', {
                    numbers: othersNumbers
                });
            });
        }
    });

    // 다이
    socket.on('die', () => {
        if (gameState.isStarted && !gameState.diedUsers[socket.id]) {
            gameState.diedUsers[socket.id] = true;
            // 모든 숫자를 유지한 채 다이 상태만 업데이트
            io.emit('updateDieStatus', {
                numbers: gameState.numbers,
                diedUsers: gameState.diedUsers
            });
        }
    });

    // 게임 종료
    socket.on('endGame', () => {
        if (socket.id === gameState.host) {
            gameState.isStarted = false;
            // 게임 종료 시 모든 숫자와 다이 상태를 클라이언트에 전송
            io.emit('gameEnded', {
                numbers: gameState.numbers,
                diedUsers: gameState.diedUsers
            });
            // 그 후 상태 초기화
            gameState.numbers = {};
            gameState.diedUsers = {};
        }
    });

    // 연결 종료 처리
    socket.on('disconnect', () => {
        const user = connectedUsers[socket.id];
        if (user) {
            delete connectedUsers[socket.id];
            delete gameState.numbers[socket.id];
            delete gameState.diedUsers[socket.id];
            
            // 방장이 나갔을 경우 새로운 방장 선정
            if (socket.id === gameState.host) {
                const remainingUsers = Object.keys(connectedUsers);
                if (remainingUsers.length > 0) {
                    const newHost = remainingUsers[0];
                    gameState.host = newHost;
                    connectedUsers[newHost].isHost = true;
                    io.emit('newHost', newHost);
                } else {
                    gameState = {
                        isStarted: false,
                        host: null,
                        numbers: {},
                        diedUsers: {}
                    };
                }
            }

            io.emit('userLeft', user);
            io.emit('userList', {
                users: Object.values(connectedUsers),
                gameState: {
                    isStarted: gameState.isStarted,
                    host: gameState.host,
                    numbers: gameState.numbers,
                    diedUsers: gameState.diedUsers
                }
            });
        }
        console.log('유저 접속 종료:', socket.id);
    });
});

http.listen(3000, '0.0.0.0', () => {
    console.log('서버가 3000 포트에서 실행 중입니다.');
    const networkInterfaces = require('os').networkInterfaces();
    const addresses = [];
    for (const k in networkInterfaces) {
        for (const k2 of networkInterfaces[k]) {
            if (k2.family === 'IPv4' && !k2.internal) {
                addresses.push(k2.address);
            }
        }
    }
    console.log('접속 가능한 주소:', addresses.map(addr => `http://${addr}:3000`).join('\n'));
});