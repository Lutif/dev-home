# HOME - Chrome Extension

A productivity command center that brings GitHub PRs, Slack notifications, and Google Calendar into one unified side panel with Arc-style workspace management.

![HOME](https://img.shields.io/badge/version-1.0.0-blue)
![Chrome](https://img.shields.io/badge/chrome-extension-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## ✨ Features

### 🎯 Unified Dashboard
- **GitHub PR Tracking**: See all PRs requesting your review, your open PRs, and assigned issues
- **Slack Activity Feed**: Monitor mentions and threads from your Slack workspace
- **Google Calendar**: View upcoming events and meetings

### 🎨 Workspace Management
- **Multiple Spaces**: Create unlimited workspaces with custom emojis and names
- **Custom Themes**: Each space has 4 customizable colors (primary, background, surface, accent)
- **Designer Presets**: 6 beautiful pre-made themes (Default, Ocean, Forest, Sunset, Rose, Purple)

### 📁 Organization
- **Pinned Items**: Keep important tabs and links easily accessible
- **Folder System**: Organize tabs and links into collapsible folders
- **Drag & Drop**: Reorder items and folders with intuitive drag-and-drop

### ⚡ Productivity
- **Quick Refresh**: Update all services with one click
- **Auto-Scraping**: Automatically fetches latest data when you navigate to service pages
- **Command Bar**: Quickly navigate with `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)

## 📥 Installation

### Download & Install

1. **Download the latest release**
   - Go to the [Releases page](https://github.com/YOUR_USERNAME/home/releases)
   - Download the latest `home-vX.X.X.zip` file

2. **Extract the ZIP file**
   - Extract the downloaded ZIP to a permanent folder on your computer
   - ⚠️ Don't delete this folder after installation - Chrome needs it to run the extension

3. **Load in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top right corner)
   - Click **Load unpacked**
   - Select the extracted `home` folder
   - The extension icon should appear in your Chrome toolbar!

### First-Time Setup

1. **Click the extension icon** in Chrome toolbar to open the side panel

2. **Configure Slack** (Optional but recommended)
   - Click the settings gear icon
   - Find your Slack Workspace ID in your Slack URL:
     - Open Slack in browser: `app.slack.com/client/T01ABC23DEF/...`
     - Copy the ID (e.g., `T01ABC23DEF`)
   - Paste it into the settings and click Save
   - Navigate to Slack's Activity page to see your mentions

3. **Configure GitHub** (Optional)
   - Click settings gear icon
   - Enter your GitHub username for personalized PR filtering

4. **Start using workspaces!**
   - Click "Edit" next to the space name to customize
   - Choose an emoji and name for your workspace
   - Select which services to show (GitHub, Slack, Calendar)
   - Pick a theme or customize your own colors

## 🎨 Theming

Each workspace can have its own custom theme with 4 colors:

- **Primary**: Interactive elements (buttons, links)
- **Background**: Base canvas color
- **Surface**: Cards and panels
- **Accent**: Highlights and badges

### Pre-made Themes

- 🔵 **Default**: Classic blue
- 🌊 **Ocean**: Calm blue waters
- 🌲 **Forest**: Natural green
- 🌅 **Sunset**: Warm orange
- 🌹 **Rose**: Elegant pink
- 💜 **Purple**: Royal purple

## 🚀 Usage

### Keyboard Shortcuts

- `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) - Open command center and focus search

### Refreshing Data

- Click the refresh icon (↻) in the header to update all services
- Auto-refresh happens when you visit GitHub, Slack, or Calendar pages

### Managing Spaces

- **Create New**: Click "Save as new" button
- **Edit**: Click edit icon next to space name
- **Delete**: Edit a space and delete it from there

### Organizing Items

- **Pin Tabs**: Right-click a tab and select "Pin to space"
- **Create Folders**: Click "+ Folder" in Pinned or Tabs sections
- **Drag & Drop**: Drag items to reorder or move into folders
- **Rename Folders**: Click folder name to edit

## 🔧 Development

### Project Structure

```
home/
├── manifest.json          # Extension configuration
├── background.js          # Service worker, tab management
├── sidepanel.html         # Main UI
├── sidepanel.js           # UI logic, state management
├── sidepanel.css          # Styles
├── github-fetch.js        # GitHub API fetching
├── content/               # Content scripts
│   ├── slack.js          # Slack activity scraper
│   ├── calendar.js       # Calendar scraper
│   └── github.js         # GitHub page scraper
└── icons/                # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Local Development

1. Make your changes to the code
2. Go to `chrome://extensions/`
3. Click the reload icon on the HOME extension
4. Test your changes

### Creating a Release

1. Update version in `manifest.json`
2. Commit your changes
3. Create and push a version tag:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
4. GitHub Actions will automatically:
   - Build the extension
   - Create a release
   - Upload the ZIP file

## 🔒 Privacy

This extension:
- ✅ Runs locally in your browser
- ✅ No data sent to external servers
- ✅ No analytics or tracking
- ✅ All data stored locally in Chrome storage
- ✅ Open source - audit the code yourself

### Permissions Explained

- **tabs**: Read open tabs for workspace management
- **tabGroups**: Create and manage tab groups
- **storage**: Save your workspaces and settings locally
- **scripting**: Inject content scripts to scrape data
- **sidePanel**: Display the side panel interface
- **host_permissions**: Access GitHub, Slack, Calendar to scrape data

## 🐛 Troubleshooting

### Slack not showing activity
- Make sure you've configured your Slack Workspace ID in settings
- Navigate to Slack's Activity page: `app.slack.com/client/YOUR_WORKSPACE_ID/activity`
- Click the refresh button in HOME

### GitHub PRs not loading
- Make sure you're logged into GitHub
- Navigate to `github.com/pulls` to trigger a refresh
- Check that you've set your GitHub username in settings

### Calendar events not appearing
- Navigate to Google Calendar: `calendar.google.com`
- The extension will automatically scrape your events
- Make sure you're logged in to Google

### Extension not loading
- Make sure Developer mode is enabled in `chrome://extensions/`
- Check that the folder path is correct and hasn't been moved
- Try reloading the extension

## 📝 License

MIT License - feel free to use, modify, and distribute this extension.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📧 Support

Having issues? Please open an issue on GitHub with:
- Chrome version
- Extension version
- Description of the problem
- Steps to reproduce

---

Made with ❤️ for productivity enthusiasts
