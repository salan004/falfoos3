const { io } = require('socket.io-client');

const socket = io('http://localhost:4000', {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('Connected:', socket.id);
  console.log('Sending youtube:connect...');
  socket.emit('youtube:connect', { videoId: '2atJFdi1rWo' });
});

socket.on('youtube:status', (data) => {
  console.log('Status:', JSON.stringify(data, null, 2));
  if (data.connected) {
    setTimeout(() => {
      console.log('Sending disconnect...');
      socket.emit('youtube:disconnect');
    }, 5000);
  } else {
    console.log('Disconnected, waiting 5s to see if reconnects...');
    setTimeout(() => {
      console.log('Test complete, exiting');
      process.exit(0);
    }, 5000);
  }
});

socket.on('game:event', (data) => {
  console.log('Event:', data.type, data.payload);
});

socket.on('disconnect', (reason) => {
  console.log('Socket disconnected:', reason);
});

socket.on('connect_error', (err) => {
  console.log('Connection error:', err.message);
});