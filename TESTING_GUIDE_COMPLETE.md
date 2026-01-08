# 🧪 COMPLETE TESTING GUIDE - Variant Support

## **Pre-Testing Checklist**

Before you start, make sure:
- ✅ Database migration ran successfully (Phase 1)
- ✅ `product_variants` table exists in Supabase
- ✅ Code changes committed to `feature/variant-support` branch
- ✅ No linter errors

---

## **TEST ENVIRONMENT SETUP**

### **Option 1: Test in Development (Recommended)**

1. **Start your dev server:**
   ```bash
   cd /Users/charles/glimpse-app
   npm run dev
   ```

2. **The app should start on** `http://localhost:3000` (or similar)

3. **Open in browser** and authenticate with Shopify

---

### **Option 2: Deploy to Staging First**

If you want to test on your actual Shopify store:

1. **Deploy to Render/Vercel:**
   ```bash
   # Make sure you're on the feature branch
   git status
   
   # Deploy (this will push and trigger deployment)
   git push origin feature/variant-support
   ```

2. **Wait for deployment** to complete

3. **Update Shopify App URL** if needed

---

## **PHASE 1 TEST: Database**

### **✅ Verify Table Exists**

1. Open [Supabase Dashboard](https://supabase.com/dashboard)
2. Go to **SQL Editor**
3. Run:
   ```sql
   SELECT * FROM information_schema.tables 
   WHERE table_name = 'product_variants';
   ```
   **Expected:** 1 row returned

4. Check structure:
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'product_variants';
   ```
   **Expected:** 7 columns (id, product_id, shopify_variant_id, variant_title, transformation_prompt, created_at, updated_at)

**✅ PASS CRITERIA:** Table exists with all columns

---

## **PHASE 2 TEST: Backend Functions**

### **Test 1: Insert Test Data**

1. Get one of your products:
   ```sql
   SELECT id, product_name, shopify_id FROM products LIMIT 1;
   ```
   **Copy the `id`** (it's a UUID)

2. Insert test variant:
   ```sql
   INSERT INTO product_variants (
     product_id,
     shopify_variant_id,
     variant_title,
     transformation_prompt
   ) VALUES (
     'PASTE-YOUR-PRODUCT-ID-HERE',
     'gid://shopify/ProductVariant/TEST123',
     'Test Red Variant',
     'TEST: Apply vibrant red cosmetic enhancement dramatically'
   );
   ```

3. Verify:
   ```sql
   SELECT * FROM product_variants WHERE variant_title = 'Test Red Variant';
   ```
   **Expected:** 1 row with your data

**✅ PASS CRITERIA:** Data inserted successfully

### **Test 2: API Accepts variantId**

Check the API route accepts variant parameter:

```bash
# This should NOT error (even if product not configured)
curl -X POST http://localhost:3000/api/storefront/transform-image \
  -F "image=@test.jpg" \
  -F "productId=gid://shopify/Product/123" \
  -F "shopDomain=yourshop.myshopify.com" \
  -F "variantId=gid://shopify/ProductVariant/TEST123"
```

**Expected:** Some response (404 is fine if product not configured)

**✅ PASS CRITERIA:** API doesn't crash with variantId parameter

---

## **PHASE 3 TEST: Admin UI**

### **Test 1: View Products**

1. **Open your Shopify admin**
2. **Go to Apps** → **Gleame App** (your app name)
3. **Click "Product Configuration"**
4. **You should see:**
   - List of Shopify products
   - "Configure" button on unconfigured products
   - "Configured" (disabled) on configured products
   - List of configured products at top

**✅ PASS CRITERIA:** Product list loads correctly

---

### **Test 2: Configure a New Product**

1. **Find an unconfigured product** (has "Configure" button)
2. **Click "Configure"**
3. **Modal opens:**
   - Product image and name visible
   - "AI Transformation Prompt" field
4. **Enter a prompt:**
   ```
   Using the provided photo, make a gentle cosmetic enhancement to the skin
   ```
5. **Click "Save Configuration"**
6. **Success banner** should appear
7. **Product now shows** in "Configured Products" section

**✅ PASS CRITERIA:** Product configured successfully

---

### **Test 3: Edit Product and View Variants**

#### **Important:** This test only works if your product has multiple variants in Shopify!

1. **Click "Edit"** on a configured product
2. **Modal opens** showing:
   - Product-level prompt
   - **"Variant-Specific Prompts (Optional)"** section
   - List of all product variants

3. **Check variant section shows:**
   - Each variant name (e.g., "Red Eyeliner", "Black Eyeliner")
   - Variant price
   - Availability status
   - Badge: "Using default" (if not configured)
   - "Configure Variant" button

**✅ PASS CRITERIA:** Variants section visible and shows all product variants

---

### **Test 4: Configure a Variant**

1. **Click "Configure Variant"** on one of the variants
2. **New modal opens:**
   - Variant name at top
   - "Variant Transformation Prompt" field
   - Info banner about fallback
3. **Enter variant-specific prompt:**
   ```
   Using the provided photo, apply vibrant RED eyeliner to enhance the eyes dramatically
   ```
4. **Click "Save Variant"**
5. **Success message** appears
6. **Back in edit modal,** variant now shows:
   - Badge: "✅ Configured" (green)
   - Prompt preview
   - "Edit" and "Delete" buttons

**✅ PASS CRITERIA:** Variant configured successfully

---

### **Test 5: Edit Variant Prompt**

1. **Click "Edit"** on configured variant
2. **Modal opens** with existing prompt
3. **Modify the prompt**
4. **Click "Save Variant"**
5. **Updated prompt shows** in variant list

**✅ PASS CRITERIA:** Variant prompt updated

---

### **Test 6: Delete Variant Configuration**

1. **Click "Delete"** on configured variant
2. **Variant returns to:**
   - Badge: "Using default"
   - No prompt preview
   - "Configure Variant" button appears

**✅ PASS CRITERIA:** Variant config deleted, returns to default

---

### **Test 7: Configure Multiple Variants**

1. **Configure 2-3 different variants** for the same product
2. **Each should have different prompts**
3. **All should show "Configured" badges**
4. **Close and reopen** edit modal
5. **All configurations should persist**

**✅ PASS CRITERIA:** Multiple variants configured independently

---

## **PHASE 4 TEST: Storefront Widget (MANUAL)**

**Note:** Phase 4 (Widget updates) is not implemented yet. This will be tested later.

For now, you can manually test the backend by:

1. **Get your product ID** from Shopify admin
2. **Get a variant ID** from one of the configured variants
3. **Use curl to test:**

```bash
curl -X POST https://your-app.com/api/storefront/transform-image \
  -F "image=@selfie.jpg" \
  -F "productId=gid://shopify/Product/YOUR_ID" \
  -F "shopDomain=yourshop.myshopify.com" \
  -F "variantId=gid://shopify/ProductVariant/YOUR_VARIANT_ID"
```

4. **Check server logs** for:
   ```
   ✅ Using variant-specific prompt
   ```

**✅ PASS CRITERIA:** API uses variant prompt when provided

---

## **END-TO-END SCENARIOS**

### **Scenario 1: Eyeliner with 3 Colors**

**Setup:**
1. Product: "Premium Eyeliner"
2. Product-level prompt: "Apply eyeliner to the person's eyes"
3. Variants:
   - Red Eyeliner: "Apply vibrant red eyeliner"
   - Black Eyeliner: "Apply classic black eyeliner"
   - Blue Eyeliner: "Apply electric blue eyeliner"

**Test:**
- ✅ All 3 variants configured in admin
- ✅ Each shows unique prompt
- ✅ All show "Configured" badges
- ✅ Can edit each independently
- ✅ Can delete and reconfigure

---

### **Scenario 2: Product WITHOUT Variants**

**Setup:**
1. Product with only 1 variant (default)
2. Configure product-level prompt

**Test:**
- ✅ Variant section does NOT appear
- ✅ Only product-level prompt visible
- ✅ Configuration saves correctly

---

### **Scenario 3: Fallback Behavior**

**Setup:**
1. Product with 3 variants
2. Configure only 1 variant (leave others default)

**Test:**
- ✅ Configured variant shows "Configured" badge
- ✅ Other variants show "Using default" badge
- ✅ Product-level prompt still saves

**Expected behavior:**
- Configured variant → Uses variant prompt
- Other variants → Use product-level prompt (fallback)

---

## **TROUBLESHOOTING**

### **Problem: Variants section doesn't appear**

**Check:**
- Is product configured? (Not just created)
- Does product have > 1 variant in Shopify?
- Are you in "Edit" mode (not "Configure" mode)?

**Solution:**
- Click "Edit" on configured product
- Check product has multiple variants in Shopify admin

---

### **Problem: "Failed to save variant configuration"**

**Check:**
1. Product is configured first (product-level)
2. Variant prompt is not empty
3. Check console for errors

**Debug:**
```sql
-- Check if product exists
SELECT * FROM products WHERE id = 'your-product-uuid';

-- Check if variant already exists
SELECT * FROM product_variants WHERE product_id = 'your-product-uuid';
```

---

### **Problem: Configured variants don't load**

**Check:**
1. Browser console for errors
2. `/api/get-variants` endpoint working

**Debug:**
```bash
# Test API directly
curl "http://localhost:3000/api/get-variants?productId=YOUR-UUID"
```

**Expected:** JSON with variants array

---

### **Problem: Database migration failed**

**Rollback:**
```sql
-- Run rollback script
-- Open: supabase-migrations/rollback/002_rollback_product_variants.sql
-- Copy and run in SQL Editor

-- Then re-run migration
-- Open: supabase-migrations/001_add_product_variants_table.sql
```

---

## **LOGS TO WATCH**

### **Server Logs (Dev):**
```
Getting config with variant support: { ... }
Looking for variant config: { ... }
✅ Using variant-specific prompt
or
⚠️ No variant config found, falling back to product-level
```

### **Browser Console:**
```
Loading variants...
Error loading variants: (if any)
Variant configuration: { ... }
```

### **Supabase Logs:**
- Go to Dashboard → Logs
- Watch for INSERT/UPDATE/SELECT queries
- Check for errors

---

## **SUCCESS CHECKLIST**

Phase 1 - Database:
- [ ] `product_variants` table exists
- [ ] Can insert test data
- [ ] Foreign keys work

Phase 2 - Backend:
- [ ] API accepts variantId
- [ ] Variant lookup works
- [ ] Fallback to product works
- [ ] Logs show correct prompt selection

Phase 3 - Admin UI:
- [ ] Product list loads
- [ ] Can configure products
- [ ] Variant section appears for multi-variant products
- [ ] Can configure variants
- [ ] Can edit variants
- [ ] Can delete variants
- [ ] Status badges show correctly
- [ ] All changes persist

---

## **NEXT STEPS AFTER TESTING**

1. **If all tests pass:**
   - Document any issues found
   - Create list of edge cases
   - Ready for Phase 4 (Widget)

2. **If tests fail:**
   - Note which test failed
   - Check error messages
   - Review code for that phase
   - Re-test after fixes

3. **Before deploying to production:**
   - Test with real products
   - Test with real customer photos
   - Verify transformations work correctly
   - Check performance (response times)

---

## **GETTING HELP**

If stuck:
1. Check server logs
2. Check browser console
3. Check Supabase logs
4. Review error messages
5. Check this guide's troubleshooting section

---

**Good luck testing! 🚀**

Remember: It's OK if something doesn't work perfectly on first try. That's what testing is for!

