# Release Guide - Publishing to GitHub

This guide explains how to publish your HOME extension on GitHub with automated builds.

## 📋 Prerequisites

1. **GitHub Repository**
   - Create a new repository on GitHub
   - Name it something like `home` or `chrome-extension-home`

2. **Local Git Setup**
   - Make sure Git is installed
   - Configure your Git user:
     ```bash
     git config --global user.name "Your Name"
     git config --global user.email "your.email@example.com"
     ```

## 🚀 Initial Setup

### 1. Initialize Git Repository

```bash
cd /path/to/productivity-extension
git init
git add .
git commit -m "Initial commit: HOME extension"
```

### 2. Connect to GitHub

```bash
# Replace YOUR_USERNAME and YOUR_REPO with your actual GitHub username and repo name
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### 3. Update README

Edit `README.md` and replace:
- `YOUR_USERNAME` with your GitHub username
- Update the repository name if different

## 📦 Creating Your First Release

### Option 1: Using the Release Script (Recommended)

The `release.sh` script automates version bumping and tagging:

```bash
# For first release (v1.0.0 → v1.0.1)
./release.sh patch

# For minor version (v1.0.1 → v1.1.0)
./release.sh minor

# For major version (v1.1.0 → v2.0.0)
./release.sh major
```

The script will:
1. Check for uncommitted changes
2. Bump the version in `manifest.json`
3. Commit the change
4. Create a git tag
5. Push to GitHub
6. Trigger the automated build

### Option 2: Manual Release

If you prefer to do it manually:

```bash
# 1. Update version in home/manifest.json
nano home/manifest.json
# Change "version": "1.0.0" to "1.0.1" (or your desired version)

# 2. Commit the change
git add home/manifest.json
git commit -m "Bump version to v1.0.1"

# 3. Create a tag
git tag -a v1.0.1 -m "Release v1.0.1"

# 4. Push to GitHub
git push origin main
git push origin v1.0.1
```

## 🤖 What Happens Automatically

When you push a version tag (like `v1.0.1`), GitHub Actions automatically:

1. ✅ Checks out the code
2. ✅ Updates the manifest version
3. ✅ Creates a ZIP package of the extension
4. ✅ Creates a GitHub Release with installation instructions
5. ✅ Uploads the ZIP file as a release asset

Users can then download the ZIP from your releases page!

## 📥 How Users Install Your Extension

Share this link with users: `https://github.com/YOUR_USERNAME/YOUR_REPO/releases`

Users will:
1. Download the latest `.zip` file
2. Extract it
3. Load it as an unpacked extension in Chrome (`chrome://extensions/`)

## 🔄 Making Updates

When you want to release a new version:

1. **Make your changes** to the code
2. **Commit them** to git:
   ```bash
   git add .
   git commit -m "Add new feature: XYZ"
   git push origin main
   ```
3. **Create a new release**:
   ```bash
   ./release.sh patch  # or minor/major
   ```

That's it! GitHub Actions handles the rest.

## 📝 Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (v2.0.0): Breaking changes, major new features
- **MINOR** (v1.1.0): New features, no breaking changes
- **PATCH** (v1.0.1): Bug fixes, small improvements

Examples:
- v1.0.0 → v1.0.1: Fixed Slack scraping bug (patch)
- v1.0.1 → v1.1.0: Added new calendar integration (minor)
- v1.1.0 → v2.0.0: Complete UI redesign (major)

## 🎨 Adding Screenshots

To make your release more attractive:

1. Take screenshots of your extension:
   - Main dashboard view
   - Workspace switcher
   - Theme customization
   - Settings panel

2. Create a `screenshots/` folder:
   ```bash
   mkdir screenshots
   ```

3. Add images and update README:
   ```markdown
   ## Screenshots

   ![Dashboard](screenshots/dashboard.png)
   ![Themes](screenshots/themes.png)
   ```

## 🐛 Troubleshooting

### GitHub Actions failing?

1. Check the Actions tab: `https://github.com/YOUR_USERNAME/YOUR_REPO/actions`
2. Click on the failed workflow to see logs
3. Common issues:
   - Missing `GITHUB_TOKEN`: This is automatic, shouldn't be an issue
   - Syntax error in YAML: Check `.github/workflows/release.yml`

### Tag already exists?

If you pushed a tag by mistake:
```bash
# Delete local tag
git tag -d v1.0.1

# Delete remote tag
git push origin :refs/tags/v1.0.1

# Create new tag
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin v1.0.1
```

### Need to update a release?

1. Delete the release on GitHub (keep the tag)
2. Push a new commit
3. Delete and recreate the tag:
   ```bash
   git tag -d v1.0.1
   git push origin :refs/tags/v1.0.1
   git tag -a v1.0.1 -m "Release v1.0.1"
   git push origin v1.0.1
   ```

## 📢 Promoting Your Extension

Once published on GitHub:

1. **Add topics** to your repo: `chrome-extension`, `productivity`, `workspace-management`
2. **Write a good description** on GitHub
3. **Add a demo GIF** to README
4. **Share on**:
   - Reddit: r/chrome, r/chrome_extensions, r/productivity
   - Twitter/X with hashtags: #ChromeExtension #Productivity
   - Dev.to or Medium blog post
   - Product Hunt (if it gains traction)

## 🔐 Security Note

Never commit:
- API keys
- Passwords
- Personal Slack workspace IDs
- OAuth tokens

These should be configured by users after installation.

---

## ✅ Checklist Before First Release

- [ ] Created GitHub repository
- [ ] Pushed code to GitHub
- [ ] Updated README with your GitHub username
- [ ] Tested the extension locally
- [ ] Removed any personal data from code
- [ ] Verified `.gitignore` excludes sensitive files
- [ ] Created first release with `./release.sh patch`
- [ ] Verified GitHub Actions completed successfully
- [ ] Downloaded and tested the released ZIP file
- [ ] Shared release link with users!

---

**Questions?** Open an issue on your repo or check GitHub Actions logs for details.

Happy releasing! 🎉
