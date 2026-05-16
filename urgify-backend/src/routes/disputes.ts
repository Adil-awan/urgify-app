import express, { Response } from 'express';
import { prisma } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { sendPushNotification } from '../utils/push';

const router = express.Router();

// Raise a dispute for a job
router.post('/jobs/:jobId/report', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const { reason } = req.body;
  const reporterId = req.user?.userId as string;
  const jobId = String(req.params.jobId);

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Check if reporter is either customer or assigned worker
    const isCustomer = job.customerId === reporterId;
    const acceptedBid = await prisma.bid.findFirst({
        where: { jobId, status: 'ACCEPTED' }
    });
    const isWorker = acceptedBid?.workerId === reporterId;

    if (!isCustomer && !isWorker) {
      return res.status(403).json({ error: 'Unauthorized to report this job' });
    }

    const existing = await prisma.dispute.findUnique({ where: { jobId } });
    if (existing) return res.status(400).json({ error: 'Job already reported' });

    const dispute = await prisma.dispute.create({
      data: {
        jobId,
        reporterId,
        reason
      }
    });

    // Notify Admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    for (const admin of admins) {
        await sendPushNotification(admin.id, "New Dispute Reported", `A dispute has been raised for job #${jobId.substring(0,8)}: ${reason}`);
    }

    res.status(201).json(dispute);
  } catch (error) {
    res.status(500).json({ error: 'Failed to report job' });
  }
});

export default router;
