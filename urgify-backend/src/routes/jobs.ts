import express, { Response } from 'express';
import { prisma, notifyWorker, io } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { batchPushNotifications } from '../utils/push';

const router = express.Router();

// Helper: Haversine distance between two points in km
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const hasValidCoordinates = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng);

// Logic: Start a staggered notification loop for newly posted jobs
// Auto-stops after 10 minutes (MAX_RUNTIME) to prevent memory leaks
const MAX_STAGGER_RUNTIME_MS = 10 * 60 * 1000; // 10 minutes

const startStaggeredNotifications = (jobId: string, category: string, lat: number, lng: number) => {
  const tiers = [1, 3, 5, 7, 10]; // km
  let currentTier = 0;
  const notifiedIds = new Set<string>();
  const startTime = Date.now();

  const notifyCurrentTier = async () => {
    try {
      // Safety: Stop after 10 minutes no matter what
      if (Date.now() - startTime > MAX_STAGGER_RUNTIME_MS) {
        clearInterval(interval);
        console.log(`[StaggeredNotify] Timed out for job ${jobId} after 10 minutes.`);
        return;
      }

      // 1. Check if job is still open
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job || job.status !== 'OPEN' || currentTier >= tiers.length) {
        clearInterval(interval);
        return;
      }

      const radius = tiers[currentTier];
      
      // Calculate Bounding Box (1 degree ~ 111 km) to avoid pulling whole country from DB
      const latDelta = radius / 111;
      const lngDelta = radius / (111 * Math.cos(lat * (Math.PI / 180)));
      
      // 2. Find eligible workers (matching skills + inside bounding box)
      const workers = await prisma.user.findMany({
        where: { 
          role: 'WORKER',
          id: { notIn: Array.from(notifiedIds), not: job.customerId }, // Exclude the job poster
          workerProfile: { 
            skills: { has: category }
          },
          lastLat: { gte: lat - latDelta, lte: lat + latDelta },
          lastLng: { gte: lng - lngDelta, lte: lng + lngDelta }
        },
        select: { id: true, lastLat: true, lastLng: true },
        take: 200 // Cap to prevent memory spikes if dense area
      });

      const targets = workers.filter(w => {
        const dist = getDistance(lat, lng, w.lastLat!, w.lastLng!);
        return dist <= radius;
      });

      if (targets.length > 0) {
        const targetIds = targets.map(t => t.id);
        // Socket notify (legacy/realtime)
        targetIds.forEach(id => notifyWorker(id, job));
        // Push Notification
        await batchPushNotifications(
          targetIds, 
          `New Job: ${category}`, 
          `Someone needs help with ${category} within ${radius}km!`,
          { jobId }
        );

        targetIds.forEach(id => notifiedIds.add(id));
      }

    } catch (error) {
      console.error('[StaggeredNotify] Error:', error);
    }
    currentTier++;
  };

  // Send first wave immediately for ride-app-like responsiveness.
  notifyCurrentTier();

  const interval = setInterval(async () => {
    await notifyCurrentTier();
  }, 10000); // 10s intervals
};

