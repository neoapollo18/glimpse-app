# ⚡ QUICK START - Test Variant Support NOW

## **5-Minute Test Plan**

### **STEP 1: Start Dev Server (1 min)**

```bash
cd /Users/charles/glimpse-app
npm run dev
```

Wait for: `Local: http://localhost:3000`

---

### **STEP 2: Open Your Shopify Admin (1 min)**

1. Open browser
2. Go to your Shopify store admin
3. Click **Apps** (left sidebar)
4. Click **Glimpse App** (or your app name)

---

### **STEP 3: Quick Admin UI Test (3 min)**

#### **A. View Products**
- You should see list of your Shopify products
- Some might already be "Configured"

#### **B. Configure a Product (if none configured)**
1. Click **"Configure"** on any product
2. Enter prompt: `Make gentle skin enhancement`
3. Click **"Save Configuration"**
4. Success! ✅

#### **C. Edit Product and See Variants**
1. Click **"Edit"** on a configured product
2. Scroll down
3. Look for **"Variant-Specific Prompts (Optional)"** section

**IMPORTANT:** This only appears if:
- Product is configured (not new)
- Product has multiple variants in Shopify
- You're in Edit mode (not Configure mode)

#### **D. If You See Variants Section:**

You'll see something like:
```
Red Eyeliner - $15.00 • Available [Using default] [Configure Variant]
Black Eyeliner - $15.00 • Available [Using default] [Configure Variant]
```

Click **"Configure Variant"** on one:
1. Modal opens
2. Enter: `Apply RED eyeliner to enhance eyes`
3. Click **"Save Variant"**
4. Success! ✅

Now you'll see:
```
Red Eyeliner - $15.00 • Available [✅ Configured]
Prompt: Apply RED eyeliner...
[Edit] [Delete]
```

---

## **THAT'S IT!**

You just:
- ✅ Configured a product
- ✅ Configured a variant
- ✅ Saw the variant-specific UI

---

## **What If No Variants Section?**

Your product might not have variants. Check:

1. **Go to Shopify Admin** → **Products**
2. **Open the product** you configured
3. **Scroll to "Variants"** section
4. **Check:** Does it have multiple variants?

### **If Only 1 Variant:**
- Normal! Many products don't have variants
- Variant section won't appear (by design)
- Try a different product that has options (like size, color)

### **If Multiple Variants Exist:**
- Make sure you clicked "Edit" (not "Configure")
- Check browser console for errors
- Refresh page and try again

---

## **Quick Database Check (Optional)**

Want to see your data?

1. Open [Supabase Dashboard](https://supabase.com/dashboard)
2. Go to **Table Editor**
3. Click **`products`** table → See your configured products
4. Click **`product_variants`** table → See configured variants

---

## **Testing Checklist**

Quick verification:

### **Admin UI:**
- [ ] Can open Glimpse App in Shopify admin
- [ ] Can see product list
- [ ] Can configure a product
- [ ] Can edit product
- [ ] Can see variants section (if product has variants)
- [ ] Can configure a variant
- [ ] Can edit variant
- [ ] Can delete variant

### **Expected Behavior:**
- [ ] Product-level prompt saves
- [ ] Variant-level prompt saves
- [ ] Status badges show correctly
- [ ] Changes persist after closing modal
- [ ] No console errors

---

## **Common First-Time Issues**

### **Issue: "App won't load"**
**Fix:** 
```bash
# Stop server (Ctrl+C)
npm install
npm run dev
```

### **Issue: "Unauthorized" when opening app**
**Fix:**
- Make sure you're logged into Shopify
- Try opening in incognito/private window
- Reinstall app if needed

### **Issue: "No products showing"**
**Fix:**
- Add products in Shopify admin first
- Refresh Glimpse App page

### **Issue: "Can't see variants section"**
**Fix:**
- Product must be configured first
- Product must have >1 variant
- Must be in Edit mode (not Configure mode)

---

## **What to Test Next**

After basic functionality works:

1. **Test Multiple Variants:**
   - Configure all variants for one product
   - Give each different prompts
   - Verify all save correctly

2. **Test Edit:**
   - Change variant prompts
   - Verify updates work

3. **Test Delete:**
   - Delete a variant config
   - Verify returns to "Using default"

4. **Test Different Products:**
   - Products with many variants
   - Products with one variant
   - Products with no variants (shouldn't happen in Shopify)

---

## **Screenshots to Verify**

Take screenshots of:
1. Product list in admin
2. Product configuration modal
3. Variant list (if you have multi-variant products)
4. Configured variant with green badge
5. Any errors (if they occur)

---

## **Ready for Full Testing?**

See: `TESTING_GUIDE_COMPLETE.md` for comprehensive tests

---

## **Quick Commands**

```bash
# Start dev
npm run dev

# Stop dev
Ctrl + C

# Check git status
git status

# View your branch
git branch

# See what changed
git diff main
```

---

## **Need Help?**

1. Check browser console (F12)
2. Check terminal for errors
3. Check Supabase logs
4. Review error messages
5. Check `TESTING_GUIDE_COMPLETE.md`

---

**🎉 You're ready to test!**

Start with Step 1 above and work through it. Takes only 5 minutes for basic verification.

