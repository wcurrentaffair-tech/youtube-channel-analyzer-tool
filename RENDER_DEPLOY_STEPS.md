# Render Deploy Steps - YouTube Channel Analyzer Tool

## 1. GitHub par upload

Project folder open karke terminal me run karein:

```bash
git init
git add .
git commit -m "deploy youtube channel analyzer"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## 2. Render Dashboard me deploy

1. Render Dashboard open karein.
2. New > Web Service par click karein.
3. GitHub repo connect/select karein.
4. Settings:
   - Language/Runtime: Node
   - Build Command: npm install
   - Start Command: npm start
5. Environment Variables me add karein:
   - Key: YOUTUBE_API_KEY
   - Value: apni YouTube Data API v3 key
6. Create Web Service par click karein.

## 3. Live link

Deploy complete hone ke baad link milega:

```text
https://your-service-name.onrender.com
```

## 4. Health test

```text
https://your-service-name.onrender.com/api/health
```

Expected:

```json
{ "ok": true, "hasApiKey": true }
```

## 5. Common errors

- hasApiKey false: Render Environment me YOUTUBE_API_KEY add nahi hai.
- Application failed: Start Command npm start hona chahiye.
- API error: YouTube Data API v3 enable karo.