// Get all jobs for the logged in user (customer or worker bids)
router.get('/my-jobs', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  const role = req.user?.role;

  try {
    if (role === 'CUSTOMER') {
      const jobs = await prisma.job.findMany({
        where: { customerId: userId },
        include: { bids: { include: { worker: { select: { id: true, name: true, photoUrl: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 50 // Million-Scale: limit payload size for long-term users
      });
      return res.json(jobs);
    } else {
      // Workers see jobs they bid on
      const bids = await prisma.bid.findMany({
        where: { workerId: userId },
        include: { job: { include: { customer: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50 // Million-Scale: limit payload size
      });
      const jobs = bids.map(bid => ({ ...bid.job, myBid: bid }));
      return res.json(jobs);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Post a new job (Customer only)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const { category, description, photoUrl, locationLat, locationLng, scheduledFor } = req.body;
  const userId = req.user?.userId;
  const role = req.user?.role;

  if (role !== 'CUSTOMER' && role !== 'WORKER') {
    return res.status(403).json({ error: 'Only registered users can post jobs' });
  }

  const parsedLat = Number(locationLat);
  const parsedLng = Number(locationLng);
  const canLocateJob = hasValidCoordinates(parsedLat, parsedLng);
  const parsedScheduledFor = scheduledFor ? new Date(scheduledFor) : null;

  try {
    const job = await prisma.job.create({
        data: {
            customerId: userId as string,
            category,
            description,
            photoUrl,
            locationLat: canLocateJob ? parsedLat : null,
            locationLng: canLocateJob ? parsedLng : null,
            status: 'OPEN',
            scheduledFor: parsedScheduledFor
        }
    });

    // Start staggered notifications tier-by-tier
    if (canLocateJob) {
      startStaggeredNotifications(job.id, category, parsedLat, parsedLng);
    } else {
      // Fallback: Notify all workers with matching skills immediately if no location
      const workers = await prisma.user.findMany({ 
        where: { role: 'WORKER', id: { not: userId as string }, workerProfile: { skills: { has: category } } } 
      });
      workers.forEach(w => notifyWorker(w.id, job));
    }

    res.status(201).json(job);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// Get nearby jobs (Worker only - filtered by skills)
router.get('/nearby', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  const role = req.user?.role;
  
  if (role !== 'WORKER') {
    return res.status(403).json({ error: 'Only workers can browse nearby jobs' });
  }

  try {
    // 1. Get worker's skills & location
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { workerProfile: true }
    });

    const workerProfile = user?.workerProfile;

    if (!workerProfile || !workerProfile.isOnline) {
      return res.json([]); // Offline workers see no jobs
    }

    if (!workerProfile.skills || workerProfile.skills.length === 0) {
      return res.json([]); // No skills, no jobs
    }

    const radius = workerProfile.serviceRadius || 50; // default 50km
    let whereClause: any = { 
      status: 'OPEN',
      category: { in: workerProfile.skills },
      customerId: { not: userId } // Exclude own jobs
    };

    whereClause.locationLat = { not: null };
    whereClause.locationLng = { not: null };

    if (user?.lastLat != null && user?.lastLng != null) {
      // Million-Scale: Bounding Box Filter
      const latDelta = radius / 111;
      const lngDelta = radius / (111 * Math.cos(user.lastLat * (Math.PI / 180)));
      whereClause.locationLat = { gte: user.lastLat - latDelta, lte: user.lastLat + latDelta };
      whereClause.locationLng = { gte: user.lastLng - lngDelta, lte: user.lastLng + lngDelta };
    }

    // 2. Fetch jobs matching skills + bounding box
    const openJobs = await prisma.job.findMany({
        where: whereClause,
        include: { customer: { select: { name: true, photoUrl: true, id: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50 // Strict cap to prevent crashing app payload
    });
    res.json(openJobs);
  } catch (error) {
    console.error('Error fetching nearby jobs:', error);
    res.status(500).json({ error: 'Failed to fetch nearby jobs' });
  }
});

// Job details
router.get('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const jobId = String(req.params.id);
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        customer: { select: { name: true, id: true } },
        bids: { 
          include: { 
            worker: { 
              select: { 
                name: true, 
                id: true, 
                photoUrl: true,
                workerProfile: {
                  select: {
                    averageRating: true,
                    totalReviews: true
                  }
                }
              } 
            } 
          } 
        }
      }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// Cancel and delete a job request
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const jobId = String(req.params.id);
  const userId = req.user?.userId;

  try {
    const job = await prisma.job.findUnique({ 
      where: { id: jobId },
      include: { transaction: true }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.customerId !== userId) return res.status(403).json({ error: 'Not authorized to delete this job' });

    if (job.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot delete a completed job' });
    }

    if (job.transaction || job.status === 'IN_PROGRESS') {
      // Soft cancel — don't delete, just mark as CANCELLED to preserve payment records
      await prisma.job.update({ where: { id: jobId }, data: { status: 'CANCELLED' } });
    } else {
      // Safe to hard delete — no financial records linked
      await prisma.bid.deleteMany({ where: { jobId } });
      await prisma.job.delete({ where: { id: jobId } });
    }

    // Emit live socket event to automatically remove the marker from all workers' maps
    io.emit('jobCancelled', jobId);

    res.json({ message: 'Job successfully cancelled' });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// Cleanup all open jobs for a user on logout
router.delete('/cleanup-logout/all', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;

  try {
    // Delete all OPEN jobs for this customer
    const openJobs = await prisma.job.findMany({
      where: { customerId: userId, status: 'OPEN' },
      select: { id: true }
    });

    for (const job of openJobs) {
      await prisma.bid.deleteMany({ where: { jobId: job.id } });
      await prisma.job.delete({ where: { id: job.id } });
      io.emit('jobCancelled', job.id);
    }

    res.json({ message: 'Active jobs cleaned up' });
  } catch (error) {
    console.error('Cleanup logout error:', error);
    res.status(500).json({ error: 'Failed to cleanup jobs' });
  }
});

// Get previous messages for a job
router.get('/:id/messages', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const jobId = String(req.params.id);
  const userId = req.user?.userId;

  try {
    // Basic auth check - in a real app, verify if userId is part of the job
    const messages = await prisma.message.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: { name: true, id: true }
        }
      }
    });

    // Format for frontend
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      senderId: msg.senderId,
      senderName: msg.sender.name,
      text: msg.text,
      imageUrl: msg.imageUrl,
      timestamp: msg.createdAt.toISOString()
    }));

    res.json(formattedMessages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export default router;
