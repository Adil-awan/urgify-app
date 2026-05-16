import express, { Response } from 'express';
import { prisma } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Customer leaves a review for a worker after completed job
router.post('/jobs/:jobId/review', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const { rating, comment } = req.body;
  const reviewerId = req.user?.userId as string;
  const jobId = String(req.params.jobId);

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { bids: { where: { status: 'ACCEPTED' } } }
    });

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'COMPLETED') return res.status(400).json({ error: 'Can only review completed jobs' });
    if (job.customerId !== reviewerId) return res.status(403).json({ error: 'Only the customer can review' });

    const acceptedBid = job.bids[0];
    if (!acceptedBid) return res.status(400).json({ error: 'No accepted bid found for this job' });

    const existing = await prisma.review.findUnique({ where: { jobId } });
    if (existing) return res.status(400).json({ error: 'Job already reviewed' });

    const review = await prisma.review.create({
      data: {
        jobId,
        reviewerId,
        revieweeId: acceptedBid.workerId,
        rating: Math.min(5, Math.max(1, rating)),
        comment
      }
    });

    // Cache the ratings in WorkerProfile
    const allReviews = await prisma.review.findMany({
      where: { revieweeId: acceptedBid.workerId },
      select: { rating: true }
    });

    const total = allReviews.length;
    const avg = allReviews.reduce((acc, curr) => acc + curr.rating, 0) / total;

    await prisma.workerProfile.update({
      where: { userId: acceptedBid.workerId },
      data: {
        averageRating: avg,
        totalReviews: total
      }
    });

    res.status(201).json(review);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// Get a user's reviews
router.get('/users/:userId', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = String(req.params.userId);
  try {
    const reviews = await prisma.review.findMany({
      where: { revieweeId: userId },
      include: { reviewer: { select: { name: true, photoUrl: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    res.json({ reviews, averageRating: avgRating.toFixed(1), totalReviews: reviews.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

export default router;
