# 🧪 Phase 2 Testing Guide

## **Quick Test (5 minutes)**

### **Step 1: Add Test Variant to Database**

1. Open Supabase SQL Editor
2. Get one of your products:
   ```sql
   SELECT id, product_name, shopify_id FROM products LIMIT 1;
   ```
3. Copy the `id` (it's a UUID like `abc123-def456-...`)
4. Insert test variant:
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
     'TEST VARIANT PROMPT: Apply vibrant red cosmetic enhancement'
   );
   ```
5. Verify:
   ```sql
   SELECT * FROM product_variants WHERE variant_title = 'Test Red Variant';
   ```

---

### **Step 2: Test Locally (Option A - Recommended)**

1. Start your dev server:
   ```bash
   npm run dev
   ```

2. Open the test page:
   ```bash
   open .phase2-changes/test-local.html
   ```

3. Fill in the form:
   - API URL: `http://localhost:3000/api/storefront/transform-image`
   - Shop Domain: Your shop (e.g., `wettskin-test.myshopify.com`)
   - Product ID: The `shopify_id` from Step 1
   - Variant ID: `gid://shopify/ProductVariant/TEST123`
   - Select any image file

4. Run tests:
   - **Test 1**: With variant ID → Should work if variant configured
   - **Test 2**: Without variant ID → Should use product prompt
   - **Test 3**: Invalid variant ID → Should fall back to product

5. Check console logs for:
   ```
   ✅ Using variant-specific prompt
   or
   ⚠️ No variant config found, falling back to product-level
   ```

---

### **Step 2: Test in Production (Option B)**

If your app is already deployed:

1. Open test page: `.phase2-changes/test-local.html`
2. Change API URL to: `https://glimpse-app-charles.onrender.com/api/storefront/transform-image`
3. Run same tests as above
4. Check server logs on Render

---

## **What to Look For**

### **✅ Success Indicators:**

1. **Test 1 (With Variant):**
   - Status: 200
   - Response includes: `success: true`
   - Server logs show: `✅ Using variant-specific prompt`
   - Transformed image uses variant prompt

2. **Test 2 (Without Variant):**
   - Status: 200
   - Response includes: `success: true`
   - Server logs show: `✅ Using product-level prompt`
   - Transformed image uses product prompt

3. **Test 3 (Invalid Variant):**
   - Status: 200
   - Response includes: `success: true`
   - Server logs show: `⚠️ No variant config found, falling back`
   - Transformed image uses product prompt (fallback works!)

---

### **❌ Failure Indicators:**

1. **Status 404:**
   - Product not found in database
   - Check your product is configured in admin UI

2. **Status 500:**
   - Server error
   - Check server logs for details
   - Might be database connection issue

3. **No variant prompt used:**
   - Check variant was inserted correctly
   - Verify `product_id` matches
   - Verify `shopify_variant_id` format

---

## **Deep Dive: Check Server Logs**

### **Where to Find Logs:**

**Local Dev:**
```bash
# Terminal where you ran 'npm run dev'
# Watch for console.log outputs
```

**Render (Production):**
1. Go to Render Dashboard
2. Click your app
3. Click "Logs" tab
4. Watch real-time logs

### **What You'll See:**

**Successful Variant Lookup:**
```
Getting config with variant support: {
  shopDomain: 'wettskin-test.myshopify.com',
  productId: 'gid://shopify/Product/9616382230849',
  variantId: 'gid://shopify/ProductVariant/TEST123'
}
Looking for product config: {...}
Found shop: abc-123-def-456
Searching for shopify_id: gid://shopify/Product/9616382230849
Found product: {...}
Looking for variant config: {...}
Searching for variant_id: gid://shopify/ProductVariant/TEST123
Found variant config: {
  id: 'xyz-789',
  variant_title: 'Test Red Variant',
  transformation_prompt: 'TEST VARIANT PROMPT: ...'
}
✅ Using variant-specific prompt
```

**Fallback to Product:**
```
Getting config with variant support: {...}
Looking for variant config: {...}
Variant config not found: No rows found
⚠️  No variant config found, falling back to product-level
Looking for product config: {...}
✅ Using product-level prompt
```

---

## **Troubleshooting**

### **Problem: "Product not configured for transformations"**

**Solution:**
- Product doesn't exist in your database
- Go to admin UI → Configure the product first

### **Problem: Variant not being used**

**Check:**
1. Variant exists in database:
   ```sql
   SELECT * FROM product_variants WHERE shopify_variant_id = 'YOUR_VARIANT_ID';
   ```

2. `product_id` matches:
   ```sql
   SELECT pv.*, p.product_name 
   FROM product_variants pv
   JOIN products p ON pv.product_id = p.id
   WHERE pv.shopify_variant_id = 'YOUR_VARIANT_ID';
   ```

3. Variant ID format (should be one of these):
   - `gid://shopify/ProductVariant/123456789`
   - `123456789` (numeric only)

### **Problem: CORS errors in browser**

**Expected!** The API has CORS enabled, but:
- Test locally first with dev server
- Or use the HTML test page (it handles CORS properly)

---

## **Clean Up After Testing**

Remove test data:

```sql
-- Delete test variant
DELETE FROM product_variants WHERE variant_title = 'Test Red Variant';

-- Verify it's gone
SELECT * FROM product_variants WHERE variant_title = 'Test Red Variant';
-- Should return 0 rows
```

---

## **Next Steps After Testing**

Once all tests pass:

1. ✅ Phase 2 is working!
2. ⏭️ Move to Phase 3: Admin UI
3. 🎨 Add UI to configure variants in admin
4. 🔄 Then Phase 4: Update widget to send variantId

---

## **Quick Reference: Expected Behavior**

| Scenario | Variant Configured? | What Happens |
|----------|---------------------|--------------|
| Send variantId | ✅ Yes | Use variant prompt |
| Send variantId | ❌ No | Fall back to product prompt |
| Don't send variantId | N/A | Use product prompt |
| Invalid variantId | ❌ No | Fall back to product prompt |
| Product not configured | N/A | Return 404 error |

---

## **Files for Testing**

Created test files in `.phase2-changes/`:
- `test-local.html` - Browser-based testing interface
- `TEST_API.sh` - Command-line curl tests
- `TESTING_GUIDE.md` - This guide

**Start testing with the HTML file - it's the easiest!**

```bash
open .phase2-changes/test-local.html
```

