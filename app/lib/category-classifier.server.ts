import { GoogleGenAI } from "@google/genai";
import { getCategories } from './supabase.server';

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Use Gemini 3 for classification (fast text model, no image needed)
const CLASSIFICATION_MODEL = "gemini-3-flash-preview";

interface ClassificationResult {
  categoryId: string;
  categoryName: string;
  confidence: 'high' | 'medium' | 'low';
}

// Convert numeric confidence to label
function getConfidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

// Simple keyword mappings for instant matching (no AI needed)
const KEYWORD_TO_CATEGORY: Record<string, string> = {
  // Mascara
  'mascara': 'Mascara',
  'lash': 'Mascara',
  'lashes': 'Mascara',
  'eyelash': 'Mascara',
  // Blush
  'blush': 'Blush',
  'cheek tint': 'Blush',
  'flush': 'Blush',
  // Bronzer
  'bronzer': 'Bronzer',
  'self-tan': 'Bronzer',
  'self tan': 'Bronzer',
  'sunless tan': 'Bronzer',
  // Highlighter
  'highlighter': 'Highlighter',
  'illuminator': 'Highlighter',
  'glow': 'Highlighter',
  // Lip Gloss
  'lip gloss': 'Lip Gloss',
  'lipgloss': 'Lip Gloss',
  'gloss': 'Lip Gloss',
  // Lip Hydration
  'lip balm': 'Lip Hydration',
  'lip mask': 'Lip Hydration',
  'lip treatment': 'Lip Hydration',
  // Eyebrow
  'brow': 'Eyebrow Enhancer',
  'eyebrow': 'Eyebrow Enhancer',
  // Hair
  'hair': 'Hair Health',
  'shampoo': 'Hair Health',
  'conditioner': 'Hair Health',
  // Skin
  'serum': 'Skin Refinement',
  'moisturizer': 'Skin Refinement',
  'cleanser': 'Skin Refinement',
  'face oil': 'Skin Refinement',
  // Brightening
  'vitamin c': 'Brightening & Tone Boost',
  'brightening': 'Brightening & Tone Boost',
  'dark spot': 'Brightening & Tone Boost',
  // Acne
  'acne': 'Acne & Redness Refinement',
  'redness': 'Acne & Redness Refinement',
  'blemish': 'Acne & Redness Refinement',
};

/**
 * Classify a product into one of the 11 beauty categories
 * 
 * First tries simple keyword matching for obvious cases (fast, reliable)
 * Falls back to Gemini AI for ambiguous products
 * 
 * @param productName - The product name/title from Shopify
 * @param productType - Optional product type from Shopify
 * @param productDescription - Optional product description
 * @returns Classification result with categoryId, name, and confidence (0-1)
 */
