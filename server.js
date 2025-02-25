const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const http = require('http');
const cors = require('cors');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');

const app = express();

const allowedOrigins = [process.env.VERCEL_URL, 'http://localhost:3000'];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST"]
}));

app.set('views', path.join(__dirname, 'views')); // Add this line to set the views directory
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.use('/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

let rooms = {};

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/chat/:room', (req, res) => {
    const room = req.params.room;
    if (!rooms[room]) {
        rooms[room] = { users: [], messages: [], currentSong: null, isPlaying: false };
    }
    res.render('chat', { room });
});

app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    try {
        console.log('Searching for:', query);
        const result = await yts(query);
        console.log('Found results:', result.videos.length);
        res.json(result.videos.slice(0, 5));
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Failed to fetch results', details: error.message });
    }
});

app.get('/play/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    try {
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'lowestaudio',
            highWaterMark: 1024 * 1024
        });

        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Cache-Control', 'no-cache');

        stream.on('info', () => console.log('Stream started:', videoId));
        stream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) res.status(500).end();
        });

        stream.pipe(res);
    } catch (error) {
        console.error('Audio error:', error);
        res.status(500).json({ error: 'Failed to stream audio' });
    }
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id); // Add this line

    let currentRoom;

    socket.on('join-room', (room) => {
        currentRoom = room;
        socket.join(room);
        console.log(`User ${socket.id} joined room ${room}`); // Add this line
        // Initialize room if it doesn't exist
        if (!rooms[room]) {
            rooms[room] = { users: [], messages: [], currentSong: null, isPlaying: false };
        }
        if (!rooms[room].users.includes(socket.id)) {
            rooms[room].users.push(socket.id);
        }
        io.to(room).emit('update-users', rooms[room].users.length);
        socket.emit('load-messages', rooms[room].messages);
    });

    socket.on('chat-message', (data) => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].messages.push(data);
            io.to(currentRoom).emit('chat-message', data);
        }
    });

    socket.on('play-song', (data) => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].currentSong = data.videoId;
            rooms[currentRoom].isPlaying = true;
            io.to(currentRoom).emit('play-song', data);
        }
    });

    socket.on('pause-song', () => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].isPlaying = false;
            io.to(currentRoom).emit('pause-song');
        }
    });

    socket.on('resume-song', () => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].isPlaying = true;
            io.to(currentRoom).emit('resume-song');
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id); // Add this line
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].users = rooms[currentRoom].users.filter(id => id !== socket.id);
            io.to(currentRoom).emit('update-users', rooms[currentRoom].users.length);
            if (rooms[currentRoom].users.length === 0) delete rooms[currentRoom];
        }
    });
});

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

// module.exports = server;
module.exports = app;