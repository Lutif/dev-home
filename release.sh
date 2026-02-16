#!/bin/bash

# Release script for HOME extension
# Usage: ./release.sh <major|minor|patch>

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ -z "$1" ]; then
  echo -e "${RED}Error: Please specify version bump type (major, minor, or patch)${NC}"
  echo "Usage: ./release.sh <major|minor|patch>"
  exit 1
fi

BUMP_TYPE=$1

# Check if we're on main/master branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
  echo -e "${YELLOW}Warning: You're not on main/master branch (current: $CURRENT_BRANCH)${NC}"
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}Error: You have uncommitted changes. Please commit or stash them first.${NC}"
  exit 1
fi

# Get current version from manifest.json
CURRENT_VERSION=$(grep -o '"version": "[^"]*"' home/manifest.json | cut -d'"' -f4)
echo -e "${GREEN}Current version: $CURRENT_VERSION${NC}"

# Parse version
IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]}"

# Bump version
case $BUMP_TYPE in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo -e "${RED}Error: Invalid bump type. Use major, minor, or patch${NC}"
    exit 1
    ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo -e "${GREEN}New version: $NEW_VERSION${NC}"

# Confirm
read -p "Create release v$NEW_VERSION? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Release cancelled."
  exit 0
fi

# Update manifest.json
echo "Updating manifest.json..."
sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" home/manifest.json
rm home/manifest.json.bak

# Commit changes
echo "Committing version bump..."
git add home/manifest.json
git commit -m "Bump version to v$NEW_VERSION"

# Create tag
echo "Creating tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

# Push
echo "Pushing to remote..."
git push origin "$CURRENT_BRANCH"
git push origin "v$NEW_VERSION"

echo -e "${GREEN}✅ Release v$NEW_VERSION created successfully!${NC}"
echo -e "${YELLOW}GitHub Actions will now build and publish the release automatically.${NC}"
echo -e "View release progress: https://github.com/YOUR_USERNAME/home/actions"
