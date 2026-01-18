import {
  getCategory,
  getCategoryParameters,
  getParameterLevel,
} from './supabase.server';

/**
 * Generate a transformation prompt from funnel responses
 * 
 * This is SIMPLE STRING CONCATENATION - no LLM involved!
 * 
 * Final prompt structure:
 *   1. Category base_prompt
 *   2. + Selected level prompt_text for each answered question
 *   3. + Locked parameter prompts (guardrails) - auto-appended
 * 
 * @param categoryId - UUID of the selected category
 * @param funnelResponses - Object mapping parameter_id to selected level number OR text value
 * @param variantColorProfile - Optional variant-specific color data (shade_name, hue_family, etc.)
 * @returns The full concatenated transformation prompt
 */
export async function generatePromptFromFunnel(
  categoryId: string,
  funnelResponses: Record<string, number | string>,
  variantColorProfile?: Record<string, string | number>
): Promise<string> {
  console.log('🔧 Generating prompt from funnel:', { categoryId, funnelResponses, variantColorProfile });

  // 1. Get base prompt from category
  const category = await getCategory(categoryId);
  if (!category) {
    throw new Error(`Category not found: ${categoryId}`);
  }

  let prompt = category.base_prompt;
  console.log('📝 Starting with base prompt length:', prompt.length);

  // 2. Get all parameters for this category (ordered by sort_order)
  const params = await getCategoryParameters(categoryId);
  console.log(`📋 Found ${params.length} parameters`);

  // 3. Process each parameter (skip variant-specific unless variantColorProfile provided)
  for (const param of params) {
    // Skip variant-specific params if no variant data provided
    if (param.is_variant_specific && !variantColorProfile) {
      console.log(`⏭️ Skipping variant-specific param: ${param.name} (no variant data)`);
      continue;
    }

    if (param.is_locked && param.locked_prompt) {
      // LOCKED PARAMETER: Always append (guardrails)
      prompt += '\n\n' + param.locked_prompt;
      console.log(`🔒 Appended locked prompt for: ${param.name}`);
    } else if (!param.is_locked) {
      // Determine the response source (variant profile or main funnel responses)
      const responseValue = param.is_variant_specific 
        ? variantColorProfile?.[param.name]
        : funnelResponses[param.id];

      if (responseValue !== undefined && responseValue !== null && responseValue !== '') {
        // Check if this is a text input or a level selection
        if (param.input_type === 'text' || param.input_type === 'textarea') {
          // TEXT INPUT: Use the value directly in a formatted prompt line
          prompt += `\n\n${param.display_name}: ${responseValue}`;
          console.log(`📝 Appended text value for: ${param.name} = "${responseValue}"`);
        } else {
          // RADIO/SELECT: Look up the level's prompt_text
          const selectedLevel = typeof responseValue === 'number' ? responseValue : parseInt(String(responseValue), 10);
          if (!isNaN(selectedLevel)) {
            const levelData = await getParameterLevel(param.id, selectedLevel);
            if (levelData?.prompt_text) {
              prompt += '\n\n' + levelData.prompt_text;
              console.log(`✅ Appended level ${selectedLevel} prompt for: ${param.name}`);
            } else {
              console.warn(`⚠️ No prompt_text found for ${param.name} level ${selectedLevel}`);
            }
          }
        }
      }
    }
  }

  console.log('✨ Final prompt length:', prompt.length);
  return prompt;
}

/**
 * Preview what a prompt would look like without saving
 * Useful for the "preview" functionality in the UI
 */
export async function previewPromptFromFunnel(
  categoryId: string,
  funnelResponses: Record<string, number | string>,
  variantColorProfile?: Record<string, string | number>
): Promise<{
  prompt: string;
  categoryName: string;
  parameterCount: number;
  lockedCount: number;
}> {
  const category = await getCategory(categoryId);
  if (!category) {
    throw new Error(`Category not found: ${categoryId}`);
  }

  const params = await getCategoryParameters(categoryId);
  const lockedParams = params.filter(p => p.is_locked);
  const answeredParams = params.filter(p => !p.is_locked && !p.is_variant_specific && funnelResponses[p.id]);

  const prompt = await generatePromptFromFunnel(categoryId, funnelResponses, variantColorProfile);

  return {
    prompt,
    categoryName: category.name,
    parameterCount: answeredParams.length,
    lockedCount: lockedParams.length,
  };
}

/**
 * Validate that all required (non-locked, non-variant-specific) parameters have been answered
 * @param categoryId - UUID of the category
 * @param funnelResponses - Object mapping parameter_id to selected level or text value
 * @returns Object with isValid boolean and array of missing parameter names
 */
export async function validateFunnelResponses(
  categoryId: string,
  funnelResponses: Record<string, number | string>
): Promise<{
  isValid: boolean;
  missingParameters: string[];
}> {
  const params = await getCategoryParameters(categoryId);
  
  // Get non-locked, non-variant-specific parameters (these require user answers)
  const requiredParams = params.filter(p => !p.is_locked && !p.is_variant_specific);
  
  const missingParameters: string[] = [];
  
  for (const param of requiredParams) {
    const value = funnelResponses[param.id];
    if (value === undefined || value === null || value === '') {
      missingParameters.push(param.display_name);
    }
  }
  
  return {
    isValid: missingParameters.length === 0,
    missingParameters,
  };
}
