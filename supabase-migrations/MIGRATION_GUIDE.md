# 🚀 Phase 1 Migration Guide: Add Variant Support

**Status:** Ready to run  
**Risk Level:** ⚠️ LOW (Additive only, no data modification)  
**Time Required:** 5-10 minutes  
**Rollback Available:** ✅ Yes

---

## 📋 Pre-Migration Checklist

- [x] Feature branch created (`feature/variant-support`)
- [x] Original files backed up to `.backups/pre-variant-support/`
- [x] Migration SQL created (`001_add_product_variants_table.sql`)
- [x] Rollback SQL created (`002_rollback_product_variants.sql`)
- [x] Verification queries ready (`003_verify_migration.sql`)
- [x] Documentation complete
- [ ] **YOU NEED TO:** Open Supabase Dashboard
- [ ] **YOU NEED TO:** Run migration
- [ ] **YOU NEED TO:** Verify success

---

## 🎯 Step-by-Step Migration Process

### Step 1: Access Supabase Dashboard

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your Glimpse App project
3. Navigate to **SQL Editor** in the left sidebar

### Step 2: Backup Current Data (Optional but Recommended)

Run this query to document current state:

```sql
-- Save current product count
SELECT 
  'products' as table_name,
  COUNT(*) as record_count,
  NOW() as backup_timestamp
FROM products;

-- Save current shop count  
SELECT 
  'shops' as table_name,
  COUNT(*) as record_count,
  NOW() as backup_timestamp
FROM shops;
```

Copy the results and save them somewhere safe.

### Step 3: Run the Migration

1. Open the file: `supabase-migrations/001_add_product_variants_table.sql`
2. Copy **ALL** contents (from top to bottom)
3. Paste into Supabase SQL Editor
4. Click **Run** or press `Cmd + Enter` (Mac) / `Ctrl + Enter` (Windows)

**Expected Output:**
- ✅ CREATE TABLE
- ✅ CREATE INDEX (3 indexes)
- ✅ CREATE FUNCTION
- ✅ CREATE TRIGGER

If you see any **errors**, STOP and check:
- Is the table already created? (run verification first)
- Do you have permissions?
- Is Supabase online?

### Step 4: Verify Migration Success

1. Open the file: `supabase-migrations/003_verify_migration.sql`
2. Copy **ALL** verification queries
3. Run them in SQL Editor

**Expected Results:**

| Check | Expected | Status |
|-------|----------|--------|
| Table exists | 1 row | ✅ |
| Columns count | 7 columns | ✅ |
| Indexes count | 4 indexes | ✅ |
| Constraints | PRIMARY KEY, FOREIGN KEY, UNIQUE | ✅ |
| Triggers | 1 trigger | ✅ |
| Orphaned data | 0 orphaned | ✅ |
| Existing products | Your product count unchanged | ✅ |

### Step 5: Test with Sample Data (Optional)

Run this test to ensure everything works:

```sql
-- Get a real product ID from your database
SELECT id, product_name FROM products LIMIT 1;

-- Insert test variant (replace 'your-product-id' with actual ID from above)
INSERT INTO product_variants (
  product_id, 
  shopify_variant_id, 
  variant_title, 
  transformation_prompt
)
VALUES (
  'your-product-id-here',
  'gid://shopify/ProductVariant/TEST123',
  'Test Red Eyeliner',
  'Apply vibrant red eyeliner to the person''s eyes, making them pop'
)
RETURNING *;

-- Verify it was inserted
SELECT * FROM product_variants WHERE variant_title = 'Test Red Eyeliner';

-- Test the lookup (this is what your API will do)
SELECT 
  p.product_name,
  pv.variant_title,
  pv.transformation_prompt
FROM product_variants pv
JOIN products p ON pv.product_id = p.id
WHERE pv.shopify_variant_id = 'gid://shopify/ProductVariant/TEST123';

-- Clean up test data
DELETE FROM product_variants WHERE shopify_variant_id = 'gid://shopify/ProductVariant/TEST123';
```

---

## ✅ Success Criteria

Migration is successful if:

