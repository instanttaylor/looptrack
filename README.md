# LoopTrack

A simple, local usage tracker for AI coding assistants.

## Why

When you're using tools like Claude Code, Codex, or other LLM-powered coding assistants across multiple projects, it's hard to know where your tokens are going. LoopTrack gives you visibility into your usage patterns - by project, by day, by group - so you can make informed decisions about how you're using these tools.

Built for personal use. No cloud, no accounts, no tracking. Just a local dashboard that reads your usage data and shows you what's happening.

Currently supports Claude Code via [ccusage](https://github.com/ryoppippi/ccusage). Codex and other tools coming as usage APIs become available.

> **Why not just use ccusage?** ccusage is great for quick CLI usage checks. We needed something with project grouping - a way to see usage across multiple repos that belong to the same project or client. LoopTrack adds that layer on top.

## Setup

```bash
# Install dependencies
npm install

# First sync - will prompt for a machine identifier
npm run sync

# Start the dashboard
npm start
```

Then open http://localhost:3456

## Usage

- **Sync** - Click the Sync button (or run `npm run sync`) to pull latest usage from Claude Code
- **Groups** - Organize projects into groups in the Groups tab for better tracking
- **Machine filter** - If you have multiple machines, filter by machine or view combined
- **Cloud sync** - Set up a sync folder to backup and share data across machines

## Cloud Sync

If you use Claude Code on multiple machines (laptop, desktop, work machine), you probably want to see combined usage across all of them. Cloud sync makes this easy.

**Why it's useful:**
- See total token usage and costs across all your machines in one dashboard
- Keep a backup of your usage data in iCloud, Dropbox, or any synced folder
- Works offline - local data is always available, cloud sync happens in the background

**How it works:**
1. Click the "Cloud: Not set" button in the dashboard header
2. A native folder picker opens - select a folder in iCloud Drive, Dropbox, or similar
3. Your local usage file is pushed to that folder
4. Other machines' usage files are pulled from that folder
5. Every sync after that keeps everything in sync

Each machine maintains its own `usage-{machineId}.json` file, so there are no conflicts. The dashboard aggregates all files automatically.

**Setup on each machine:**
```bash
# On machine 1: set cloud folder to iCloud
# (click Cloud button in UI, select ~/Library/Mobile Documents/com~apple~CloudDocs/looptrack-data)

# On machine 2: set the same cloud folder
# (the folder picker will show the same iCloud path)
```

Your `~/.looptrack/identity.json` will include the cloud folder path:
```json
{
  "machineId": "taylor-mbp",
  "cloudDir": "/Users/taylor/Library/Mobile Documents/com~apple~CloudDocs/looptrack-data"
}
```

## Requirements

- Node.js 18+ (or Bun)
- Claude Code installed with some usage history

## Development

```bash
# Run tests
bun test

# Run in dev mode (auto-reload)
npm run dev
```

## Files (local, not tracked)

These files are created automatically and gitignored:

### `~/.looptrack/identity.json`
Your machine identifier (created on first sync):
```json
{
  "machineId": "taylor-mbp"
}
```

### `data/usage-{machine}.json`
Your usage data synced from Claude Code:
```json
{
  "sessions": {
    "-Users-taylor-Development-myproject": {
      "sessionId": "-Users-taylor-Development-myproject",
      "projectPath": "/Users/taylor/Development/myproject",
      "inputTokens": 50000,
      "outputTokens": 5000,
      "totalCost": 1.25,
      "lastActivity": "2025-01-09"
    }
  },
  "lastSync": "2025-01-09T12:00:00.000Z"
}
```

### `config.json`
Your project groups for organizing usage:
```json
{
  "projectGroups": {
    "Work": ["project-a", "project-b"],
    "Personal": ["side-project", "dotfiles"]
  }
}
```
Groups match by project name (last part of path), so they work across machines with different directory structures.

## Tip

Set Claude's history retention to a high value (like 9999 days) to preserve usage history. You can do this from the retention indicator in the dashboard header.
