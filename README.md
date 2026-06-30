# YouTube Channel Analyzer Tool

A working full-stack tool for analyzing public YouTube channel data.

## What it analyzes

- Channel URL / handle / channel ID
- Most viewed videos
- Top performing topics
- Audience preference estimate
- Title pattern analysis
- Upload pattern
- CTR improvement suggestions
- Retention improvement suggestions
- Next video recommendations

## Important limitation

This tool uses **YouTube Data API v3**, so it can analyze public metadata such as title, views, likes, comments, dates, descriptions and duration.

Exact CTR, impressions, retention, audience age/gender, revenue and watch-time are private YouTube Studio analytics. For those exact numbers, YouTube Analytics API with OAuth owner login is required. This version gives smart estimated suggestions based on public signals.

## Setup

1. Install Node.js 18+
2. Open this folder in VS Code
3. Run:

```bash
npm install
```

4. Copy `.env.example` to `.env`
5. Add your YouTube Data API key:

```env
YOUTUBE_API_KEY=your_key_here
PORT=3000
```

6. Run:

```bash
npm run dev
```

7. Open:

```text
http://localhost:3000
```

## YouTube API key steps

1. Go to Google Cloud Console
2. Create a project
3. Go to APIs & Services
4. Enable **YouTube Data API v3**
5. Go to Credentials
6. Create API key
7. Paste it in `.env`

## Supported URL examples

```text
https://www.youtube.com/@GoogleDevelopers
https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw
@GoogleDevelopers
GoogleDevelopers
```

## Deploy

You can deploy this on Render, Railway, VPS, or any Node.js hosting.

Set environment variable:

```text
YOUTUBE_API_KEY=your_key_here
```
