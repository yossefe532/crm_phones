import express from 'express';
const app = express();
app.get('/', (req, res) => res.send('ok'));
app.listen(5000, () => console.log('Test server running on 5000'));
console.log('Starting test server...');
setInterval(() => console.log('Keep alive'), 10000);
