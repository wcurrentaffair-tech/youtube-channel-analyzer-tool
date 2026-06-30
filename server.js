require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const EN_STOPWORDS = new Set(`a an the and or but if then than to of in on at for with without from by as is are was were be been being this that these those it its into about above below after before over under again more most such no nor not only own same so too very can will just should now how what why who when where which your you my our their his her they them we us i me he she video videos youtube channel new latest full complete best top viral explained explanation story stories shorts short live today yesterday tomorrow episode part vs review reaction official trailer news india hindi english hinglish motivational mystery secret real true poor rich boy girl man woman life`.split(/\s+/));
const HI_STOPWORDS = new Set(`hai hain tha thi the ka ki ke ko se me mein par aur ya kya kyu kaise kab kahan yeh ye wo woh ek do teen apna apni apne sab sabhi aap tum hum ham is us iska uska kar kare kiya gaya hui hua honge hoga hogi nahi nhi bhi bahut jyada kam phir fir le liye de diya wale wali wala tak hi to pr ho raha rha rhe rahi`.split(/\s+/));
const EMOTIONAL_WORDS = ['shocking','secret','truth','real','hidden','mystery','viral','danger','emotional','poor','rich','success','failure','motivation','scam','exposed','unknown','amazing','incredible','surprising','sad','happy','fear','hope','rahasya','sach','garib','ameer','hairan','chaukane','success','fail','motivation','dhokha','khatra','secret','viral'];

