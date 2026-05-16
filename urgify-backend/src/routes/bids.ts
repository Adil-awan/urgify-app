import express, { Response } from 'express';
import { prisma, io } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { sendPushNotification } from '../utils/push';

const router = express.Router();

// Worker places a bid on a job
router.post('/jobs/:jobId/bid', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const { price, message } = req.body;
  const workerId = req.user?.userId as string;
  const role = req.user?.role;
  const jobId = String(req.params.jobId);

  if (role !== 'WORKER') {
    return res.status(403).json({ error: 'Only workers can place bids' });
  }

  // Validate bid price
  if (!price || typeof price !== 'number' || price <= 0 || !isFinite(price)) {
    return res.status(400).json({ error: 'Price must be a positive number' });
  }

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'OPEN') return res.status(400).json({ error: 'This job is no longer accepting bids' });

    const existingBid = await prisma.bid.findFirst({
      where: { jobId, workerId }
    });
    if (existingBid) return res.status(400).json({ error: 'You have already placed a bid on this job' });

    const bid = await prisma.bid.create({
      data: { jobId, workerId, price, message },
      include: { 
        worker: { 
          select: { 
            name: true,
            photoUrl: true,
            workerProfile: {
              select: { skills: true }
            }
          } 
        } 
      }
    });

    // Notify Customer Realtime
    io.to(job.customerId).emit('newBid', bid);

    // Notify Customer via Push Notification
    await sendPushNotification(
      job.customerId, 
      'New Bid Received!', 
      `${bid.worker.name} offered ${price} PKR for your ${job.category} job.`
    );

    res.status(201).json(bid);
  } catch (error) {
    res.status(500).json({ error: 'Failed to place bid' });
  }
});

// Customer accepts a bid
router.put('/jobs/:jobId/accept/:bidId', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const customerId = req.user?.userId as string;
  const role = req.user?.role;
  const jobId = String(req.params.jobId);
  const bidId = String(req.params.bidId);

  if (role !== 'CUSTOMER') return res.status(403).json({ error: 'Only customers can accept bids' });

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== customerId) return res.status(403).json({ error: 'Unauthorized' });

    const bid = await prisma.bid.update({ 
      where: { id: bidId }, 
      data: { status: 'ACCEPTED' },
      include: { 
        worker: { select: { id: true } },
        job: {
          include: {
            customer: {
              select: { id: true, name: true, photoUrl: true, phone: true }
            }
          }
        }
      }
    });
    await prisma.bid.updateMany({
      where: { jobId, id: { not: bidId } },
      data: { status: 'REJECTED' }
    });
    await prisma.job.update({ where: { id: jobId }, data: { status: 'IN_PROGRESS' } });

    // Notify Worker via Push
    await sendPushNotification(
      bid.workerId,
      'Bid Accepted!',
      `Your bid for the ${job.category} job has been accepted. View details to start!`
    );

    // Notify Worker via Socket for UI popup
    io.to(bid.workerId).emit('bidAccepted', {
      jobId,
      category: job.category,
      customer: bid.job.customer
    });

    // Live update: Notify other workers to remove this job from their maps
    io.emit('jobCancelled', jobId);

    res.json({ message: 'Bid accepted successfully! Job is now in progress.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept bid' });
  }
});

// Mark job as complete
router.put('/jobs/:jobId/complete', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId as string;
  const jobId = String(req.params.jobId);
  try {
    const job = await prisma.job.findUnique({ 
      where: { id: jobId },
      include: { bids: { where: { status: 'ACCEPTED' } } }
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.customerId !== userId) return res.status(403).json({ error: 'Unauthorized' });

    const acceptedBid = job.bids[0];
    // No commission or wallet tracking as per new business model
    // Workers are charged for the account itself separately

    await prisma.job.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });
    
    // Live update: Notify to remove from maps if still there
    io.emit('jobCancelled', jobId);

    res.json({ message: 'Job marked as completed! Commission calculated.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete job' });
  }
});

export default router;
