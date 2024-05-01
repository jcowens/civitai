import { ModelType } from '@prisma/client';
import { SessionUser } from 'next-auth';
import { z } from 'zod';
import { baseModelSetTypes, draftMode, getGenerationConfig } from '~/server/common/constants';
import { extModeration } from '~/server/integrations/moderation';
import { logToAxiom } from '~/server/logging/client';
import { getGenerationStatus, getResourceData } from '~/server/services/orchestrator/common';
import { throwBadRequestError } from '~/server/utils/errorHandling';
import { includesMinor, includesNsfw, includesPoi } from '~/utils/metadata/audit';
import { stringifyAIR } from '~/utils/string-helpers';
import { isDefined } from '~/utils/type-guards';

// #region [schemas]
const textToImageParamsSchema = z.object({
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  cfgScale: z.number(),
  sampler: z.string(),
  seed: z.number(),
  clipSkip: z.number(),
  steps: z.number(),
  quantity: z.number(),
  nsfw: z.boolean().optional(),
  draft: z.boolean().optional(),
  aspectRatio: z.coerce.number(),
  baseModel: z.enum(baseModelSetTypes),
});

const textToImageResourceSchema = z.object({
  id: z.number(),
  strength: z.number().default(1),
  triggerWord: z.string().optional(),
});

const textToImageSchema = z.object({
  params: textToImageParamsSchema,
  resources: textToImageResourceSchema
    .array()
    .min(1, 'You must select at least one resource')
    .max(10, 'Too many resources provided'),
});
// #endregion

// #region [constants]
// when removing a string from the `safeNegatives` array, add it to the `allSafeNegatives` array
const safeNegatives = [{ id: 106916, triggerWord: 'civit_nsfw' }];
const minorNegatives = [{ id: 250712, triggerWord: 'safe_neg' }];
const minorPositives = [{ id: 250708, triggerWord: 'safe_pos' }];
const allInjectedNegatives = [...safeNegatives, ...minorNegatives];
const allInjectedPositives = [...minorPositives];
// #endregion

export async function textToImage({
  user,
  ...input
}: z.input<typeof textToImageSchema> & { user: SessionUser }) {
  const parsedInput = textToImageSchema.parse(input);
  const { params } = parsedInput;

  const status = await getGenerationStatus();
  if (!status.available && !user.isModerator)
    throw throwBadRequestError('Generation is currently disabled');

  const limits = status.limits[user.tier ?? 'free'];
  if (params.quantity > limits.quantity) params.quantity = limits.quantity;
  if (params.steps > limits.steps) params.steps = limits.steps;
  if (parsedInput.resources.length > limits.resources)
    throw throwBadRequestError('You have exceeded the resources limit.');

  // handle draft mode
  const isSDXL =
    params.baseModel === 'SDXL' ||
    params.baseModel === 'Pony' ||
    params.baseModel === 'SDXLDistilled';

  const draftModeSettings = draftMode[isSDXL ? 'sdxl' : 'sd1'];
  if (params.draft) {
    // Fix quantity
    if (params.quantity % 4 !== 0) params.quantity = Math.ceil(params.quantity / 4) * 4;
    // Fix other params
    params.steps = draftModeSettings.steps;
    params.cfgScale = draftModeSettings.cfgScale;
    params.sampler = draftModeSettings.sampler;
    // Add speed up resources
    parsedInput.resources.push({
      strength: 1,
      id: draftModeSettings.resourceId,
    });
  }

  const resourceData = await getResourceData(parsedInput.resources.map((x) => x.id));
  const resources = resourceData
    .map((resource) => {
      const air = stringifyAIR({
        baseModel: resource.baseModel,
        type: resource.model.type,
        source: 'civitai',
        modelId: resource.model.id,
        id: resource.id,
      });
      if (!air) return null;
      return { ...resource, ...parsedInput.resources.find((x) => x.id === resource.id), air };
    })
    .filter(isDefined);

  // #region [error handling]
  // handle missing checkpoint
  const checkpoint = resources.find((x) => x.model.type === ModelType.Checkpoint);
  if (!checkpoint)
    throw throwBadRequestError('A checkpoint is required to make a generation request');

  // handle missing draft resource
  if (params.draft && !resources.map((x) => x.id).includes(draftModeSettings.resourceId))
    throw throwBadRequestError(`Draft mode is currently disabled for ${params.baseModel} models`);

  // TODO - ensure that draft mode models are included in the `GenerationCoverage` view
  // handle missing coverage
  if (
    !resources.every(
      (x) => !!x.generationCoverage?.covered || x.id === draftModeSettings.resourceId
    )
  )
    throw throwBadRequestError(
      `Some of your resources are not available for generation: ${resources
        .filter((x) => !(!!x.generationCoverage?.covered || x.id === draftModeSettings.resourceId))
        .map((x) => x.air)
        .join(', ')}`
    );

  // handle moderate prompt
  try {
    const moderationResult = await extModeration.moderatePrompt(params.prompt);
    if (moderationResult.flagged) {
      throw throwBadRequestError(
        `Your prompt was flagged for: ${moderationResult.categories.join(', ')}`
      );
    }
  } catch (error: any) {
    logToAxiom({ name: 'external-moderation-error', type: 'error', message: error.message });
  }
  // #endregion

  const config = getGenerationConfig(params.baseModel);
  const { height, width } = config.aspectRatios[params.aspectRatio];
  const availableResourceTypes = config.additionalResourceTypes.map((x) => x.type);
  const additionalNetworks = resources
    .filter((x) => availableResourceTypes.includes(x.model.type))
    .reduce<{ [key: string]: object }>((acc, resource) => {
      acc[resource.air] = {
        type: resource.model.type,
        strength: resource.strength,
        triggerWord: resource.triggerWord,
      };
      return acc;
    }, {});

  // Set nsfw to true if the prompt contains nsfw words
  const isPromptNsfw = includesNsfw(params.prompt);
  params.nsfw ??= isPromptNsfw !== false;

  // Disable nsfw if the prompt contains poi/minor words
  const hasPoi = includesPoi(params.prompt) || resources.some((x) => x.model.poi);
  if (hasPoi || includesMinor(params.prompt)) params.nsfw = false;

  const negativePrompts = [params.negativePrompt ?? ''];
  if (!params.nsfw && status.sfwEmbed) {
    for (const { id, triggerWord } of safeNegatives) {
      // TODO - air
      additionalNetworks[`@civitai/${id}`] = {
        triggerWord,
        type: ModelType.TextualInversion,
      };
      negativePrompts.unshift(triggerWord);
    }
  }

  // Inject fallback minor safety nets
  const positivePrompts = [params.prompt];
  if (isPromptNsfw && status.minorFallback) {
    for (const { id, triggerWord } of minorPositives) {
      // TODO - air
      additionalNetworks[`@civitai/${id}`] = {
        triggerWord,
        type: ModelType.TextualInversion,
      };
      positivePrompts.unshift(triggerWord);
    }
    for (const { id, triggerWord } of minorNegatives) {
      // TODO - air
      additionalNetworks[`@civitai/${id}`] = {
        triggerWord,
        type: ModelType.TextualInversion,
      };
      negativePrompts.unshift(triggerWord);
    }
  }

  // handle SDXL ClipSkip
  // I was made aware that SDXL only works with clipSkip 2
  // if that's not the case anymore, we can rollback to just setting
  // this for Pony resources -Manuel
  if (isSDXL) params.clipSkip = 2;

  console.log(additionalNetworks);
}
