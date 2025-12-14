'use server'

import { Innertube } from 'youtubei.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { unstable_cache } from 'next/cache';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export type SubtitleBlock = {
  text: string;
  offset: number;
  duration: number;
};

// 1. Define the expensive worker function
const generateTranscriptWorker = async (videoId: string) => {
  console.log("MISS: Cache not found, generating fresh transcript for:", videoId);
  
  // 1. Fetch transcript from YouTube using youtubei.js
  const youtube = await Innertube.create();
  const info = await youtube.getInfo(videoId);
  
  // Get available caption tracks
  const transcriptInfo = await info.getTranscript();
  
  if (!transcriptInfo?.transcript?.content?.body?.initial_segments) {
    throw new Error("No transcript found. The video may not have captions enabled.");
  }

  const segments = transcriptInfo.transcript.content.body.initial_segments;
  
  if (!segments || segments.length === 0) {
    throw new Error("No transcript segments found.");
  }

  console.log(`Success! Found ${segments.length} transcript entries`);

  // Convert to our format - filter out section headers and only keep segments with text
  const transcript: SubtitleBlock[] = segments
    .filter((segment): segment is typeof segment & { start_ms: string; end_ms: string; snippet: { text: string } } => {
      return 'start_ms' in segment && 'snippet' in segment && segment.snippet?.text !== undefined;
    })
    .map((segment) => ({
      text: segment.snippet.text || '',
      offset: parseInt(segment.start_ms) || 0,
      duration: (parseInt(segment.end_ms) || 0) - (parseInt(segment.start_ms) || 0),
    }));

  console.log("Transcript sample:", transcript.slice(0, 2));

  // 2. Translate in chunks (Gemini has token limits)
  const chunkSize = 50;
  const translatedSubs: SubtitleBlock[] = [];

  for (let i = 0; i < transcript.length; i += chunkSize) {
    const chunk = transcript.slice(i, i + chunkSize);
    console.log(`Translating chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(transcript.length/chunkSize)}...`);
    const translated = await translateChunk(chunk);
    translatedSubs.push(...translated);
  }

  return translatedSubs;
};

// 2. Wrap it with unstable_cache
const getCachedTranscript = unstable_cache(
  async (videoId: string) => generateTranscriptWorker(videoId),
  ['transcript-cache'], // A tag to identify this cache group
  {
    revalidate: 86400, // Cache for 24 hours (in seconds)
    tags: ['transcript'] 
  }
);

export async function processVideo(videoUrl: string) {
  try {
    // Extract video ID from URL
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      throw new Error("Invalid YouTube URL. Please enter a valid YouTube link.");
    }

    console.log("Requesting transcript for ID:", videoId);
    
    // This will check the cache first. If found, it returns instantly.
    // If not, it runs the worker, saves the result, and returns.
    const data = await getCachedTranscript(videoId);

    return { success: true, data };

  } catch (error: unknown) {
    console.error("Processing Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return { 
      success: false, 
      error: errorMessage
    };
  }
}

async function translateChunk(chunk: { text: string; offset: number; duration: number }[], retryCount = 0): Promise<SubtitleBlock[]> {
  const MAX_RETRIES = 3;
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.2,
      topP: 0.8,
    }
  });
  
  const prompt = `You are a translator. Translate the subtitle text to Vietnamese.

RULES:
1. Return ONLY valid JSON array - NO markdown, NO explanation
2. Keep "offset" and "duration" EXACTLY the same
3. Only translate "text" field to natural Vietnamese

Input:
${JSON.stringify(chunk)}

Output (valid JSON only):
[{"text":"Vietnamese","offset":123,"duration":456}]`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Clean markdown and extra text
    let cleanedText = text
      .replace(/```json\n?/gi, '')
      .replace(/```\n?/g, '')
      .trim();
    
    // Extract JSON array
    const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleanedText = jsonMatch[0];
    }
    
    const parsed = JSON.parse(cleanedText);
    
    // If response length mismatches, gracefully fill gaps with original text
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Invalid response structure');
    }

    // Map over original chunk length; use translated text when available
    return chunk.map((orig, idx) => {
      const translated = parsed[idx];
      return {
        text: translated?.text || orig.text,
        offset: orig.offset,
        duration: orig.duration,
      };
    });
    
  } catch (error) {
    console.error(`Translation error (attempt ${retryCount + 1}):`, error);
    
    if (retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
      return translateChunk(chunk, retryCount + 1);
    }
    
    // Return original text if all retries fail
    return chunk.map(item => ({
      ...item,
      text: `[Lỗi dịch] ${item.text}`
    }));
  }
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}