export async function classifyProduct(
  productName: string,
  productType?: string,
  productDescription?: string
): Promise<ClassificationResult | null> {
  console.log('='.repeat(60));
  console.log('🏷️ CLASSIFYING PRODUCT');
  console.log('   Name:', productName);
  console.log('   Type:', productType || '(none)');
  console.log('   Description:', productDescription ? productDescription.substring(0, 100) + '...' : '(none)');
  console.log('='.repeat(60));

  try {
    // 1. Get all categories from database
    console.log('📂 Fetching categories from database...');
    const categories = await getCategories();
    
    if (!categories || categories.length === 0) {
      console.error('❌ No categories found in database - have you run 009_seed_categories.sql?');
      return null;
    }
    console.log(`✅ Found ${categories.length} categories in database`);

    // 2. TRY KEYWORD MATCH FIRST (fast, reliable for obvious cases)
    const searchText = `${productName} ${productType || ''} ${productDescription || ''}`.toLowerCase();
    console.log('🔑 Searching for keyword matches in:', searchText.substring(0, 100));
    
    for (const [keyword, categoryName] of Object.entries(KEYWORD_TO_CATEGORY)) {
      if (searchText.includes(keyword)) {
        console.log(`   Found keyword "${keyword}" in product text`);
        const matchedCategory = categories.find(c => c.name === categoryName);
        if (matchedCategory) {
          console.log(`✅ KEYWORD MATCH: "${keyword}" → ${categoryName} (id: ${matchedCategory.id})`);
          return {
            categoryId: matchedCategory.id,
            categoryName: matchedCategory.name,
            confidence: 'high', // Keyword matches are always high confidence
          };
        } else {
          console.log(`   ⚠️ Keyword matched but category "${categoryName}" not found in DB`);
        }
      }
    }
    
    console.log('🔍 No keyword match found, falling back to AI classification...');

    // 3. Build category list for the AI prompt (names only - no UUIDs)
    const categoryList = categories
      .map(c => `- "${c.name}": ${c.description}`)
      .join('\n');
    
    console.log('📋 Available categories:', categories.map(c => c.name).join(', '));

    // 3. Build the classification prompt
    const prompt = `You are a beauty product classifier. Given a product's information, determine which category it belongs to.

PRODUCT INFORMATION:
- Name: ${productName}
- Type: ${productType || 'Not specified'}
- Description: ${productDescription ? productDescription.substring(0, 500) : 'Not provided'}

AVAILABLE CATEGORIES:
${categoryList}

INSTRUCTIONS:
1. Analyze the product name, type, and description
2. Match it to the SINGLE most appropriate category
3. Consider what transformation the product would create (skincare effect, makeup application, etc.)

CATEGORY MATCHING GUIDE:
- Cleansers, moisturizers, serums, face oils → "Skin Refinement"
- Acne treatments, anti-redness products → "Acne & Redness Refinement"
- Vitamin C, brightening serums, dark spot correctors → "Brightening & Tone Boost"
- Blush, cheek tint, flush products → "Blush"
- Bronzer, self-tanner, sun-kissed products → "Bronzer"
- Highlighter, illuminator, glow products → "Highlighter"
- Lip balm, lip mask, lip treatment → "Lip Hydration"
- Lip gloss, lip lacquer → "Lip Gloss"
- Mascara, lash products → "Mascara"
- Brow pencil, brow gel, brow products → "Eyebrow Enhancer"
- Hair serum, hair oil, hair treatment, shampoo, conditioner → "Hair Health"

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"categoryName": "Category Name", "confidence": 0.85}

The categoryName MUST exactly match one of the category names listed above.
If you cannot confidently classify the product (confidence < 0.5), respond with:
{"categoryName": null, "confidence": 0}`;

    // 4. Call Gemini
    console.log('🤖 Calling Gemini for classification...');
    console.log('   Model:', CLASSIFICATION_MODEL);
    console.log('   Product:', productName);
    
    let response;
    try {
      response = await client.models.generateContent({
        model: CLASSIFICATION_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.1, // Low temperature for consistent classification
          maxOutputTokens: 200,
        },
      });
      console.log('✅ Gemini API call successful');
    } catch (apiError) {
      console.error('❌ Gemini API call failed:', apiError);
      return null;
    }

    // 5. Parse response
    if (!response || !response.candidates || response.candidates.length === 0) {
      console.error('❌ No response/candidates from Gemini');
      console.error('   Response object:', JSON.stringify(response, null, 2));
      return null;
    }

    const candidate = response.candidates[0];
    console.log('📦 Candidate finish reason:', candidate?.finishReason);
    
    if (!candidate?.content?.parts?.[0]?.text) {
      console.error('❌ Invalid response structure from Gemini');
      console.error('   Candidate:', JSON.stringify(candidate, null, 2));
      return null;
    }

    const responseText = candidate.content.parts[0].text.trim();
    console.log('📝 Gemini raw response:', responseText);

    // 6. Parse JSON response
    try {
      // Clean up response (remove markdown code blocks if present)
      let cleanJson = responseText;
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }
      
      console.log('🧹 Cleaned JSON:', cleanJson);

      const result = JSON.parse(cleanJson);
      console.log('🤖 Gemini parsed result:', result);

      // Validate the response - only check categoryName now (not categoryId)
      if (!result.categoryName || result.confidence < 0.5) {
        console.log('⚠️ No category name or low confidence:', { 
          categoryName: result.categoryName, 
          confidence: result.confidence 
        });
        return null;
      }

      // Case-insensitive exact name lookup
      const matchedCategory = categories.find(
        c => c.name.toLowerCase() === result.categoryName.toLowerCase()
      );

      if (matchedCategory) {
        console.log(`✅ Exact match: "${result.categoryName}" → ${matchedCategory.name}`);
        return {
          categoryId: matchedCategory.id,
          categoryName: matchedCategory.name,
          confidence: getConfidenceLabel(result.confidence),
        };
      }

      // Try partial match as fallback (handles slight variations)
      const partialMatch = categories.find(
        c => c.name.toLowerCase().includes(result.categoryName.toLowerCase()) ||
             result.categoryName.toLowerCase().includes(c.name.toLowerCase())
      );

      if (partialMatch) {
        console.log(`✅ Partial match: "${result.categoryName}" → ${partialMatch.name}`);
        // Partial matches get downgraded one level
        const baseConfidence = getConfidenceLabel(result.confidence);
        const adjustedConfidence = baseConfidence === 'high' ? 'medium' : 'low';
        return {
          categoryId: partialMatch.id,
          categoryName: partialMatch.name,
          confidence: adjustedConfidence,
        };
      }

      console.error('❌ No category found for name:', result.categoryName);
      console.error('   Available categories:', categories.map(c => c.name));
      return null;

    } catch (parseError) {
      console.error('❌ Failed to parse Gemini response as JSON:', responseText);
      console.error('   Parse error:', parseError);
      return null;
    }

  } catch (error) {
    console.error('❌ Error in classifyProduct:', error);
    return null;
  }
}

/**
 * Batch classify multiple products
 * Useful for initial setup or bulk operations
 */
export async function classifyProducts(
  products: Array<{
    id: string;
    name: string;
    type?: string;
    description?: string;
  }>
): Promise<Map<string, ClassificationResult | null>> {
  const results = new Map<string, ClassificationResult | null>();

  // Process sequentially to avoid rate limits
  for (const product of products) {
    const result = await classifyProduct(product.name, product.type, product.description);
    results.set(product.id, result);
    
    // Small delay between calls to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return results;
}
