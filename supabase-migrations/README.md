# Supabase Migrations

This directory contains SQL migrations for the Gleame App database.

## Current Database Schema (Before Migration)

### Tables
1. **shops**
   - `id` (UUID, PRIMARY KEY)
   - `shop_domain` (TEXT)
   - `shopify_id` (TEXT)
   - `shop_name` (TEXT)
   - `created_at` (TIMESTAMP)

2. **products**
   - `id` (UUID, PRIMARY KEY)
   - `shop_id` (UUID, FOREIGN KEY -> shops.id)
   - `shopify_id` (TEXT) - Shopify product GID
   - `product_name` (TEXT)
   - `transformation_prompt` (TEXT) - Default prompt for product
   - `created_at` (TIMESTAMP)

3. **analytics_events**
   - `id` (UUID, PRIMARY KEY)
   - `shop_id` (UUID, FOREIGN KEY -> shops.id)
   - `product_id` (UUID, FOREIGN KEY -> products.id)
   - `event_type` (TEXT)
   - `created_at` (TIMESTAMP)

---

## Migration 001: Add Product Variants Support

**File:** `001_add_product_variants_table.sql`

**What it does:**
- Adds new `product_variants` table for variant-specific transformation prompts
- Creates indexes for performance
- Adds auto-updating timestamp trigger
- **Does NOT modify existing tables**
- **Does NOT delete any data**

**How to run:**
1. Open Supabase Dashboard
2. Go to SQL Editor
3. Copy contents of `001_add_product_variants_table.sql`
4. Run the migration
5. Verify success with verification queries in the file

**New schema after migration:**

4. **product_variants** (NEW)
   - `id` (UUID, PRIMARY KEY)
   - `product_id` (UUID, FOREIGN KEY -> products.id)
   - `shopify_variant_id` (TEXT) - Shopify variant GID
   - `variant_title` (TEXT) - Human-readable name
   - `transformation_prompt` (TEXT) - Variant-specific prompt
   - `created_at` (TIMESTAMP)
   - `updated_at` (TIMESTAMP)
   - UNIQUE constraint on (product_id, shopify_variant_id)

---

## Rollback: Remove Product Variants Support

**File:** `002_rollback_product_variants.sql`

**When to use:**
- If migration causes issues
- If you want to revert to product-level prompts only
- For testing purposes

**What it does:**
- Removes `product_variants` table
- Removes all indexes and triggers
- **Preserves all product-level configurations**

**⚠️ Warning:** This deletes all variant-specific configurations!

**How to run:**
1. Backup variant data if needed (run verification queries first)
2. Open Supabase Dashboard
3. Go to SQL Editor
4. Copy contents of `002_rollback_product_variants.sql`
5. Run the rollback
6. Verify system still works

---

## Testing the Migration

### Before Running Migration

```sql
-- Check current products
SELECT COUNT(*) as total_products FROM products;

-- Check a sample product
SELECT * FROM products LIMIT 1;
```

### After Running Migration

```sql
-- Verify new table exists
SELECT * FROM information_schema.tables WHERE table_name = 'product_variants';

-- Check table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'product_variants';

-- Test insert (replace with real IDs)
INSERT INTO product_variants (product_id, shopify_variant_id, variant_title, transformation_prompt)
VALUES (
  'your-product-id-here',
  'gid://shopify/ProductVariant/12345',
  'Test Variant',
  'Test transformation prompt'
);

-- Verify insert worked
SELECT * FROM product_variants;

-- Clean up test
DELETE FROM product_variants WHERE variant_title = 'Test Variant';
```

---

## Lookup Logic (How Prompts are Retrieved)

```
Customer selects variant on product page
    ↓
Widget sends: productId + variantId
    ↓
API checks:
    1. Does product_variants entry exist for this variant?
       YES → Use variant-specific prompt ✅
       NO  → Fall back to product-level prompt 🔄
    ↓
AI transformation with correct prompt
```

---

## Safety Features

✅ **Backward Compatible**
   - Existing products without variants still work
   - Old API calls (without variantId) still work

✅ **No Data Loss**
   - Migration only adds tables
   - Rollback preserves product configs

✅ **Cascading Deletes**
   - If product deleted, variant configs auto-delete
   - Prevents orphaned data

✅ **Unique Constraints**
   - Prevents duplicate variant configs
   - Data integrity maintained

---

## Support

If issues occur:
1. Check Supabase logs
2. Run verification queries
3. Use rollback script if needed
4. Restore from `.backups/pre-variant-support/` directory

