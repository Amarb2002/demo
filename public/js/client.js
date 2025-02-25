const socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    secure: true
});

socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Handle music controls (loaded in music.html)
function playSong(videoId) {
    socket.emit('play-song', { videoId });
}

function pauseSong() {
    socket.emit('pause-song');
}

socket.on('play-song', (data) => {
    const player = document.getElementById('youtube-player');
    if (player) {
        player.src = `https://www.youtube.com/embed/${data.videoId}?autoplay=1`;
    }
});

socket.on('pause-song', () => {
    const player = document.getElementById('youtube-player');
    if (player) player.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
});

// Handle seek events
window.addEventListener('message', (event) => {
    if (event.data && event.data.event === 'infoDelivery' && event.data.info && event.data.info.currentTime) {
        socket.emit('seek', { currentTime: event.data.info.currentTime });
    }
});

socket.on('seek', (data) => {
    const player = document.getElementById('youtube-player');
    if (player) {
        player.contentWindow.postMessage(`{"event":"command","func":"seekTo","args":[${data.currentTime}, true]}`, '*');
    }
});

// Handle time update events
setInterval(() => {
    const player = document.getElementById('youtube-player');
    if (player && player.contentWindow) {
        player.contentWindow.postMessage('{"event":"command","func":"getCurrentTime","args":""}', '*');
    }
}, 1000);

window.addEventListener('message', (event) => {
    if (event.data && event.data.event === 'infoDelivery' && event.data.info && event.data.info.currentTime) {
        socket.emit('time-update', { currentTime: event.data.info.currentTime });
    }
});

socket.on('time-update', (data) => {
    const player = document.getElementById('youtube-player');
    if (player) {
        player.contentWindow.postMessage(`{"event":"command","func":"seekTo","args":[${data.currentTime}, true]}`, '*');
    }
});