function cleanText(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/[^a-z0-9\u0900-\u097F\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(token) {
  return token
    .replace(/^\d+$/, '')
    .replace(/^[\W_]+|[\W_]+$/g, '')
    .trim();
}

function getTokens(text) {
  return cleanText(text)
    .split(/\s+/)
    .map(normalizeToken)
    .filter(t => t && t.length >= 3 && !EN_STOPWORDS.has(t) && !HI_STOPWORDS.has(t));
}

function parseISODuration(iso = 'PT0S') {
  const match = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, d, h, m, s] = match.map(x => Number(x || 0));
  return d * 86400 + h * 3600 + m * 60 + s;
}

function formatDuration(seconds = 0) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function n(value) {
  const num = Number(value || 0);
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function safeDate(date) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysSince(date) {
  const d = safeDate(date);
  if (!d) return 1;
  return Math.max(1, Math.round((Date.now() - d.getTime()) / 86400000));
}

function dayName(date) {
  const d = safeDate(date);
  if (!d) return 'Unknown';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

async function yt(pathName, params = {}) {
  if (!YOUTUBE_API_KEY) {
    const err = new Error('YOUTUBE_API_KEY missing. Add your key in .env file.');
    err.status = 500;
    throw err;
  }

  const url = new URL(`${YT_BASE}/${pathName}`);
  Object.entries({ ...params, key: YOUTUBE_API_KEY }).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.error?.message || `YouTube API error: ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.details = data?.error;
    throw err;
  }
  return data;
}

function parseChannelInput(inputRaw) {
  const input = String(inputRaw || '').trim();
  if (!input) return { type: 'empty', value: '' };

  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(input)) return { type: 'id', value: input };
  if (input.startsWith('@')) return { type: 'handle', value: input };

  try {
    const url = new URL(input.startsWith('http') ? input : `https://www.youtube.com/${input}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0]?.startsWith('@')) return { type: 'handle', value: parts[0] };
    if (parts[0] === 'channel' && parts[1]) return { type: 'id', value: parts[1] };
    if (parts[0] === 'user' && parts[1]) return { type: 'username', value: parts[1] };
    if (parts[0] === 'c' && parts[1]) return { type: 'search', value: parts[1] };
    if (parts[0]) return { type: 'handleOrSearch', value: parts[0].replace(/^@/, '') };
  } catch (_) {}

  return { type: 'handleOrSearch', value: input.replace(/^@/, '') };
}

async function getChannelById(id) {
  const data = await yt('channels', {
    part: 'snippet,statistics,contentDetails,topicDetails,brandingSettings',
    id,
    maxResults: 1,
  });
  return data.items?.[0] || null;
}

async function resolveChannel(input) {
  const parsed = parseChannelInput(input);
  if (parsed.type === 'empty') throw new Error('Please enter a YouTube channel URL, handle, or channel ID.');

  let channel = null;

  if (parsed.type === 'id') {
    channel = await getChannelById(parsed.value);
  } else if (parsed.type === 'handle') {
    const data = await yt('channels', {
      part: 'snippet,statistics,contentDetails,topicDetails,brandingSettings',
      forHandle: parsed.value,
      maxResults: 1,
    });
    channel = data.items?.[0] || null;
  } else if (parsed.type === 'username') {
    const data = await yt('channels', {
      part: 'snippet,statistics,contentDetails,topicDetails,brandingSettings',
      forUsername: parsed.value,
      maxResults: 1,
    });
    channel = data.items?.[0] || null;
  } else {
    // Try as handle first, then search exact channel.
    try {
      const byHandle = await yt('channels', {
        part: 'snippet,statistics,contentDetails,topicDetails,brandingSettings',
        forHandle: parsed.value,
        maxResults: 1,
      });
      channel = byHandle.items?.[0] || null;
    } catch (_) {}

    if (!channel) {
      const search = await yt('search', {
        part: 'snippet',
        q: parsed.value,
        type: 'channel',
        maxResults: 1,
      });
      const channelId = search.items?.[0]?.snippet?.channelId || search.items?.[0]?.id?.channelId;
      if (channelId) channel = await getChannelById(channelId);
    }
  }

  if (!channel) throw new Error('Channel not found. Try channel ID or @handle URL.');
  return channel;
}

async function getUploadedVideoIds(uploadsPlaylistId, limit = 50) {
  const ids = [];
  let pageToken = '';
  while (ids.length < limit) {
    const data = await yt('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(50, limit - ids.length),
      pageToken,
    });
    for (const item of data.items || []) {
      const id = item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId;
      if (id) ids.push(id);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

async function getVideoDetails(videoIds) {
  const videos = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const data = await yt('videos', {
      part: 'snippet,statistics,contentDetails',
      id: batch.join(','),
      maxResults: 50,
    });
    for (const item of data.items || []) {
      const stats = item.statistics || {};
      const snippet = item.snippet || {};
      const seconds = parseISODuration(item.contentDetails?.duration);
      const publishedAt = snippet.publishedAt;
      const viewCount = Number(stats.viewCount || 0);
      const likeCount = Number(stats.likeCount || 0);
      const commentCount = Number(stats.commentCount || 0);
      const ageDays = daysSince(publishedAt);
      videos.push({
        id: item.id,
        url: `https://www.youtube.com/watch?v=${item.id}`,
        title: snippet.title || 'Untitled',
        description: snippet.description || '',
        publishedAt,
        thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
        durationSeconds: seconds,
        duration: formatDuration(seconds),
        views: viewCount,
        likes: likeCount,
        comments: commentCount,
        viewsPerDay: Math.round(viewCount / ageDays),
        likeRate: viewCount ? Number(((likeCount / viewCount) * 100).toFixed(2)) : 0,
        commentRate: viewCount ? Number(((commentCount / viewCount) * 100).toFixed(2)) : 0,
        ageDays,
        day: dayName(publishedAt),
      });
    }
  }
  return videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

function buildTopicAnalysis(videos) {
  const keywordMap = new Map();
  const phraseMap = new Map();

  videos.forEach((video) => {
    const titleTokens = getTokens(video.title);
    const descTokens = getTokens(video.description).slice(0, 80);
    const tokens = [...titleTokens, ...descTokens];
    const weight = Math.max(1, Math.log10(video.views + 10)) + Math.min(8, video.viewsPerDay / 10000);

    tokens.forEach((t) => {
      const prev = keywordMap.get(t) || { topic: t, count: 0, weightedScore: 0, totalViews: 0, videos: [] };
      prev.count += 1;
      prev.weightedScore += weight;
      prev.totalViews += video.views;
      if (prev.videos.length < 5) prev.videos.push({ title: video.title, views: video.views, url: video.url });
      keywordMap.set(t, prev);
    });

    for (let i = 0; i < titleTokens.length - 1; i++) {
      const phrase = `${titleTokens[i]} ${titleTokens[i + 1]}`;
      const prev = phraseMap.get(phrase) || { topic: phrase, count: 0, weightedScore: 0, totalViews: 0, videos: [] };
      prev.count += 1;
      prev.weightedScore += weight * 1.5;
      prev.totalViews += video.views;
      if (prev.videos.length < 5) prev.videos.push({ title: video.title, views: video.views, url: video.url });
      phraseMap.set(phrase, prev);
    }
  });

  const all = [...phraseMap.values(), ...keywordMap.values()]
    .filter(x => x.count >= 1)
    .map(x => ({
      ...x,
      avgViews: Math.round(x.totalViews / Math.max(1, x.count)),
      score: Number(x.weightedScore.toFixed(2)),
    }))
    .sort((a, b) => (b.score + b.avgViews / 100000) - (a.score + a.avgViews / 100000));

  return all.slice(0, 12);
}

function analyzeTitles(videos, avgViews) {
  const patterns = {
    hasNumber: [],
    question: [],
    emotional: [],
    shortTitle: [],
    longTitle: [],
  };

  videos.forEach(v => {
    const title = v.title.toLowerCase();
    if (/\d/.test(title)) patterns.hasNumber.push(v);
    if (/[?？]|kya|kaise|why|how|what|kab|kyu/.test(title)) patterns.question.push(v);
    if (EMOTIONAL_WORDS.some(w => title.includes(w))) patterns.emotional.push(v);
    if (v.title.length <= 55) patterns.shortTitle.push(v);
    if (v.title.length >= 75) patterns.longTitle.push(v);
  });

  const summarize = (arr) => ({
    count: arr.length,
    avgViews: arr.length ? Math.round(arr.reduce((s, v) => s + v.views, 0) / arr.length) : 0,
    performance: arr.length && (arr.reduce((s, v) => s + v.views, 0) / arr.length) >= avgViews ? 'Above average' : 'Below/neutral',
  });

  return {
    numberTitles: summarize(patterns.hasNumber),
    questionTitles: summarize(patterns.question),
    emotionalTitles: summarize(patterns.emotional),
    shortTitles: summarize(patterns.shortTitle),
    longTitles: summarize(patterns.longTitle),
    bestTitleFormula: inferTitleFormula(videos),
  };
}

function inferTitleFormula(videos) {
  const top = [...videos].sort((a, b) => b.views - a.views).slice(0, Math.max(3, Math.ceil(videos.length * 0.2)));
  const hasNumbers = top.filter(v => /\d/.test(v.title)).length;
  const hasEmotion = top.filter(v => EMOTIONAL_WORDS.some(w => v.title.toLowerCase().includes(w))).length;
  const hasQuestion = top.filter(v => /[?？]|kya|kaise|why|how|what|kab|kyu/i.test(v.title)).length;
  const avgLen = Math.round(top.reduce((s, v) => s + v.title.length, 0) / Math.max(1, top.length));

  const parts = [];
  if (hasNumbers >= top.length / 3) parts.push('number/quantity');
  if (hasEmotion >= top.length / 3) parts.push('emotion/curiosity word');
  if (hasQuestion >= top.length / 3) parts.push('question hook');
  parts.push(`title length around ${avgLen} characters`);
  return `Best titles seem to use ${parts.join(' + ')}.`;
}

function uploadPattern(videos) {
  const sorted = [...videos].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.round((new Date(sorted[i].publishedAt) - new Date(sorted[i - 1].publishedAt)) / 86400000);
    if (diff >= 0) gaps.push(diff);
  }

  const dayCounts = {};
  videos.forEach(v => { dayCounts[v.day] = (dayCounts[v.day] || 0) + 1; });
  const bestDays = Object.entries(dayCounts).sort((a, b) => b[1] - a[1]).map(([day, count]) => ({ day, count }));

  const avgGap = gaps.length ? Number((gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(1)) : null;
  let cadence = 'Not enough data';
  if (avgGap !== null) {
    if (avgGap <= 2) cadence = 'Very frequent upload pattern';
    else if (avgGap <= 7) cadence = 'Weekly/multiple videos per week pattern';
    else if (avgGap <= 15) cadence = 'Bi-weekly pattern';
    else cadence = 'Irregular/low frequency pattern';
  }

  return { avgGapDays: avgGap, cadence, bestDays, recentUploadsAnalyzed: videos.length };
}

function audiencePreference(videos, topTopics) {
  const topVideos = [...videos].sort((a, b) => b.views - a.views).slice(0, 10);
  const avgDuration = Math.round(videos.reduce((s, v) => s + v.durationSeconds, 0) / Math.max(1, videos.length));
  const topAvgDuration = Math.round(topVideos.reduce((s, v) => s + v.durationSeconds, 0) / Math.max(1, topVideos.length));
  const emotionHits = topVideos.flatMap(v => EMOTIONAL_WORDS.filter(w => v.title.toLowerCase().includes(w)));
  const topicNames = topTopics.slice(0, 5).map(t => t.topic);

  let durationInsight = 'Mixed duration preference.';
  if (topAvgDuration > avgDuration * 1.2) durationInsight = 'Audience is accepting longer videos when topic is strong.';
  if (topAvgDuration < avgDuration * 0.8) durationInsight = 'Shorter/direct videos are performing better than channel average.';

  return {
    likelyAudience: inferLikelyAudience(videos),
    preferredTopics: topicNames,
    emotionalTriggers: [...new Set(emotionHits)].slice(0, 8),
    durationInsight,
    behaviorSummary: `Audience likely clicks on ${topicNames.slice(0, 3).join(', ') || 'clear niche topics'} with strong curiosity and simple title packaging.`,
  };
}

function inferLikelyAudience(videos) {
  const text = cleanText(videos.map(v => `${v.title} ${v.description.slice(0, 200)}`).join(' '));
  if (/current affairs|news|ssc|upsc|exam|gk|general knowledge|polity|history|geography|करंट|समाचार|परीक्षा/.test(text)) {
    return 'Students, competitive exam aspirants, and current affairs viewers.';
  }
  if (/motivation|success|poor|rich|business|money|life|garib|ameer|सफलता/.test(text)) {
    return 'Motivation, self-improvement, and story-based viewers.';
  }
  if (/horror|mystery|secret|ghost|crime|rahasya|भूत|रहस्य/.test(text)) {
    return 'Mystery, suspense, crime, and curiosity-driven viewers.';
  }
  if (/tech|ai|software|app|tool|coding|mobile|computer/.test(text)) {
    return 'Tech learners, creators, and digital tool users.';
  }
  return 'General niche viewers who respond to clear titles, curiosity hooks, and useful information.';
}

function ctrSuggestions(titleAnalysis, topVideos) {
  const suggestions = [
    'Title ko 45–65 characters ke andar rakho aur main keyword first half me lao.',
    'Thumbnail me 2–4 words maximum rakho; face/object + contrast + curiosity gap use karo.',
    'Top videos ke emotional words aur title formula ko repeat karo, exact copy nahi.',
    'Title me clear benefit ya mystery add karo: “Kya Hua?”, “Sach”, “Secret”, “Reason”, “Mistake”.',
  ];

  if (titleAnalysis.numberTitles.performance === 'Above average') suggestions.push('Number-based titles achha perform kar rahe hain; list/count angle zyada test karo.');
  if (titleAnalysis.questionTitles.performance === 'Above average') suggestions.push('Question hook channel par work kar raha hai; “Kaise/Kyu/Kya” style titles test karo.');
  if (titleAnalysis.emotionalTitles.performance === 'Above average') suggestions.push('Emotion/curiosity words top videos me strong signal de rahe hain; thumbnail expression bhi emotional rakho.');
  if (topVideos.some(v => v.title.length > 80)) suggestions.push('Long titles ko compress karo; mobile screen par main hook cut ho sakta hai.');

  return suggestions.slice(0, 7);
}

function retentionSuggestions(videos) {
  const avgDuration = videos.reduce((s, v) => s + v.durationSeconds, 0) / Math.max(1, videos.length);
  const suggestions = [
    'First 5 seconds me result/secret/problem dikhao; intro logo ya long greeting avoid karo.',
    'Har 20–30 seconds me visual change, zoom, B-roll, text pop-up ya sound effect add karo.',
    'Script me curiosity loop use karo: pehle question create karo, answer thoda delay se do.',
    'Mid-video me “ab sabse important point” jaisa pattern interrupt add karo.',
    'End screen se pehle conclusion short rakho; unnecessary repeat lines cut karo.',
  ];
  if (avgDuration > 900) suggestions.push('Average video 15 min+ hai; chapters aur mini-hooks har section ke start me add karo.');
  if (avgDuration < 180) suggestions.push('Short videos ke liye pacing fast rakho; first sentence me direct payoff do.');
  return suggestions;
}

function contentStrengthWeakness(videos, topTopics) {
  const views = videos.map(v => v.views);
  const avgViews = views.reduce((s, v) => s + v, 0) / Math.max(1, views.length);
  const med = median(views);
  const consistency = avgViews && med ? med / avgViews : 0;

  const strengths = [];
  const weaknesses = [];
  if (topTopics.length) strengths.push(`Clear topic clusters found: ${topTopics.slice(0, 3).map(t => t.topic).join(', ')}.`);
  if (consistency > 0.6) strengths.push('Views are relatively consistent, which means audience-topic fit is stable.');
  else weaknesses.push('Views are uneven; topic selection/title packaging needs more consistency.');

  const recent = videos.slice(0, 10);
  const recentAvg = recent.reduce((s, v) => s + v.viewsPerDay, 0) / Math.max(1, recent.length);
  const overallAvg = videos.reduce((s, v) => s + v.viewsPerDay, 0) / Math.max(1, videos.length);
  if (recentAvg >= overallAvg) strengths.push('Recent videos are getting competitive views per day.');
  else weaknesses.push('Recent videos are slower than older average; test stronger hooks and trending angles.');

  return { strengths, weaknesses };
}

function nextRecommendations(topTopics, audience, videos) {
  const baseTopics = topTopics.slice(0, 6).map(t => t.topic).filter(Boolean);
  const templates = [
    'The Untold Truth About {topic}',
    '{topic}: 5 Mistakes Most People Ignore',
    'Why {topic} Is Going Viral Right Now',
    'The Real Story Behind {topic}',
    '{topic} Explained in Simple Language',
    'What Nobody Tells You About {topic}',
    '{topic} Case Study: Full Breakdown',
    'Before You Watch {topic}, Know This',
    '{topic} vs Reality: Shocking Facts',
    'How {topic} Changed Everything',
  ];
  const recs = [];
  for (let i = 0; i < templates.length; i++) {
    const topic = baseTopics[i % Math.max(1, baseTopics.length)] || 'your niche topic';
    recs.push({
      idea: templates[i].replace('{topic}', topic),
      hook: `Most people know ${topic}, but they do not know the real reason behind it.`,
      thumbnailText: topic.split(' ').slice(0, 2).join(' ').toUpperCase(),
      reason: `Matches audience preference: ${audience.preferredTopics?.slice(0, 2).join(', ') || 'top channel themes'}.`,
    });
  }
  return recs;
}

function analyze(videos, channel) {
  const views = videos.map(v => v.views);
  const avgViews = Math.round(views.reduce((s, v) => s + v, 0) / Math.max(1, views.length));
  const medViews = median(views);
  const topVideos = [...videos].sort((a, b) => b.views - a.views).slice(0, 10);
  const fastVideos = [...videos].sort((a, b) => b.viewsPerDay - a.viewsPerDay).slice(0, 10);
  const topTopics = buildTopicAnalysis(videos);
  const titleAnalysis = analyzeTitles(videos, avgViews);
  const upload = uploadPattern(videos);
  const audience = audiencePreference(videos, topTopics);
  const sw = contentStrengthWeakness(videos, topTopics);

  return {
    generatedAt: new Date().toISOString(),
    dataSourceNote: 'Public YouTube Data API data only. Exact CTR/retention unavailable without channel owner OAuth analytics access.',
    channel: {
      id: channel.id,
      title: channel.snippet?.title,
      description: channel.snippet?.description,
      customUrl: channel.snippet?.customUrl,
      publishedAt: channel.snippet?.publishedAt,
      country: channel.snippet?.country || 'Unknown',
      thumbnail: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.medium?.url || '',
      subscribers: Number(channel.statistics?.subscriberCount || 0),
      views: Number(channel.statistics?.viewCount || 0),
      videos: Number(channel.statistics?.videoCount || 0),
    },
    summary: {
      videosAnalyzed: videos.length,
      averageViews: avgViews,
      medianViews: medViews,
      highestViews: topVideos[0]?.views || 0,
      averageDuration: formatDuration(Math.round(videos.reduce((s, v) => s + v.durationSeconds, 0) / Math.max(1, videos.length))),
      mainInsight: topTopics.length ? `Channel ke best signals ${topTopics.slice(0, 3).map(t => t.topic).join(', ')} topics par aa rahe hain.` : 'Not enough topic signal found.',
    },
    topVideos,
    fastVideos,
    topTopics,
    titleAnalysis,
    uploadPattern: upload,
    audiencePreference: audience,
    strengths: sw.strengths,
    weaknesses: sw.weaknesses,
    ctrSuggestions: ctrSuggestions(titleAnalysis, topVideos),
    retentionSuggestions: retentionSuggestions(videos),
    nextVideoRecommendations: nextRecommendations(topTopics, audience, videos),
    videos,
  };
}

function demoData() {
  const titles = [
    'Ek Garib Ladke Ne Jo Kiya, Sab Hairan Ho Gaye',
    'Real Success Story of a Poor Boy | Motivation',
    '5 Mistakes Jo Har Student Karta Hai',
    'Why This Simple Habit Changed His Life',
    'Garib Se Crorepati Banane Ka Sach',
    'Aaj Ki Sabse Badi Current Affairs Update',
    'Secret Formula of Successful People',
    'Kya Aap Ye Galti Kar Rahe Ho?',
    'Motivation Story That Will Make You Cry',
    'The Untold Truth Behind Success'
  ];
  const now = Date.now();
  const videos = titles.map((title, i) => ({
    id: `demo${i}`,
    url: '#',
    title,
    description: `${title} emotional motivational story success student life poor boy truth secret`,
    publishedAt: new Date(now - i * 5 * 86400000).toISOString(),
    thumbnail: '',
    durationSeconds: 420 + i * 60,
    duration: formatDuration(420 + i * 60),
    views: [520000, 210000, 90000, 170000, 300000, 80000, 130000, 100000, 260000, 190000][i],
    likes: [21000, 9000, 3000, 7000, 11000, 2000, 5000, 3500, 10000, 8500][i],
    comments: [600, 300, 140, 250, 550, 80, 190, 160, 430, 310][i],
    viewsPerDay: Math.round([520000, 210000, 90000, 170000, 300000, 80000, 130000, 100000, 260000, 190000][i] / Math.max(1, i * 5 + 1)),
    likeRate: 4.0,
    commentRate: 0.2,
    ageDays: i * 5 + 1,
    day: dayName(new Date(now - i * 5 * 86400000).toISOString()),
  }));
  const channel = {
    id: 'demo-channel',
    snippet: { title: 'Demo Motivation Channel', description: 'Demo channel', publishedAt: new Date(now - 1000 * 86400000).toISOString(), thumbnails: {} },
    statistics: { subscriberCount: 120000, viewCount: 5600000, videoCount: 250 },
  };
  return analyze(videos, channel);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(YOUTUBE_API_KEY) });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { channelUrl, maxVideos = 50, demo = false } = req.body || {};
    if (demo) return res.json(demoData());
    const limit = Math.max(10, Math.min(100, Number(maxVideos) || 50));

    const channel = await resolveChannel(channelUrl);
    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) throw new Error('Could not find uploads playlist for this channel.');

    const ids = await getUploadedVideoIds(uploadsPlaylistId, limit);
    if (!ids.length) throw new Error('No public uploaded videos found for this channel.');

    const videos = await getVideoDetails(ids);
    const report = analyze(videos, channel);
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      error: true,
      message: err.message || 'Something went wrong',
      details: err.details || null,
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`YouTube Channel Analyzer running on http://localhost:${PORT}`);
});
