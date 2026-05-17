---
title: Urgify Backend
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# Urgify | On-Demand Service Marketplace Startup

> **Urgify is a full-stack, real-time on-demand service platform connecting customers with local skilled workers. Built with React Native, Node.js, Prisma, and Supabase, it features live map tracking, interactive bidding, secure Stripe payments, and instant chat for swift, reliable on-demand help.**

Urgify is a premium, full-stack on-demand service marketplace designed to connect customers with skilled workers (electricians, plumbers, mechanics, etc.) in real-time. Built with scalability and user experience in mind, it features Uber-style live tracking, internet-based voice calling, and secure payments.

## 🚀 Key Features

- **Live Worker Tracking**: Customers can watch workers arrive on a real-time map (React Native Maps + Socket.io).
- **In-App Voice Calling**: Integrated internet calling via **Agora SDK**, allowing communication without sharing personal phone numbers.
- **Real-time Bidding**: Workers nearby receive job notifications and place bids; customers hire the best offer.
- **Secure Payments**: Fully integrated **Stripe** payment gateway for seamless transactions.
- **In-App Chat**: Real-time messaging with image sharing support for job details.
- **Admin Portal**: Comprehensive dashboard to manage users, verify workers, and monitor jobs.
- **Background Operations**: Background location tracking for workers even when the app is closed.

## 🛠 Tech Stack

- **Mobile App**: React Native (Expo SDK 54), TypeScript, React Navigation.
- **Backend**: Node.js, Express, Prisma ORM, PostgreSQL (Supabase).
- **Real-time**: Socket.io (WebSockets).
- **Communication**: Agora SDK (Voice), Expo Notifications (Push).
- **Payments**: Stripe.
- **Admin Dashboard**: Vite + React.
- **Landing Page**: Modern Vanilla HTML/CSS/JS (SEO Optimized).

## 📂 Project Structure

- `urgify-app/`: The React Native mobile application.
- `urgify-backend/`: The Node.js API and Socket server.
- `urgify-admin/`: The web-based administration portal.
- `urgify-landing/`: The premium marketing landing page.

## 🏁 Getting Started

### 1. Backend Setup
1. `cd urgify-backend`
2. `npm install`
3. Configure `.env` with your `DATABASE_URL` (PostgreSQL) and `JWT_SECRET`.
4. `npx prisma db push`
5. `npm run dev`

### 2. Frontend Setup
1. `cd urgify-app`
2. `npm install`
3. Configure `utils/agora.ts` with your Agora App ID.
4. `npx expo run:android` (Requires Development Build)

## 💼 Business Potential

Urgify is a ready-to-launch startup ideal for regional markets or niche service industries. The modular architecture allows for easy expansion into new categories or cities. 

---
© 2026 Urgify. Built with passion for the next generation of service marketplaces.
