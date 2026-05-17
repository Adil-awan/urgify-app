import 'dotenv/config';
import { Server } from 'socket.io';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import authRoutes from './routes/auth';
import jobRoutes from './routes/jobs';
import bidRoutes from './routes/bids';
import reviewRoutes from './routes/reviews';
import paymentRoutes from './routes/payments';
import adminRoutes from './routes/admin';
import workerRoutes from './routes/workers';
import uploadRoutes from './routes/upload';
import addressRoutes from './routes/addresses';
import disputeRoutes from './routes/disputes';
import categoryRoutes from './routes/categories';
import path from 'path';
import { sendPushNotification } from './utils/push';
import dns from 'dns';

// Throttle map: userId -> last DB write timestamp
const locationWriteTimestamps = new Map<string, number>();
const LOCATION_THROTTLE_MS = 10000; // Only write to DB every 10 seconds per user

const app = express();
const httpServer = createServer(app);

export const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const databaseUrl = process.env.DATABASE_URL_IPV4 || process.env.DATABASE_URL;
let normalizedDatabaseUrl = databaseUrl;
const shouldUseRelaxedSsl =
  !!databaseUrl &&
  (databaseUrl.includes('supabase.com') || databaseUrl.includes('sslmode=require'));

if (databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    // If using Supabase Pooler (port 6543), we MUST use pgbouncer=true
    if (parsed.port === '6543' && !parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true');
    }
    // Ensure sslmode is set to require for Supabase
    if (!parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'require');
    }
    normalizedDatabaseUrl = parsed.toString();
  } catch {
    normalizedDatabaseUrl = databaseUrl;
  }
}

const pool = new Pool({
  connectionString: normalizedDatabaseUrl,
  ssl: shouldUseRelaxedSsl ? { rejectUnauthorized: false } : undefined,
});
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

async function seedCategories() {
  const categories = [
    { name: 'Electrician', icon: '🔌' },
    { name: 'Plumber', icon: '🚿' },
    { name: 'Mason', icon: '🏗️' },
    { name: 'Mechanic', icon: '🔧' },
    { name: 'Welder', icon: '🔨' },
    { name: 'Carpenter', icon: '🪚' },
    { name: 'Painter', icon: '🖌️' },
  ];
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }
}
seedCategories().catch(e => console.error('Seed error:', e));

const PORT = process.env.PORT || 5000;

const warnIfIpv6OnlyDatabaseHost = async () => {
  try {
    if (!databaseUrl) return;
    const hostname = new URL(databaseUrl).hostname;
    const ipv4Records = await dns.promises.resolve4(hostname).catch(() => []);
    const ipv6Records = await dns.promises.resolve6(hostname).catch(() => []);
    if (ipv4Records.length === 0 && ipv6Records.length > 0) {
      console.warn(
        `[DB Warning] ${hostname} resolves to IPv6 only. If you are on an IPv4-only network, use Supabase pooler URL via DATABASE_URL_IPV4.`
      );
    }
  } catch (error) {
    console.warn('[DB Warning] Could not validate database DNS records:', error);
  }
};

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

// Explicitly handle OPTIONS preflight for all routes (Express v5 syntax)
app.options('/{*}', cors());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
// Stripe webhook needs raw body — mount BEFORE express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/categories', categoryRoutes);

// Static files for uploaded images
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'OK', message: 'Urgify Backend & Database are running!' });
  } catch (error) {
    console.error('Health check DB error:', error);
    res.status(500).json({ status: 'ERROR', message: 'Backend running, but Database is unreachable' });
  }
});

