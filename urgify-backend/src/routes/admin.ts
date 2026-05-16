import express, { Response } from 'express';
import { prisma } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Admin-only middleware
const adminOnly = (req: AuthRequest, res: Response, next: Function) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};

// List all users
router.get('/users', authenticateToken, adminOnly as any, async (req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, email: true, role: true, createdAt: true }
  });
  res.json(users);
});

// Suspend / activate user
router.put('/users/:id/status', authenticateToken, adminOnly as any, async (req: AuthRequest, res: Response): Promise<any> => {
  const { status } = req.body;
  const userId = String(req.params.id);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const isBlocked = status.toUpperCase() === 'SUSPENDED';
  
  await prisma.user.update({
    where: { id: userId },
    data: { isBlocked }
  });
  
  res.json({ message: `User ${status.toLowerCase()} successfully`, isBlocked });
});

// List all jobs with filters
router.get('/jobs', authenticateToken, adminOnly as any, async (req: AuthRequest, res: Response) => {
  const { status } = req.query;
  const where = status ? { status: status as any } : {};
  const jobs = await prisma.job.findMany({
    where,
    include: { customer: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(jobs);
});

// Get platform stats
router.get('/stats', authenticateToken, adminOnly as any, async (req: AuthRequest, res: Response) => {
  const [totalUsers, totalJobs, totalWorkers, completedJobs, acceptedBids] = await Promise.all([
    prisma.user.count(),
    prisma.job.count(),
    prisma.user.count({ where: { role: 'WORKER' } }),
    prisma.job.count({ where: { status: 'COMPLETED' } }),
    prisma.bid.findMany({ where: { status: 'ACCEPTED' }, select: { price: true } })
  ]);

  const totalEarnings = acceptedBids.reduce((sum, bid) => sum + bid.price, 0);

  res.json({ totalUsers, totalJobs, totalWorkers, completedJobs, totalEarnings });
});

// List workers pending verification
router.get('/workers/pending', authenticateToken, adminOnly as any, async (req: AuthRequest, res: Response) => {
  const workers = await prisma.user.findMany({
    where: { 
      role: 'WORKER',
      workerProfile: { isVerified: false }
    },
    include: { workerProfile: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json(workers);
});

// Verify a worker
router.put('/workers/:id/verify', authenticateToken, adminOnly as any, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = String(req.params.id);
  try {
    await prisma.workerProfile.update({
      where: { userId },
      data: { isVerified: true }
    });
    res.json({ message: 'Worker verified successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify worker' });
  }
});

// List all disputes
router.get('/disputes', authenticateToken, adminOnly as any, async (req: AuthRequest, res: Response) => {
  try {
    const disputes = await prisma.dispute.findMany({
      include: { 
        job: { select: { category: true, description: true, status: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(disputes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch disputes' });
  }
});

// Update worker membership
router.put('/workers/:id/membership', authenticateToken, adminOnly as any, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = String(req.params.id);
  const { expiryDate } = req.body; // ISO string

  try {
    await prisma.workerProfile.update({
      where: { userId },
      data: { accountExpiry: new Date(expiryDate) }
    });
    res.json({ message: 'Membership updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update membership' });
  }
});

export default router;
