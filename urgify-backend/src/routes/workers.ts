import express, { Response } from 'express';
import { prisma } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/workers/online
 * Fetch all workers with their last known lat/lng for map visualization.
 * We can filter by "active within X minutes" if we update a lastSeen timestamp,
 * but for now, we'll return all workers who have coordinates.
 */
router.get('/online', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    // Only return workers who updated their location in the last 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const workers = await prisma.user.findMany({
      where: {
        role: 'WORKER',
        lastLat: { not: null },
        lastLng: { not: null },
        updatedAt: { gte: thirtyMinutesAgo },
        workerProfile: { isOnline: true }
      },
      select: {
        id: true,
        name: true,
        photoUrl: true,
        lastLat: true,
        lastLng: true,
        workerProfile: {
          select: {
            skills: true,
            isVerified: true,
            portfolio: {
              where: { isApproved: true } // Only show approved items publicly
            },
          }
        }
      },
      take: 200, // never send more than 200 markers to avoid crashing the map
    });

    res.json(workers);
  } catch (error) {
    console.error('Error fetching online workers:', error);
    res.status(500).json({ error: 'Failed to fetch online workers' });
  }
});

// Add portfolio item (Requires linking to a completed job)
router.post('/portfolio', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  const { imageUrl, description, jobId } = req.body;

  try {
    const profile = await prisma.workerProfile.findUnique({ where: { userId } });
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Verify worker actually worked on this job and it is completed
    const job = await prisma.job.findFirst({
      where: { 
        id: jobId, 
        status: 'COMPLETED',
        bids: { some: { workerId: userId, status: 'ACCEPTED' } }
      }
    });

    if (!job) {
      return res.status(403).json({ error: 'You can only upload photos for jobs you have completed on this platform.' });
    }

    const item = await prisma.portfolioItem.create({
      data: {
        workerProfileId: profile.id,
        jobId,
        imageUrl,
        description,
        isApproved: false // Starts as false, needs customer approval
      }
    });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add portfolio item' });
  }
});

// Customer approves portfolio item
router.put('/portfolio/approve/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const customerId = req.user?.userId;
  const itemId = String(req.params.id);

  try {
    const item = await prisma.portfolioItem.findUnique({
      where: { id: itemId },
      include: { job: true }
    });

    if (!item || !item.job || item.job.customerId !== customerId) {
      return res.status(403).json({ error: 'Unauthorized. Only the customer of this job can approve photos.' });
    }

    await prisma.portfolioItem.update({
      where: { id: itemId },
      data: { isApproved: true }
    });

    res.json({ message: 'Photo approved for portfolio' });
  } catch (error) {
    res.status(500).json({ error: 'Approval failed' });
  }
});

// Delete portfolio item
router.delete('/portfolio/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  const itemId = String(req.params.id);

  try {
    const item = await prisma.portfolioItem.findUnique({
      where: { id: itemId },
      include: { workerProfile: true }
    });

    if (!item || item.workerProfile.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await prisma.portfolioItem.delete({ where: { id: itemId } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Update worker location (called by background task)
router.post('/location', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  const { lat, lng } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng must be numbers' });
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLat: lat, lastLng: lng }
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('[WorkerLocation] Error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Toggle online status
router.post('/toggle-status', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  const { isOnline } = req.body;

  try {
    const profile = await prisma.workerProfile.update({
      where: { userId },
      data: { isOnline }
    });
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

export default router;
