import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  displayName: z.string().max(100).optional(),
  bio: z.string().max(1000).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
});

export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>;
export type PaginationQuery = z.infer<typeof PaginationSchema>;
export type ChangePasswordBody = z.infer<typeof ChangePasswordSchema>;
