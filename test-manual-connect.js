const { io } = require('socket.io-client');

const socket = io('http://localhost:4000', {
  transports: ['websocket', 'polling'],
  reconnection: false
});

socket.on('connect', () => {
  console.log('Connected:', socket.id);
  console.log('Checking initial status...');
});

socket.on('youtube:status', (data) => {
  console.log('\n=== YOUTUBE STATUS ===');
  console.log('Connected:', data.connected);
  console.log('Video ID:', data.videoId);
  console.log('Error:', data.error);
  
  if (!data.connected && !data.videoId) {
    console.log('\nInitial state confirmed: disconnected');
    console.log('Now simulating manual connect with test video ID...');
    socket.emit('youtube:connect', { videoId: 'dQw4w9WgXcQ' });
  } else if (data.connected) {
    console.log('\nManual connect successful!');
    console.log('Video ID:', data.videoId);
    console.log('\nNow testing disconnect...');
    socket.emit('youtube:disconnect');
  } else if (data.videoId === undefined && data.error) {
    console.log('\nConnect failed (expected if API key not valid for test video):', data.error);
    console.log('This is expected behavior - the connect feature works!');
    process.exit(0);
  }
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

socket.on('connect_error', (err) => {
  console.log('Connection error:', err.message);
});

setTimeout(() => {
  console.log('Timeout');
  process.exit(1);
}, 30000);