1. ✅ All verification queries return expected results
2. ✅ `product_variants` table exists in your database
3. ✅ Existing `products` table is unchanged
4. ✅ No errors in Supabase logs
5. ✅ Test insert/select/delete works correctly

---

## 🔴 If Something Goes Wrong

### Problem: Migration fails with error

**Solution:**
1. Read the error message carefully
2. Check if table already exists:
   ```sql
   SELECT * FROM information_schema.tables WHERE table_name = 'product_variants';
   ```
3. If table exists, migration already ran (you're good!)
4. If different error, check Supabase status and permissions

### Problem: Can't create foreign key

**Solution:**
```sql
-- Check if products table exists
SELECT COUNT(*) FROM products;

-- If error, your products table might be in different schema
SELECT table_schema, table_name 
FROM information_schema.tables 
WHERE table_name = 'products';
```

### Problem: Need to rollback

**Solution:**
1. Open `002_rollback_product_variants.sql`
2. Run in Supabase SQL Editor
3. Verify table is gone:
   ```sql
   SELECT * FROM information_schema.tables WHERE table_name = 'product_variants';
   ```
4. Should return 0 rows

---

## 📊 Post-Migration Status

After successful migration:

### What Changed:
- ✅ New `product_variants` table created
- ✅ Indexes added for performance
- ✅ Triggers added for auto-timestamps
- ✅ Foreign key constraints protect data integrity

### What Stayed the Same:
- ✅ `products` table unchanged
- ✅ `shops` table unchanged
- ✅ `analytics_events` table unchanged
- ✅ All existing data intact
- ✅ Current API still works (backward compatible)

### Database Size:
- **Before:** ~3 tables
- **After:** ~4 tables
- **Size increase:** Minimal (empty table + indexes ~1KB)

---

## 🎓 Understanding the New Schema

### How Variant Prompts Work:

```
Product: "Premium Eyeliner" (product-level prompt)
├── Default prompt: "Apply eyeliner to the person's eyes"
│
├── Variant 1: "Red Eyeliner" (variant-specific prompt)
│   └── Prompt: "Apply vibrant red eyeliner to the person's eyes"
│
├── Variant 2: "Black Eyeliner" (variant-specific prompt)
│   └── Prompt: "Apply classic black eyeliner to the person's eyes"
│
└── Variant 3: "Blue Eyeliner" (variant-specific prompt)
    └── Prompt: "Apply electric blue eyeliner to the person's eyes"
```

### Lookup Logic:

```javascript
// When customer clicks a variant button
if (variantPrompt exists in product_variants) {
  usePrompt(variantPrompt) // ← Variant-specific
} else {
  usePrompt(productPrompt) // ← Fallback to product-level
}
```

---

## 📝 Next Steps

After migration completes successfully:

1. ✅ Mark this checklist complete
2. ⏭️ Proceed to Phase 2: Update backend code (`supabase.server.ts`)
3. ⏭️ Then Phase 3: Update API routes
4. ⏭️ Then Phase 4: Update admin UI
5. ⏭️ Finally Phase 5: Update storefront widget

---

## 🆘 Need Help?

If you encounter issues:

1. Check Supabase logs (Dashboard → Logs)
2. Review error messages carefully
3. Check verification queries
4. Restore from backup if needed:
   - Files backed up in `.backups/pre-variant-support/`
   - Git branch: `main` (unchanged)
   - Rollback script: `002_rollback_product_variants.sql`

---

## 📸 Migration Snapshot

**Date:** 2024-11-24  
**Branch:** `feature/variant-support`  
**Files Created:**
- `supabase-migrations/001_add_product_variants_table.sql`
- `supabase-migrations/002_rollback_product_variants.sql`
- `supabase-migrations/003_verify_migration.sql`
- `supabase-migrations/README.md`
- `supabase-migrations/MIGRATION_GUIDE.md`

**Backups:**
- `.backups/pre-variant-support/supabase.server.ts`
- `.backups/pre-variant-support/api.storefront.transform-image.ts`
- `.backups/pre-variant-support/app.products.tsx`
- `.backups/pre-variant-support/*.liquid`

**Git Status:** Clean working tree, feature branch ready

---

**Ready to run? Open Supabase and follow the steps above! 🚀**

