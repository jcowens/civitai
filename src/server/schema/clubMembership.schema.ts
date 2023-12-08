import { z } from 'zod';
import { getSanitizedStringSchema } from '~/server/schema/utils.schema';
import { comfylessImageSchema } from '~/server/schema/image.schema';
import {
  BountyMode,
  BountyType,
  ClubMembershipRole,
  Currency,
  MetricTimeframe,
} from '@prisma/client';
import { infiniteQuerySchema } from '~/server/schema/base.schema';
import { BountySort, BountyStatus, ClubMembershipSort } from '~/server/common/enums';
import { constants } from '~/server/common/constants';

export const getInfiniteClubMembershipsSchema = infiniteQuerySchema.merge(
  z.object({
    userId: z.number().optional(),
    clubId: z.number(),
    limit: z.coerce.number().min(1).max(200).default(60),
    roles: z.array(z.nativeEnum(ClubMembershipRole)).optional(),
    clubTierId: z.number().optional(),
    sort: z.nativeEnum(ClubMembershipSort).default(ClubMembershipSort.NextBillingDate),
  })
);

export type GetInfiniteClubMembershipsSchema = z.infer<typeof getInfiniteClubMembershipsSchema>;

export const createClubMembershipInput = z.object({
  userId: z.number().optional(),
  clubTierId: z.number(),
});

export type CreateClubMembershipInput = z.infer<typeof createClubMembershipInput>;

export const updateClubMembershipInput = z.object({
  clubTierId: z.number(),
  userId: z.number().optional(),
  role: z.nativeEnum(ClubMembershipRole).optional(),
});

export type UpdateClubMembershipInput = z.infer<typeof updateClubMembershipInput>;

export const clubMembershipOnClubInput = z.object({
  clubId: z.number(),
});

export type ClubMembershipOnClubInput = z.infer<typeof clubMembershipOnClubInput>;

export const ownerRemoveClubMembershipInput = z.object({
  userId: z.number(),
  clubId: z.number(),
});

export type OwnerRemoveClubMembershipInput = z.infer<typeof ownerRemoveClubMembershipInput>;

export const cancelClubMembershipInput = z.object({
  userId: z.number().optional(),
  clubId: z.number(),
});

export type CancelClubMembershipInput = z.infer<typeof cancelClubMembershipInput>;
