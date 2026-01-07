#!/bin/bash
# MiGrid Documentation Deployment Script
# Run this from your local machine after downloading the deployment package

set -e

echo "🚀 MiGrid Documentation Deployment"
echo "=================================="

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    echo "   Please run this from your migrid-core repository root"
    exit 1
fi

# Create docs directory if it doesn't exist
mkdir -p docs
mkdir -p .github/workflows

# Copy documentation files
echo "📁 Copying documentation files..."
cp -r migrid-deploy/docs/* docs/
cp migrid-deploy/.github/workflows/pages.yml .github/workflows/

# Stage changes
echo "📝 Staging changes..."
git add docs/
git add .github/workflows/pages.yml

# Show what will be committed
echo ""
echo "📋 Files to be committed:"
git status --short docs/ .github/workflows/pages.yml

# Commit
echo ""
read -p "Proceed with commit? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git commit -m "Add GitHub Pages documentation site

- Interactive architecture explorer with embedded Claude artifact
- 10-layer microservices documentation with repo links
- Product roadmap (Q1 2025 - Q1 2026)
- Quick start guide and standards reference
- Auto-deploy workflow for GitHub Pages"

    echo ""
    echo "✅ Committed! Now push with:"
    echo "   git push origin main"
    echo ""
    echo "📖 Then enable GitHub Pages:"
    echo "   1. Go to Settings → Pages"
    echo "   2. Source: Deploy from branch"
    echo "   3. Branch: main, Folder: /docs"
    echo ""
    echo "🌐 Your docs will be at: https://[username].github.io/migrid-core/"
else
    echo "❌ Aborted"
fi
