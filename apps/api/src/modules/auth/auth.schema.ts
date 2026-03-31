import { z } from 'zod';

export const RegisterBodySchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Only alphanumeric, _ and - allowed'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(100)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
  displayName: z.string().max(100).optional(),
});

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const LogoutBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type LoginBody = z.infer<typeof LoginBodySchema>;
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
export type LogoutBody = z.infer<typeof LogoutBodySchema>;
