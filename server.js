const express = require('express');
const { Server } = require('socket.io');
const path = require('path');
const http = require('http');
const cors = require('cors');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const redis = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const app = express();

const allowedOrigins = [
    'https://demo-tau-woad.vercel.app',

    'https://demo-tau-woad.vercel.app/',
    process.env.VERCEL_URL
];

app.use(cors({
    origin: 'https://demo-tau-woad.vercel.app',
    methods: ['GET', 'POST'],
    credentials: true
}));

app.set('views', path.join(__dirname, 'views')); // Add this line to set the views directory
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.use('/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? [process.env.VERCEL_URL, 'https://demo-tau-woad.vercel.app'] : '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
    pingInterval: 25000
});

if (process.env.NODE_ENV === 'production') {
  const pubClient = redis.createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      console.log('Redis adapter connected');
    })
    .catch((err) => {
      console.error('Redis connection error:', err);
    });
}

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
        const info = await ytdl.getInfo(url);
        const format = ytdl.chooseFormat(info.formats, {
            quality: 'highestaudio',
            filter: format => format.hasAudio && !format.hasVideo
        });

        if (!format) {
            throw new Error('No suitable audio format found');
        }

        // Set proper headers before starting stream
        res.header('Content-Type', 'audio/mpeg');
        res.header('Transfer-Encoding', 'chunked');
        res.header('Accept-Ranges', 'bytes');
        res.header('Cache-Control', 'no-cache');

        const stream = ytdl(url, {
            format: format,
            filter: 'audioonly',
            highWaterMark: 1024 * 1024, // 1MB buffer
            liveBuffer: 20000, // 20s live buffer
            dlChunkSize: 262144, // 256KB chunks
            quality: 'highestaudio'
        });

        let startTime = Date.now();
        let dataReceived = false;

        stream.on('info', (info, format) => {
            console.log('Stream info received:', format.container);
        });

        stream.on('data', (chunk) => {
            if (!dataReceived) {
                dataReceived = true;
                console.log(`First chunk received after ${Date.now() - startTime}ms`);
            }
        });

        stream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Streaming failed', details: error.message });
            }
        });

        // Pipe with error handling
        stream.pipe(res).on('error', (error) => {
            console.error('Pipe error:', error);
            if (!res.headersSent) {
                res.status(500).end();
            }
        });

        // Handle client disconnect
        req.on('close', () => {
            stream.destroy();
        });

    } catch (error) {
        console.error('Audio setup error:', error);
        res.status(500).json({ error: 'Failed to setup audio stream', details: error.message });
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



module.exports = server;
