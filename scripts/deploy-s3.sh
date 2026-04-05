#!/bin/bash
# Deploy Argus demo to S3 for testing
# Usage: ./scripts/deploy-s3.sh [bucket-name]

set -e

BUCKET_NAME="${1:-argus-fingerprint-demo}"
REGION="us-east-1"

echo "🚀 Deploying Argus to S3: $BUCKET_NAME"

# Create bucket (ignore error if exists)
echo "📦 Creating bucket..."
aws s3 mb "s3://$BUCKET_NAME" --region "$REGION" 2>/dev/null || true

# Disable block public access
echo "🔓 Configuring public access..."
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Enable static website hosting
echo "🌐 Enabling static website hosting..."
aws s3 website "s3://$BUCKET_NAME" --index-document index.html

# Bucket policy for public read
echo "📜 Setting bucket policy..."
aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"PublicReadGetObject\",
    \"Effect\": \"Allow\",
    \"Principal\": \"*\",
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"arn:aws:s3:::$BUCKET_NAME/*\"
  }]
}"

# Upload files
echo "📤 Uploading public folder..."
aws s3 sync ./public "s3://$BUCKET_NAME" --acl public-read

echo "📤 Uploading dist folder..."
aws s3 sync ./dist "s3://$BUCKET_NAME/dist" --acl public-read

WEBSITE_URL="http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com"

echo ""
echo "✅ Deployed!"
echo "🔗 URL: $WEBSITE_URL"
echo ""
echo "To test with bots:"
echo "  cd ../bots && node bot.mjs --mode stealth --url $WEBSITE_URL"
