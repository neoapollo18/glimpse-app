#!/bin/bash
# Test script for Phase 2 API

# REPLACE THESE VALUES:
SHOP_DOMAIN="your-shop.myshopify.com"  # Your shop domain
PRODUCT_ID="gid://shopify/Product/YOUR_ID"  # Your product ID
VARIANT_ID="gid://shopify/ProductVariant/TEST123"  # The test variant we created
API_URL="https://glimpse-app-charles.onrender.com/api/storefront/transform-image"  # Your deployed app URL

# Test image (create a simple test image)
echo "Creating test image..."
convert -size 100x100 xc:blue test-image.jpg 2>/dev/null || {
  echo "ImageMagick not found. Use any image file named 'test-image.jpg'"
  exit 1
}

echo ""
echo "================================"
echo "TEST 1: With Variant ID"
echo "================================"
echo "Expected: Should use variant prompt"
echo ""

curl -X POST "$API_URL" \
  -F "image=@test-image.jpg" \
  -F "productId=$PRODUCT_ID" \
  -F "shopDomain=$SHOP_DOMAIN" \
  -F "variantId=$VARIANT_ID" \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.'

echo ""
echo "================================"
echo "TEST 2: Without Variant ID"
echo "================================"
echo "Expected: Should use product-level prompt"
echo ""

curl -X POST "$API_URL" \
  -F "image=@test-image.jpg" \
  -F "productId=$PRODUCT_ID" \
  -F "shopDomain=$SHOP_DOMAIN" \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.'

echo ""
echo "================================"
echo "TEST 3: Invalid Variant ID"
echo "================================"
echo "Expected: Should fall back to product prompt"
echo ""

curl -X POST "$API_URL" \
  -F "image=@test-image.jpg" \
  -F "productId=$PRODUCT_ID" \
  -F "shopDomain=$SHOP_DOMAIN" \
  -F "variantId=gid://shopify/ProductVariant/INVALID999" \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.'

# Cleanup
rm -f test-image.jpg

echo ""
echo "================================"
echo "Tests complete!"
echo "================================"

