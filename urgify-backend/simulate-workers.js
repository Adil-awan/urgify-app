const { io } = require('socket.io-client');
const axios = require('axios');

const API_URL = 'http://localhost:5000/api'; // Change to your IP if testing on phone
const SOCKET_URL = 'http://localhost:5000';
const NUM_WORKERS = 10;

// Central point for simulation (Change to your actual location)
const CENTER_LAT = 31.5204; 
const CENTER_LNG = 74.3587;

async function startSimulation() {
  console.log(`🚀 Starting simulation for ${NUM_WORKERS} workers...`);

  for (let i = 1; i <= NUM_WORKERS; i++) {
    try {
      const email = `bot_worker_${i}@urgify.com`;
      const password = 'password123';
      const name = `Virtual Worker ${i}`;

      // 1. Register/Login
      let token;
      try {
        const loginRes = await axios.post(`${API_URL}/auth/login`, { email, password });
        token = loginRes.data.token;
        console.log(`✅ Logged in: ${name}`);
      } catch (e) {
        // Register if doesn't exist
        const regRes = await axios.post(`${API_URL}/auth/register`, { name, email, password });
        token = regRes.data.token;
        // Upgrade to worker
        await axios.post(`${API_URL}/auth/upgrade-to-worker`, {
            skills: ['Electrician', 'Plumber', 'Mason'].slice(0, (i % 3) + 1)
        }, { headers: { Authorization: `Bearer ${token}` } });
        console.log(`🆕 Registered and Upgraded: ${name}`);
      }

      // 2. Connect Socket
      const socket = io(SOCKET_URL);
      const userId = (await axios.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).data.id;
      
      socket.emit('join', userId);

      // 3. Simulation Loop: Move and Bid
      let angle = (i / NUM_WORKERS) * 2 * Math.PI;
      setInterval(() => {
        angle += 0.01; // Move slowly in a circle
        const lat = CENTER_LAT + 0.005 * Math.sin(angle);
        const lng = CENTER_LNG + 0.005 * Math.cos(angle);

        socket.emit('locationUpdate', { userId, lat, lng });
      }, 5000);

      // 4. Auto-Bid logic
      socket.on('newJob', async (job) => {
        console.log(`🤖 ${name} detected new job: ${job.category}. Bidding...`);
        try {
            await axios.post(`${API_URL}/bids`, {
                jobId: job.id,
                price: 500 + (Math.random() * 500),
                comment: "I can do this right now!"
            }, { headers: { Authorization: `Bearer ${token}` } });
        } catch (e) {
            // Probably already bid or error
        }
      });

    } catch (err) {
      console.error(`❌ Failed to start bot ${i}:`, err.message);
    }
  }
}

startSimulation();
