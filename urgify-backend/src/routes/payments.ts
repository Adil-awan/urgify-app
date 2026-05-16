import express, { Response } from 'express';
import Stripe from 'stripe';
import { prisma } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2026-03-25.dahlia' });
const COMMISSION_RATE = 0.1; // 10% platform commission

// Create PaymentIntent (customer pays for a job)
router.post('/intent', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const { jobId } = req.body;
  const customerId = req.user?.userId as string;

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { bids: { where: { status: 'ACCEPTED' } } }
    });

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.customerId !== customerId) return res.status(403).json({ error: 'Unauthorized' });

    const acceptedBid = job.bids[0];
    if (!acceptedBid) return res.status(400).json({ error: 'No accepted bid found' });

    const amountInCents = Math.round(acceptedBid.price * 100);
    const commission = Math.round(amountInCents * COMMISSION_RATE);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      metadata: { jobId, workerId: acceptedBid.workerId, commission: String(commission) }
    });

    // Record pending transaction
    await prisma.transaction.upsert({
      where: { jobId },
      update: { stripePaymentIntent: paymentIntent.id, status: 'PENDING' },
      create: {
        jobId,
        amount: acceptedBid.price,
        commission: acceptedBid.price * COMMISSION_RATE,
        stripePaymentIntent: paymentIntent.id,
        status: 'PENDING'
      }
    });

    res.json({ clientSecret: paymentIntent.client_secret, amount: acceptedBid.price });
  } catch (error: any) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message || 'Payment creation failed' });
  }
});

// Stripe Webhook — called by Stripe after payment succeeds
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res): Promise<any> => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err: any) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { jobId } = intent.metadata;

    await prisma.transaction.update({
      where: { jobId },
      data: { status: 'COMPLETED' }
    });

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'COMPLETED' }
    });
  }

  res.json({ received: true });
});

// Get payment/transaction history
router.get('/history', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId as string;
  const role = req.user?.role;

  try {
    let transactions;
    if (role === 'CUSTOMER') {
      transactions = await prisma.transaction.findMany({
        where: { job: { customerId: userId } },
        include: { job: { select: { category: true, description: true } } },
        orderBy: { createdAt: 'desc' }
      });
    } else {
      transactions = await prisma.transaction.findMany({
        where: { job: { bids: { some: { workerId: userId, status: 'ACCEPTED' } } } },
        include: { job: { select: { category: true, description: true } } },
        orderBy: { createdAt: 'desc' }
      });
    }
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;
