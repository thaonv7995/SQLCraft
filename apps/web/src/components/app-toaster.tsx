'use client';

import { Toaster } from 'react-hot-toast';

const compact = {
  fontSize: '13px',
  lineHeight: 1.45,
  padding: '9px 12px',
  maxWidth: 'min(380px, calc(100vw - 1.5rem))',
  borderRadius: '10px',
  fontFamily: 'var(--font-inter), system-ui, sans-serif',
  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.35)',
  border: '1px solid',
  wordBreak: 'break-word' as const,
} as const;

export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      gutter={8}
      containerStyle={{
        bottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
      }}
      toastOptions={{
        duration: 3500,
        className: '!font-body',
        style: {
          ...compact,
          background: 'rgba(34, 34, 34, 0.96)',
          color: '#ececec',
          borderColor: 'rgba(77, 85, 102, 0.45)',
        },
        success: {
          duration: 3000,
          style: {
            ...compact,
            background: 'rgba(28, 38, 32, 0.96)',
            color: '#d8e8de',
            borderColor: 'rgba(95, 130, 105, 0.35)',
          },
          iconTheme: {
            primary: '#6d9078',
            secondary: 'rgba(18, 18, 18, 0.92)',
          },
        },
        error: {
          duration: 5200,
          style: {
            ...compact,
            maxWidth: 'min(440px, calc(100vw - 1.5rem))',
            background: 'rgba(38, 30, 30, 0.96)',
            color: '#ecd4d4',
            borderColor: 'rgba(180, 140, 140, 0.35)',
          },
          iconTheme: {
            primary: '#b89090',
            secondary: 'rgba(18, 18, 18, 0.92)',
          },
        },
      }}
    />
  );
}
