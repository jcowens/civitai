import { dbRead } from '~/server/db/client';
import { HomeBlockType, Prisma } from '@prisma/client';
import {
  GetHomeBlockByIdInputSchema,
  GetHomeBlocksInputSchema,
  HomeBlockMetaSchema,
} from '~/server/schema/home-block.schema';
import { UserPreferencesInput } from '~/server/middleware.trpc';
import {
  getCollectionById,
  getCollectionItemsByCollectionId,
} from '~/server/services/collection.service';
import { getLeaderboardsWithResults } from '~/server/services/leaderboard.service';
import { getAnnouncements } from '~/server/services/announcement.service';
import { Context } from '~/server/createContext';

export const getHomeBlocks = <TSelect extends Prisma.HomeBlockSelect = Prisma.HomeBlockSelect>({
  select,
}: {
  select: TSelect;
}) => {
  return dbRead.homeBlock.findMany({
    select,
    orderBy: { index: 'asc' },
  });
};

export const getHomeBlockById = async ({
  id,
  ctx,
  ...input
}: GetHomeBlockByIdInputSchema & { ctx: Context }) => {
  const homeBlock = await dbRead.homeBlock.findUniqueOrThrow({
    select: {
      id: true,
      metadata: true,
      type: true,
    },
    where: {
      id,
    },
  });

  return getHomeBlockData({ homeBlock, ctx, input });
};

export const getHomeBlockData = async ({
  homeBlock,
  ctx,
  input,
}: {
  homeBlock: {
    id: number;
    metadata?: HomeBlockMetaSchema | Prisma.JsonValue;
    type: HomeBlockType;
  };
  ctx: Context;
  input: GetHomeBlocksInputSchema;
}) => {
  const metadata: HomeBlockMetaSchema = (homeBlock.metadata || {}) as HomeBlockMetaSchema;

  switch (homeBlock.type) {
    case HomeBlockType.Collection: {
      if (!metadata.collection || !metadata.collection.id) {
        return null;
      }

      const collection = await getCollectionById({
        input: { id: metadata.collection.id },
      });

      if (!collection) {
        return null;
      }

      const items = await getCollectionItemsByCollectionId({
        ctx,
        input: {
          ...(input as UserPreferencesInput),
          collectionId: collection.id,
          // TODO.home-blocks: Set item limit as part of the input?
          limit: metadata.collection.limit,
        },
      });

      return {
        ...homeBlock,
        type: HomeBlockType.Collection,
        metadata,
        collection: {
          ...collection,
          items,
        },
      };
    }
    case HomeBlockType.Leaderboard: {
      if (!metadata.leaderboards) {
        return null;
      }

      const leaderboardIds = metadata.leaderboards.map((leaderboard) => leaderboard.id);

      const leaderboardsWithResults = await getLeaderboardsWithResults({
        ids: leaderboardIds,
        isModerator: ctx.user?.isModerator || false,
      });

      return {
        ...homeBlock,
        metadata,
        leaderboards: leaderboardsWithResults.sort((a, b) => {
          if (!metadata.leaderboards) {
            return 0;
          }

          const aIndex = metadata.leaderboards.find((item) => item.id === a.id)?.index ?? 0;
          const bIndex = metadata.leaderboards.find((item) => item.id === b.id)?.index ?? 0;

          return aIndex - bIndex;
        }),
      };
    }
    case HomeBlockType.Announcement: {
      if (!metadata.announcements) {
        return null;
      }

      const announcementIds = metadata.announcements.ids;
      const announcements = await getAnnouncements({
        ids: announcementIds,
        dismissed: input.dismissed,
        limit: metadata.announcements.limit,
        user: ctx.user,
      });

      if (!announcements.length) {
        // If the user cleared all announcements in home block, do not display this block.
        return null;
      }

      return {
        ...homeBlock,
        metadata,
        announcements: announcements.sort((a, b) => {
          const aIndex = a.metadata.index ?? 999;
          const bIndex = b.metadata.index ?? 999;

          return aIndex - bIndex;
        }),
      };
    }
    default:
      return { ...homeBlock, metadata };
  }
};