// ---------- Socket.io Real-time Events ----------
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // Join a room based on userId so we can send targeted events
  socket.on('join', (userId: string) => {
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });

  // Join a job-specific room for chat + location sharing
  socket.on('joinJob', (jobId: string) => {
    socket.join(`job:${jobId}`);
    console.log(`Socket ${socket.id} joined job room: job:${jobId}`);
  });

  // Live location sharing (both parties share location during active job)
  socket.on('locationUpdate', async ({ jobId, userId, lat, lng }: { jobId: string; userId: string; lat: number; lng: number }) => {
    // Broadcast to the job room for active tracking (always instant)
    if (jobId) socket.to(`job:${jobId}`).emit('locationUpdate', { userId, lat, lng });
    
    // Throttle DB writes — only persist every 10 seconds per user
    const now = Date.now();
    const lastWrite = locationWriteTimestamps.get(userId) || 0;
    if (now - lastWrite >= LOCATION_THROTTLE_MS) {
      locationWriteTimestamps.set(userId, now);
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { lastLat: lat, lastLng: lng }
        });
      } catch (e) {
        console.error('Error updating worker location in DB:', e);
      }
    }

    // Broadcast location to the user's own room (nearby customers only)
    socket.broadcast.emit('workerLocationUpdate', { userId, lat, lng });
  });

  // In-app chat messages
  socket.on('sendMessage', async ({ jobId, senderId, senderName, text, imageUrl }: {
    jobId: string; senderId: string; senderName: string; text?: string; imageUrl?: string
  }) => {
    try {
      // 1. Save to database
      const savedMessage = await prisma.message.create({
        data: {
          jobId,
          senderId,
          text,
          imageUrl,
        }
      });

      const message = { 
        id: savedMessage.id,
        senderId, 
        senderName, 
        text,
        imageUrl,
        timestamp: savedMessage.createdAt.toISOString() 
      };
      
      // 2. Emit to the room
      io.to(`job:${jobId}`).emit('newMessage', message);

      // 3. Push notification to the other party
      const job = await prisma.job.findUnique({ 
        where: { id: jobId },
        select: { customerId: true, bids: { where: { status: 'ACCEPTED' }, select: { workerId: true } } }
      });
      if (job) {
        const recipientId = senderId === job.customerId ? job.bids[0]?.workerId : job.customerId;
        if (recipientId) {
          const body = imageUrl ? '📷 Photo' : text;
          await sendPushNotification(recipientId, `Message from ${senderName}`, body || 'New message', { jobId, type: 'CHAT' });
        }
      }
    } catch (e) {
      console.error('[SocketSendMessage] Error:', e);
    }
  });

  // Typing indicator
  socket.on('typing', ({ jobId, senderName }: { jobId: string; senderName: string }) => {
    socket.to(`job:${jobId}`).emit('typing', { senderName });
  });

  // Call notification trigger
  socket.on('startCall', async ({ toId, fromId, fromName }: { toId: string; fromId: string; fromName: string }) => {
    try {
      // 1. Notify via Socket (Instant UI)
      io.to(toId).emit('incomingCall', { fromId, fromName });

      // 2. Notify via Push (Background)
      await sendPushNotification(toId, `Incoming Call`, `${fromName} is calling you via Urgify!`, { fromId, type: 'CALL' });
    } catch (e) {
      console.error('[CallSignal] Error:', e);
    }
  });

  socket.on('acceptCall', ({ fromId, toId }: { fromId: string; toId: string }) => {
    io.to(fromId).emit('callAccepted');
  });

  socket.on('rejectCall', ({ fromId, toId }: { fromId: string; toId: string }) => {
    io.to(fromId).emit('callRejected');
  });

  socket.on('endCall', ({ fromId, toId }: { fromId: string; toId: string }) => {
    io.to(fromId).emit('callEnded');
    io.to(toId).emit('callEnded');
  });

  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.id}`);
  });
});

// Utility: notify a specific worker of new job
export const notifyWorker = (workerId: string, job: object) => {
  io.to(workerId).emit('newJob', job);
};

// ---------- Background Cleanup Service (5-Minute Rule) ----------
setInterval(async () => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    // 1. Find jobs that are either OPEN and too old, or COMPLETED (as per user request to delete all for now)
    const jobsToCleanup = await prisma.job.findMany({
      where: {
        OR: [
          { status: 'OPEN', createdAt: { lt: fiveMinutesAgo } },
          { status: 'COMPLETED' } // Delete completed ones too for testing phase
        ]
      },
      select: { id: true, customerId: true, status: true }
    });

    if (jobsToCleanup.length > 0) {
      console.log(`[Cleanup] Found ${jobsToCleanup.length} jobs to remove.`);
      for (const job of jobsToCleanup) {
        // Delete associated bids first (due to DB constraints)
        await prisma.bid.deleteMany({ where: { jobId: job.id } });
        // Delete the job
        await prisma.job.delete({ where: { id: job.id } });

        // Notify Workers to remove markers
        io.emit('jobCancelled', job.id);

        // If it was an OPEN job that expired, notify the Customer to repost
        if (job.status === 'OPEN') {
          // 1. Real-time Socket Notification
          io.to(job.customerId).emit('jobExpired', { 
            message: "No worker there ,Again post the job" 
          });

          // 2. Push Notification
          sendPushNotification(
            job.customerId,
            'Job Expired',
            'No worker there, Again post the job'
          ).catch(e => console.error('[Cleanup Push Error]:', e));
        }
      }
    }
  } catch (error) {
    console.error('[Cleanup Error]:', error);
  }
}, 30000); // Run every 30 seconds

httpServer.listen(PORT as number, '0.0.0.0', () => {
  console.log(`🚀 Urgify server running on http://0.0.0.0:${PORT}`);
  console.log(`🔌 Socket.io ready for real-time connections`);
  warnIfIpv6OnlyDatabaseHost();
});
