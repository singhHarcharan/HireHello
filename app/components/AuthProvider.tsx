'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { NotificationsProvider } from './hirehello/notifications';

export default function AuthProvider({ children }: { children: ReactNode }) {
  return <SessionProvider><NotificationsProvider>{children}</NotificationsProvider></SessionProvider>;
} 